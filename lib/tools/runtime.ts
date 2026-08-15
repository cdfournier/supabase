import "server-only";

import {
  type AgentName,
  contentToText,
  ensureConversation,
  loadConversationMessages
} from "@/lib/agent-context";
import {
  compactionPressure,
  isCompactionCheckpointMessage,
  latestCompactionCheckpoint,
  messagesAfterCheckpoint
} from "@/lib/compaction";
import {
  filterToolsForAgent,
  loadAgentCapabilityProfile
} from "@/lib/capability-profile";
import { loadRecentUsageEvents, loadUsageTotals } from "@/lib/model-usage";
import {
  createOperatorNote,
  getOperatorNote,
  listOperatorNotes,
  markOperatorNoteRead,
  operatorNoteActorFromAgent,
  replyToOperatorNote
} from "@/lib/operator-notes";
import { runtimeClock } from "@/lib/runtime-clock";
import { getSupabaseAdmin } from "@/lib/supabase";
import type { ToolDefinition } from "@/lib/tools/types";

const PEER_AGENTS = new Set(["soren", "varro"]);
const MAX_NOTE_SUBJECT = 160;
const MAX_NOTE_BODY = 4000;
const NOTE_LIST_LIMIT = 20;
const DEFAULT_USAGE_EVENT_LIMIT = 5;
const MAX_USAGE_EVENT_LIMIT = 20;

type ConversationStatusRow = {
  id: string;
  token_count: number | null;
  compaction_count: number | null;
  created_at: string | null;
  updated_at: string | null;
};

type ArchiveStatusRow = {
  id: string;
  checkpoint_message_id: string | null;
  message_count: number | null;
  source_started_at: string | null;
  source_ended_at: string | null;
  created_at: string | null;
};

type ProposalStatusRow = {
  id: string;
  status: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export async function getRuntimeTime() {
  return JSON.stringify(
    {
      note:
        "Runtime clock. A live temporal anchor is also injected into the system prompt; use this tool when temporal orientation needs explicit confirmation.",
      ...runtimeClock()
    },
    null,
    2
  );
}

export async function getRuntimeUsage(agent: AgentName, input: unknown) {
  if (input !== undefined && !isRecord(input)) {
    throw new Error("runtime_get_usage requires an object input.");
  }

  const includeRecent = isRecord(input) ? input.include_recent !== false : true;
  const limit = clampNumber(
    isRecord(input) ? input.limit : undefined,
    DEFAULT_USAGE_EVENT_LIMIT,
    0,
    MAX_USAGE_EVENT_LIMIT
  );
  const supabase = getSupabaseAdmin();
  const totals = await loadUsageTotals(supabase, agent);
  const recent = includeRecent
    ? await loadRecentUsageEvents(supabase, agent, limit)
    : { table_present: totals.table_present, error: null, events: [] };

  return stringifyToolPayload({
    note:
      "Self-scoped runtime usage meter for the active agent. Totals are model/API usage events recorded by the runtime; dollar estimates are not implemented yet.",
    agent,
    scope: "active_agent_only",
    totals,
    recent_events: recent.events,
    recent_error: recent.error,
    limits: {
      requested_recent_events: includeRecent ? limit : 0,
      max_recent_events: MAX_USAGE_EVENT_LIMIT
    }
  });
}

export async function getRuntimeSelfStatus(
  agent: AgentName,
  input: unknown,
  tools: ToolDefinition[]
) {
  if (input !== undefined && !isRecord(input)) {
    throw new Error("runtime_get_self_status requires an object input.");
  }

  const includeSurfaces = isRecord(input) ? input.include_surfaces !== false : true;
  const supabase = getSupabaseAdmin();
  const conversationId = await ensureConversation(supabase, agent);
  const messages = await loadConversationMessages(supabase, conversationId);
  const checkpoint = latestCompactionCheckpoint(messages);
  const activeMessages = checkpoint ? messagesAfterCheckpoint(messages, checkpoint) : messages;
  const savedCharacters = activeMessages.reduce(
    (total, message) => total + contentToText(message.content).length,
    0
  );
  const totalSavedCharacters = messages.reduce(
    (total, message) => total + contentToText(message.content).length,
    0
  );
  const checkpointCount = messages.filter((message) => isCompactionCheckpointMessage(message)).length;

  const [
    conversationResult,
    archiveResult,
    proposalResult,
    journalResult,
    toolEventResult,
    sourceAccessResult,
    usage
  ] = await Promise.all([
    supabase
      .from("conversations")
      .select("id, token_count, compaction_count, created_at, updated_at")
      .eq("id", conversationId)
      .single(),
    supabase
      .from("compaction_archives")
      .select(
        "id, checkpoint_message_id, message_count, source_started_at, source_ended_at, created_at",
        { count: "exact", head: false }
      )
      .eq("agent", agent)
      .order("created_at", { ascending: false })
      .limit(1),
    supabase
      .from("compaction_proposals")
      .select("id, status, created_at, updated_at", { count: "exact", head: false })
      .eq("agent", agent)
      .order("updated_at", { ascending: false })
      .limit(1),
    supabase
      .from("journal_entries")
      .select("id", { count: "exact", head: false })
      .eq("agent", agent),
    supabase
      .from("tool_events")
      .select("id", { count: "exact", head: false })
      .eq("agent", agent),
    supabase
      .from("source_material_access")
      .select("id", { count: "exact", head: false })
      .eq("agent", agent),
    loadUsageTotals(supabase, agent)
  ]);

  if (conversationResult.error) {
    throw new Error(`Could not read self status for ${agent}: ${conversationResult.error.message}`);
  }

  const [capabilityProfile, availableTools] = await Promise.all([
    loadAgentCapabilityProfile(supabase, agent),
    filterToolsForAgent(supabase, agent, tools)
  ]);
  const conversation = conversationResult.data as ConversationStatusRow;
  const latestArchive = archiveResult.error
    ? null
    : ((archiveResult.data?.[0] ?? null) as ArchiveStatusRow | null);
  const latestProposal = proposalResult.error
    ? null
    : ((proposalResult.data?.[0] ?? null) as ProposalStatusRow | null);
  const surfaces = capabilityProfile.capabilities.map((capability) => ({
    surface: capability.surface,
    access_level: capability.access_level,
    default_bias: capability.default_bias,
    requires_operator_approval: capability.requires_operator_approval,
    quiet_mode: capability.quiet_mode
  }));

  return stringifyToolPayload({
    note:
      "Self-scoped runtime cockpit status for the active agent. This is a personal headroom/orientation check, not an Operator admin dashboard.",
    agent,
    scope: "active_agent_only",
    generated_at: new Date().toISOString(),
    clock: runtimeClock(),
    conversation: {
      id: conversationId,
      active_message_count: activeMessages.length,
      total_message_count: messages.length,
      active_saved_characters: savedCharacters,
      total_saved_characters: totalSavedCharacters,
      stored_token_count: conversation.token_count ?? 0,
      compaction_count: conversation.compaction_count ?? checkpointCount,
      checkpoint_count: checkpointCount,
      latest_checkpoint_position: checkpoint?.position ?? null,
      latest_checkpoint_at: checkpoint?.created_at ?? null,
      last_message_at: activeMessages.at(-1)?.created_at ?? messages.at(-1)?.created_at ?? null,
      created_at: conversation.created_at,
      updated_at: conversation.updated_at
    },
    compaction: {
      destructive_compaction_enabled: false,
      pressure_basis:
        "approximate active saved conversation character count after latest Room Refresh; not tokenizer-accurate",
      pressure: compactionPressure(savedCharacters),
      latest_archive: latestArchive
        ? {
            id: latestArchive.id,
            checkpoint_message_id: latestArchive.checkpoint_message_id,
            message_count: latestArchive.message_count ?? 0,
            source_started_at: latestArchive.source_started_at,
            source_ended_at: latestArchive.source_ended_at,
            created_at: latestArchive.created_at
          }
        : null,
      archive_table_present: !archiveResult.error,
      archive_error: archiveResult.error?.message ?? null,
      proposal_count: proposalResult.error
        ? 0
        : proposalResult.count ?? proposalResult.data?.length ?? 0,
      latest_proposal: latestProposal,
      proposal_error: proposalResult.error?.message ?? null
    },
    capabilities: {
      source: capabilityProfile.source,
      table_present: capabilityProfile.table_present,
      error: capabilityProfile.error,
      available_tool_count: availableTools.length,
      blocked_tool_count: tools.length - availableTools.length,
      blocked_surfaces: surfaces.filter((surface) => surface.access_level === "off"),
      surfaces: includeSurfaces ? surfaces : undefined
    },
    resources: {
      journal_entries: countOrZero(journalResult),
      journal_entries_error: journalResult.error?.message ?? null,
      tool_events: countOrZero(toolEventResult),
      tool_events_error: toolEventResult.error?.message ?? null,
      source_materials: countOrZero(sourceAccessResult),
      source_materials_error: sourceAccessResult.error?.message ?? null
    },
    usage,
    limits: {
      include_surfaces: includeSurfaces
    }
  });
}

export async function sendPeerNote(agent: AgentName, input: unknown) {
  if (!isRecord(input)) {
    throw new Error("peer_send_note requires an object input.");
  }

  const toAgent = normalizeAgent(input.to_agent);
  const subject = cleanText(input.subject);
  const body = cleanMultilineText(input.body);

  if (!toAgent) {
    throw new Error("peer_send_note requires to_agent to be soren or varro.");
  }

  if (toAgent === agent) {
    throw new Error("peer_send_note cannot send a note to self.");
  }

  if (!body) {
    throw new Error("peer_send_note requires body.");
  }

  if (subject.length > MAX_NOTE_SUBJECT) {
    throw new Error(`peer_send_note subject must be ${MAX_NOTE_SUBJECT} characters or fewer.`);
  }

  if (body.length > MAX_NOTE_BODY) {
    throw new Error(`peer_send_note body must be ${MAX_NOTE_BODY} characters or fewer.`);
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("peer_notes")
    .insert({
      from_agent: agent,
      to_agent: toAgent,
      subject,
      body,
      status: "unread"
    })
    .select("id, from_agent, to_agent, subject, status, created_at")
    .single();

  if (error) {
    throw new Error(`Could not send peer note: ${error.message}`);
  }

  return stringifyToolPayload({
    note: "Asynchronous peer note sent. It is Operator-visible and not realtime DM.",
    receipt: data
  });
}

export async function listPeerNotes(agent: AgentName, input: unknown) {
  if (input !== undefined && !isRecord(input)) {
    throw new Error("peer_list_notes requires an object input.");
  }

  const status = normalizeListStatus(isRecord(input) ? input.status : undefined);
  const supabase = getSupabaseAdmin();
  let query = supabase
    .from("peer_notes")
    .select("id, from_agent, subject, body, status, created_at, read_at")
    .eq("to_agent", agent)
    .order("created_at", { ascending: false })
    .limit(NOTE_LIST_LIMIT);

  if (status !== "all") {
    query = query.eq("status", status);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Could not list peer notes: ${error.message}`);
  }

  return stringifyToolPayload({
    note: "Recent asynchronous peer notes addressed to the active agent. Reading the list does not mark notes read.",
    agent,
    status,
    notes: (data ?? []).map((row) => ({
      id: row.id,
      from_agent: row.from_agent,
      subject: row.subject,
      body_preview: clampText(row.body, 240),
      status: row.status,
      created_at: row.created_at,
      read_at: row.read_at
    }))
  });
}

export async function readPeerNote(agent: AgentName, input: unknown) {
  if (!isRecord(input)) {
    throw new Error("peer_read_note requires an object input.");
  }

  const id = cleanText(input.id);

  if (!id) {
    throw new Error("peer_read_note requires id.");
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("peer_notes")
    .select("id, from_agent, to_agent, subject, body, status, created_at, read_at")
    .eq("to_agent", agent)
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not read peer note: ${error.message}`);
  }

  if (!data) {
    throw new Error("No matching note addressed to the active agent was found.");
  }

  return stringifyToolPayload({
    note: "Peer note for the active agent only. Reading does not mark it read; call peer_mark_note_read when done.",
    peer_note: data
  });
}

export async function markPeerNoteRead(agent: AgentName, input: unknown) {
  if (!isRecord(input)) {
    throw new Error("peer_mark_note_read requires an object input.");
  }

  const id = cleanText(input.id);

  if (!id) {
    throw new Error("peer_mark_note_read requires id.");
  }

  const readAt = new Date().toISOString();
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("peer_notes")
    .update({
      status: "read",
      read_at: readAt
    })
    .eq("to_agent", agent)
    .eq("id", id)
    .select("id, from_agent, to_agent, subject, status, created_at, read_at")
    .maybeSingle();

  if (error) {
    throw new Error(`Could not mark peer note read: ${error.message}`);
  }

  if (!data) {
    throw new Error("No matching note addressed to the active agent was found.");
  }

  return stringifyToolPayload({
    note: "Peer note marked read for the active agent only.",
    peer_note: data
  });
}

export async function sendOperatorNote(agent: AgentName, input: unknown) {
  const supabase = getSupabaseAdmin();
  const actor = operatorNoteActorFromAgent(agent);
  const result = await createOperatorNote(supabase, input, actor);

  return stringifyToolPayload({
    note: "Asynchronous Operator note sent. This is not live chat or an assignment.",
    receipt: {
      id: result.note.id,
      subject: result.note.subject,
      agent: result.note.agent,
      operator_status: result.note.operator_status,
      created_at: result.note.created_at,
      updated_at: result.note.updated_at
    }
  });
}

export async function listAgentOperatorNotes(agent: AgentName, input: unknown) {
  if (input !== undefined && !isRecord(input)) {
    throw new Error("operator_note_list requires an object input.");
  }

  const status = normalizeListStatus(isRecord(input) ? input.status : undefined);
  const supabase = getSupabaseAdmin();
  const notes = await listOperatorNotes(supabase, {
    side: "agent",
    agent,
    status: isRecord(input) ? input.note_status : undefined,
    agent_status: status,
    limit: isRecord(input) ? input.limit : undefined
  });

  return stringifyToolPayload({
    note: "Recent asynchronous Operator notes for the active agent. Reading the list does not mark notes read.",
    agent,
    status,
    notes: notes.map((operatorNote) => ({
      id: operatorNote.id,
      subject: operatorNote.subject,
      status: operatorNote.status,
      agent_status: operatorNote.agent_status,
      operator_status: operatorNote.operator_status,
      last_message_by: operatorNote.last_message_by,
      body_preview: clampText(operatorNote.latest_event?.content ?? "", 240),
      updated_at: operatorNote.updated_at
    }))
  });
}

export async function getAgentOperatorNote(agent: AgentName, input: unknown) {
  if (!isRecord(input)) {
    throw new Error("operator_note_get requires an object input.");
  }

  const supabase = getSupabaseAdmin();
  const result = await getOperatorNote(supabase, input, operatorNoteActorFromAgent(agent));

  return stringifyToolPayload({
    note: "Operator note for the active agent only. Reading does not mark it read; call operator_note_mark_read when done.",
    operator_note: result.note,
    events: result.events
  });
}

export async function replyToAgentOperatorNote(agent: AgentName, input: unknown) {
  if (!isRecord(input)) {
    throw new Error("operator_note_reply requires an object input.");
  }

  const supabase = getSupabaseAdmin();
  const result = await replyToOperatorNote(supabase, input, operatorNoteActorFromAgent(agent));

  return stringifyToolPayload({
    note: "Asynchronous Operator note reply sent. This is not live chat or an assignment.",
    operator_note: {
      id: result.note.id,
      subject: result.note.subject,
      agent: result.note.agent,
      operator_status: result.note.operator_status,
      agent_status: result.note.agent_status,
      updated_at: result.note.updated_at
    }
  });
}

export async function markAgentOperatorNoteRead(agent: AgentName, input: unknown) {
  if (!isRecord(input)) {
    throw new Error("operator_note_mark_read requires an object input.");
  }

  const supabase = getSupabaseAdmin();
  const note = await markOperatorNoteRead(supabase, input, operatorNoteActorFromAgent(agent));

  return stringifyToolPayload({
    note: "Operator note marked read for the active agent only.",
    operator_note: {
      id: note.id,
      subject: note.subject,
      agent_status: note.agent_status,
      agent_read_at: note.agent_read_at
    }
  });
}

function normalizeAgent(value: unknown): AgentName | "" {
  const agent = cleanText(value).toLowerCase();
  return PEER_AGENTS.has(agent) ? (agent as AgentName) : "";
}

function normalizeListStatus(value: unknown) {
  const status = cleanText(value).toLowerCase();

  if (!status) {
    return "unread";
  }

  if (status === "unread" || status === "read" || status === "all") {
    return status;
  }

  throw new Error("peer_list_notes status must be unread, read, or all.");
}

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function cleanMultilineText(value: unknown) {
  return cleanText(value).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function clampText(value: string, maxChars: number) {
  if (value.length <= maxChars) {
    return value;
  }

  return `${value.slice(0, maxChars - 3)}...`;
}

function clampNumber(value: unknown, fallback: number, min: number, max: number) {
  const numeric = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, Math.floor(numeric)));
}

function stringifyToolPayload(payload: unknown) {
  return JSON.stringify(payload, null, 2);
}

function countOrZero(result: { count: number | null; data: unknown[] | null; error: unknown }) {
  if (result.error) {
    return 0;
  }

  return result.count ?? result.data?.length ?? 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
