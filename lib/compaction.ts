import "server-only";

import {
  type AgentName,
  type ChatMessage,
  contentToText,
  conversationIdFor,
  ensureConversation,
  loadConversationMessages
} from "@/lib/agent-context";
import type { SupabaseClient } from "@supabase/supabase-js";

export const PRESSURE_WARN_CHARS = 60_000;
export const PRESSURE_HIGH_CHARS = 120_000;
const DEFAULT_TIME_ZONE = "America/New_York";
const EXCERPT_LENGTH = 700;
const DEFAULT_COMPILE_TRANSCRIPT_CHARS = 50_000;
const COMPILE_OPENING_MESSAGES = 8;
const ARCHIVE_INSERT_CHUNK_SIZE = 500;
export const COMPACTION_CHECKPOINT_PREFIX = "[COMPACTION_CHECKPOINT_V1]";

type RestorationProfile = {
  compaction_memory_policy: string | null;
  current_state: string | null;
  opening_orientation: string | null;
  persona_summary: string | null;
};

export type CompactionSource = {
  omitted_message_count: number;
  selected_characters: number;
  selected_message_count: number;
  text: string;
  transcript_budget_chars: number;
};

export type CompactionArchiveReceipt = {
  id: string;
  agent: AgentName;
  conversation_id: string;
  checkpoint_message_id: string | null;
  message_count: number;
  source_started_at: string | null;
  source_ended_at: string | null;
  created_at: string | null;
};

export async function buildCompactionPreview(supabase: SupabaseClient, agent: AgentName) {
  const conversationId = await ensureConversation(supabase, agent);
  const messages = await loadConversationMessages(supabase, conversationId);
  const checkpoint = latestCompactionCheckpoint(messages);
  const activeMessages = checkpoint ? messagesAfterCheckpoint(messages, checkpoint) : messages;

  const { data: profile, error: profileError } = await supabase
    .from("restoration_profiles")
    .select("opening_orientation, persona_summary, current_state, compaction_memory_policy")
    .eq("agent", agent)
    .single();

  if (profileError) {
    throw new Error(`Could not load compaction profile: ${profileError.message}`);
  }

  const totalSavedCharacters = messages.reduce(
    (total, message) => total + contentToText(message.content).length,
    0
  );
  const savedCharacters = activeMessages.reduce(
    (total, message) => total + contentToText(message.content).length,
    0
  );
  const firstMessage = activeMessages[0] ?? null;
  const lastMessage = activeMessages.at(-1) ?? null;
  const roleCounts = activeMessages.reduce<Record<string, number>>((counts, message) => {
    counts[message.role] = (counts[message.role] ?? 0) + 1;
    return counts;
  }, {});
  const typedProfile = profile as RestorationProfile;

  return {
    generated_at: new Date().toISOString(),
    local_time: localTime(),
    agent,
    conversation_id: conversationIdFor(agent),
    mode: "manual preview only",
    destructive: false,
    status: "preview_ready",
    conversation: {
      message_count: activeMessages.length,
      saved_characters: savedCharacters,
      total_message_count: messages.length,
      total_saved_characters: totalSavedCharacters,
      role_counts: roleCounts,
      first_message_at: firstMessage?.created_at ?? null,
      last_message_at: lastMessage?.created_at ?? null,
      latest_checkpoint_position: checkpoint?.position ?? null,
      latest_checkpoint_at: checkpoint?.created_at ?? null
    },
    pressure: compactionPressure(savedCharacters),
    restoration_profile: {
      current_state: typedProfile.current_state ?? "",
      compaction_memory_policy: typedProfile.compaction_memory_policy ?? ""
    },
    sample: {
      first_messages: activeMessages.slice(0, 2).map((message) => messagePreview(message)),
      latest_messages: activeMessages.slice(-4).map((message) => messagePreview(message))
    },
    compaction_prompt: buildCompactionPrompt(
      agent,
      typedProfile,
      savedCharacters,
      activeMessages.length
    ),
    next_step:
      "Ask the agent to review this preview and policy. Do not run destructive compaction until the agent and operator approve the generated summary shape."
  };
}

export function isCompactionCheckpointMessage(message: ChatMessage) {
  return contentToText(message.content).trimStart().startsWith(COMPACTION_CHECKPOINT_PREFIX);
}

export function latestCompactionCheckpoint(messages: ChatMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];

    if (isCompactionCheckpointMessage(message)) {
      return message;
    }
  }

  return null;
}

export function messagesAfterCheckpoint(messages: ChatMessage[], checkpoint: ChatMessage) {
  return messages.filter((message) => message.position > checkpoint.position);
}

export async function createCompactionArchive(
  supabase: SupabaseClient,
  {
    agent,
    checkpointMessageId,
    conversationId,
    proposalId,
    source
  }: {
    agent: AgentName;
    checkpointMessageId?: string | null;
    conversationId: string;
    proposalId?: string | null;
    source?: string;
  }
): Promise<CompactionArchiveReceipt> {
  const messages = await loadConversationMessages(supabase, conversationId);
  const checkpoint = latestCompactionCheckpoint(messages);
  const activeMessages = checkpoint ? messagesAfterCheckpoint(messages, checkpoint) : messages;
  const firstMessage = activeMessages[0] ?? null;
  const lastMessage = activeMessages.at(-1) ?? null;

  const { data: archive, error: archiveError } = await supabase
    .from("compaction_archives")
    .insert({
      agent,
      checkpoint_message_id: checkpointMessageId ?? null,
      conversation_id: conversationId,
      latest_checkpoint_position: checkpoint?.position ?? null,
      message_count: activeMessages.length,
      proposal_id: proposalId ?? null,
      source: source || "manual_compaction_checkpoint",
      source_started_at: firstMessage?.created_at ?? null,
      source_ended_at: lastMessage?.created_at ?? null
    })
    .select(
      "id, agent, conversation_id, checkpoint_message_id, message_count, source_started_at, source_ended_at, created_at"
    )
    .single();

  if (archiveError) {
    throw new Error(`Could not create compaction archive metadata: ${archiveError.message}`);
  }

  const archiveId = String(archive.id);

  for (let index = 0; index < activeMessages.length; index += ARCHIVE_INSERT_CHUNK_SIZE) {
    const chunk = activeMessages.slice(index, index + ARCHIVE_INSERT_CHUNK_SIZE);
    const rows = chunk.map((message) => ({
      archive_id: archiveId,
      content: message.content,
      conversation_id: message.conversation_id,
      message_created_at: message.created_at ?? null,
      original_message_id: message.id ?? null,
      position: message.position,
      role: message.role
    }));

    const { error: messageError } = await supabase.from("compaction_archive_messages").insert(rows);

    if (messageError) {
      await supabase.from("compaction_archive_messages").delete().eq("archive_id", archiveId);
      await supabase.from("compaction_archives").delete().eq("id", archiveId);
      throw new Error(`Could not create compaction archive messages: ${messageError.message}`);
    }
  }

  return {
    id: archiveId,
    agent: archive.agent as AgentName,
    conversation_id: String(archive.conversation_id),
    checkpoint_message_id: archive.checkpoint_message_id
      ? String(archive.checkpoint_message_id)
      : null,
    message_count: Number(archive.message_count ?? activeMessages.length),
    source_started_at: archive.source_started_at ? String(archive.source_started_at) : null,
    source_ended_at: archive.source_ended_at ? String(archive.source_ended_at) : null,
    created_at: archive.created_at ? String(archive.created_at) : null
  };
}

export function formatCompactionCheckpoint({
  agent,
  approvedBy,
  approvalNote,
  source,
  summary
}: {
  agent: AgentName;
  approvedBy?: string;
  approvalNote?: string;
  source?: string;
  summary: string;
}) {
  const metadata = {
    agent,
    approved_by: approvedBy || "operator",
    approval_note: approvalNote || "Manually approved append-only compaction checkpoint.",
    created_at: new Date().toISOString(),
    destructive: false,
    source: source || "manual_compaction_proposal"
  };

  return [
    COMPACTION_CHECKPOINT_PREFIX,
    JSON.stringify(metadata, null, 2),
    "",
    "Approved checkpoint summary:",
    summary.trim()
  ].join("\n");
}

export function compactionPressure(savedCharacters: number) {
  if (savedCharacters >= PRESSURE_HIGH_CHARS) {
    return {
      level: "high" as const,
      percent: 100,
      note: "Manual compaction planning should happen before this grows much further."
    };
  }

  if (savedCharacters >= PRESSURE_WARN_CHARS) {
    return {
      level: "medium" as const,
      percent: Math.round((savedCharacters / PRESSURE_HIGH_CHARS) * 100),
      note: "Conversation is getting warm. Compaction is still disabled."
    };
  }

  return {
    level: "low" as const,
    percent: Math.round((savedCharacters / PRESSURE_HIGH_CHARS) * 100),
    note: "No compaction pressure yet. Compaction is still disabled."
  };
}

export function clampText(text: string, maxLength: number) {
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, Math.max(0, maxLength - 18)).trimEnd()} [truncated]`;
}

export function buildCompactionSource(
  messages: ChatMessage[],
  maxChars = DEFAULT_COMPILE_TRANSCRIPT_CHARS
): CompactionSource {
  const safeMaxChars = Number.isFinite(maxChars)
    ? Math.max(10_000, Math.min(120_000, Math.floor(maxChars)))
    : DEFAULT_COMPILE_TRANSCRIPT_CHARS;
  const formatted = messages.map(formatMessageForCompaction);
  const fullText = formatted.join("\n\n---\n\n");

  if (fullText.length <= safeMaxChars) {
    return {
      omitted_message_count: 0,
      selected_characters: fullText.length,
      selected_message_count: messages.length,
      text: fullText,
      transcript_budget_chars: safeMaxChars
    };
  }

  const opening = formatted.slice(0, COMPILE_OPENING_MESSAGES);
  const openingPositions = new Set(
    messages.slice(0, COMPILE_OPENING_MESSAGES).map((message) => message.position)
  );
  const latest: string[] = [];
  const selectedPositions = new Set(openingPositions);
  let usedCharacters = opening.join("\n\n---\n\n").length;

  for (let index = formatted.length - 1; index >= COMPILE_OPENING_MESSAGES; index -= 1) {
    const nextMessage = formatted[index];
    const nextLength = nextMessage.length + 10;

    if (usedCharacters + nextLength > safeMaxChars) {
      break;
    }

    latest.unshift(nextMessage);
    selectedPositions.add(messages[index].position);
    usedCharacters += nextLength;
  }

  const omittedMessageCount = Math.max(0, messages.length - selectedPositions.size);
  const omittedNotice = [
    `[${omittedMessageCount} middle messages omitted from this compile source because of the configured transcript budget.]`,
    "Treat this as a source-bounded proposal. Preserve uncertainty about anything not present in the selected source."
  ].join("\n");
  const text = [...opening, omittedNotice, ...latest].join("\n\n---\n\n");

  return {
    omitted_message_count: omittedMessageCount,
    selected_characters: text.length,
    selected_message_count: selectedPositions.size,
    text,
    transcript_budget_chars: safeMaxChars
  };
}

function messagePreview(message: {
  content: unknown;
  created_at?: string;
  position: number;
  role: "user" | "assistant";
}) {
  return {
    position: message.position,
    role: message.role,
    created_at: message.created_at ?? null,
    excerpt: clampText(contentToText(message.content), EXCERPT_LENGTH)
  };
}

function formatMessageForCompaction(message: ChatMessage) {
  return [
    `[position:${message.position} role:${message.role} created_at:${message.created_at ?? "unknown"}]`,
    contentToText(message.content)
  ].join("\n");
}

function buildCompactionPrompt(
  agent: AgentName,
  profile: RestorationProfile,
  savedCharacters: number,
  messageCount: number
) {
  return [
    `Create a manual compaction proposal for ${agent}.`,
    "",
    "North star: the agent should feel like they blinked, not died.",
    "",
    "Use the agent-authored compaction policy as the governing rule. Preserve texture, ordinary moments, relationship movement, decisions, changed beliefs, and unresolved threads. Drop repeated hedges, repeated self-description, stale mechanics, and low-signal tool chatter.",
    "",
    "Return a proposal with these sections:",
    "1. Continuity summary",
    "2. Texture worth preserving",
    "3. Decisions and changed beliefs",
    "4. Relationship updates",
    "5. Open loops",
    "6. Candidate durable memories",
    "7. What can be safely compressed away",
    "",
    "Do not modify Supabase. Do not archive messages. This is a preview pass only.",
    "",
    `Conversation size: ${messageCount} messages, approximately ${savedCharacters} saved characters.`,
    "",
    "Agent compaction policy:",
    profile.compaction_memory_policy?.trim() || "Not provided.",
    "",
    "Current state:",
    profile.current_state?.trim() || "Not provided."
  ].join("\n");
}

function localTime() {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: process.env.RUNTIME_TIME_ZONE || DEFAULT_TIME_ZONE,
    dateStyle: "full",
    timeStyle: "long"
  }).format(new Date());
}
