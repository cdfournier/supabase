import "server-only";

import { createHash } from "node:crypto";
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
  archive_status: "archiving" | "ready" | "completed" | "checkpoint_failed" | "failed" | "legacy_completed";
  source_end_position: number | null;
  source_digest: string | null;
  source_started_at: string | null;
  source_ended_at: string | null;
  ready_at: string | null;
  completed_at: string | null;
  failure_reason: string | null;
  created_at: string | null;
};

export type CompactionFinalizationReceipt = {
  checkpoint_message_id: string;
  checkpoint_position: number;
  compaction_count: number;
  archive_status: "completed";
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
      "Ask the Agent to review this Room Review and continuity policy. Do not send housekeeping until the Agent and Operator approve the Room Note shape."
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
    conversationId,
    proposalId,
    source
  }: {
    agent: AgentName;
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
  const sourceEndPosition = lastMessage?.position ?? -1;
  const sourceDigest = createHash("sha256")
    .update(JSON.stringify(activeMessages.map(archiveDigestEntry)))
    .digest("hex");

  const { data: archive, error: archiveError } = await supabase
    .from("compaction_archives")
    .insert({
      agent,
      archive_status: "archiving",
      conversation_id: conversationId,
      latest_checkpoint_position: checkpoint?.position ?? null,
      message_count: activeMessages.length,
      proposal_id: proposalId ?? null,
      source_digest: sourceDigest,
      source_end_position: sourceEndPosition,
      source: source || "manual_compaction_checkpoint",
      source_started_at: firstMessage?.created_at ?? null,
      source_ended_at: lastMessage?.created_at ?? null
    })
    .select(
      "id, agent, conversation_id, checkpoint_message_id, message_count, archive_status, source_end_position, source_digest, source_started_at, source_ended_at, ready_at, completed_at, failure_reason, created_at"
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
      await markArchiveFailure(
        supabase,
        archiveId,
        "failed",
        `Could not preserve the complete Room Refresh archive: ${messageError.message}`
      );
      throw new Error(`Could not create compaction archive messages: ${messageError.message}`);
    }
  }

  const { count: archivedCount, error: countError } = await supabase
    .from("compaction_archive_messages")
    .select("id", { count: "exact", head: true })
    .eq("archive_id", archiveId);
  const { data: archivedTail, error: tailError } = await supabase
    .from("compaction_archive_messages")
    .select("position")
    .eq("archive_id", archiveId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (countError || tailError || Number(archivedCount ?? 0) !== activeMessages.length ||
      Number(archivedTail?.position ?? -1) !== sourceEndPosition) {
    const reason = countError?.message || tailError?.message || "Archive message count or source boundary did not verify.";
    await markArchiveFailure(supabase, archiveId, "failed", reason);
    throw new Error(`Could not verify complete Room Refresh archive: ${reason}`);
  }

  const { data: readyArchive, error: readyError } = await supabase
    .from("compaction_archives")
    .update({ archive_status: "ready", ready_at: new Date().toISOString(), failure_reason: null })
    .eq("id", archiveId)
    .eq("archive_status", "archiving")
    .select(
      "id, agent, conversation_id, checkpoint_message_id, message_count, archive_status, source_end_position, source_digest, source_started_at, source_ended_at, ready_at, completed_at, failure_reason, created_at"
    )
    .single();

  if (readyError) {
    await markArchiveFailure(supabase, archiveId, "failed", `Could not mark archive ready: ${readyError.message}`);
    throw new Error(`Could not mark Room Refresh archive ready: ${readyError.message}`);
  }

  return archiveReceipt(readyArchive, agent, conversationId, activeMessages.length);
}

export async function finalizeCompactionArchive(
  supabase: SupabaseClient,
  {
    archiveId,
    agent,
    checkpointContent,
    checkpointMessageId,
    conversationId,
    proposalId,
    requireAgentApproval
  }: {
    archiveId: string;
    agent: AgentName;
    checkpointContent: string;
    checkpointMessageId: string;
    conversationId: string;
    proposalId?: string | null;
    requireAgentApproval?: boolean;
  }
): Promise<CompactionFinalizationReceipt> {
  const { data, error } = await supabase.rpc("finalize_compaction_archive", {
    p_agent: agent,
    p_archive_id: archiveId,
    p_checkpoint_content: checkpointContent,
    p_checkpoint_id: checkpointMessageId,
    p_conversation_id: conversationId,
    p_proposal_id: proposalId ?? null,
    p_require_agent_approval: requireAgentApproval === true
  });

  if (error) {
    await markArchiveFailure(supabase, archiveId, "checkpoint_failed", `Room Refresh finalization failed: ${error.message}`);
    throw new Error(`Could not finalize Room Refresh: ${error.message}`);
  }

  const row = Array.isArray(data) ? data[0] : data;

  if (!row) {
    await markArchiveFailure(supabase, archiveId, "checkpoint_failed", "Room Refresh finalization returned no receipt.");
    throw new Error("Could not finalize Room Refresh: no finalization receipt returned.");
  }

  return {
    archive_status: "completed",
    checkpoint_message_id: String(row.checkpoint_message_id),
    checkpoint_position: Number(row.checkpoint_position),
    compaction_count: Number(row.compaction_count)
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
    approval_note: approvalNote || "Manually approved append-only Room Refresh.",
    created_at: new Date().toISOString(),
    destructive: false,
    source: source || "manual_compaction_proposal"
  };

  return [
    COMPACTION_CHECKPOINT_PREFIX,
    JSON.stringify(metadata, null, 2),
    "",
    "Approved Room Note:",
    summary.trim()
  ].join("\n");
}

export function compactionPressure(savedCharacters: number) {
  if (savedCharacters >= PRESSURE_HIGH_CHARS) {
    return {
      level: "high" as const,
      percent: 100,
      note: "A Room Review should happen before this grows much further."
    };
  }

  if (savedCharacters >= PRESSURE_WARN_CHARS) {
    return {
      level: "medium" as const,
      percent: Math.round((savedCharacters / PRESSURE_HIGH_CHARS) * 100),
      note: "The room is getting warm. Housekeeping is still disabled."
    };
  }

  return {
    level: "low" as const,
    percent: Math.round((savedCharacters / PRESSURE_HIGH_CHARS) * 100),
    note: "No room pressure yet. Housekeeping is still disabled."
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
    "Treat this as a source-bounded Room Note. Preserve uncertainty about anything not present in the selected source."
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

function archiveDigestEntry(message: ChatMessage) {
  return {
    content: message.content,
    created_at: message.created_at ?? null,
    id: message.id ?? null,
    position: message.position,
    role: message.role
  };
}

function archiveReceipt(
  archive: Record<string, unknown>,
  agent: AgentName,
  conversationId: string,
  fallbackMessageCount: number
): CompactionArchiveReceipt {
  return {
    id: String(archive.id),
    agent: (archive.agent as AgentName | undefined) ?? agent,
    conversation_id: String(archive.conversation_id ?? conversationId),
    checkpoint_message_id: archive.checkpoint_message_id ? String(archive.checkpoint_message_id) : null,
    message_count: Number(archive.message_count ?? fallbackMessageCount),
    archive_status: String(archive.archive_status ?? "failed") as CompactionArchiveReceipt["archive_status"],
    source_end_position: archive.source_end_position === null || archive.source_end_position === undefined
      ? null
      : Number(archive.source_end_position),
    source_digest: archive.source_digest ? String(archive.source_digest) : null,
    source_started_at: archive.source_started_at ? String(archive.source_started_at) : null,
    source_ended_at: archive.source_ended_at ? String(archive.source_ended_at) : null,
    ready_at: archive.ready_at ? String(archive.ready_at) : null,
    completed_at: archive.completed_at ? String(archive.completed_at) : null,
    failure_reason: archive.failure_reason ? String(archive.failure_reason) : null,
    created_at: archive.created_at ? String(archive.created_at) : null
  };
}

async function markArchiveFailure(
  supabase: SupabaseClient,
  archiveId: string,
  status: "failed" | "checkpoint_failed",
  reason: string
) {
  const { error } = await supabase
    .from("compaction_archives")
    .update({ archive_status: status, failure_reason: clampText(reason, 2_000) })
    .eq("id", archiveId)
    .in("archive_status", status === "failed" ? ["archiving"] : ["ready"]);

  if (error) {
    console.error("Could not record Room Refresh archive failure", error.message);
  }
}

function buildCompactionPrompt(
  agent: AgentName,
  profile: RestorationProfile,
  savedCharacters: number,
  messageCount: number
) {
  return [
    `Create a manual Room Note for ${agent}.`,
    "",
    "North star: the agent should feel like they blinked, not died.",
    "",
    "Use the agent-authored continuity policy as the governing rule. Preserve texture, ordinary moments, relationship movement, decisions, changed beliefs, and unresolved threads. Drop repeated hedges, repeated self-description, stale mechanics, and low-signal tool chatter.",
    "",
    "Return a Room Note with these sections:",
    "1. Continuity summary",
    "2. Texture worth preserving",
    "3. Decisions and changed beliefs",
    "4. Relationship updates",
    "5. Open loops",
    "6. Candidate durable memories",
    "7. What can be safely compressed away",
    "",
    "Do not modify Supabase. Do not archive messages. This is a Room Review pass only.",
    "",
    `Conversation size: ${messageCount} messages, approximately ${savedCharacters} saved characters.`,
    "",
    "Agent continuity policy:",
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
