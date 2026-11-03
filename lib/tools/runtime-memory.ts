import "server-only";

import { ensureConversation, type AgentName } from "@/lib/agent-context";
import { compileCompactionProposal } from "@/lib/compaction-compile";
import {
  buildCompactionPreview,
  createCompactionArchive,
  finalizeCompactionArchive,
  formatCompactionCheckpoint
} from "@/lib/compaction";
import { randomUUID } from "node:crypto";
import { getSupabaseAdmin } from "@/lib/supabase";

type JsonRecord = Record<string, unknown>;

const MAX_MEMORY_CONTENT = 2200;
const MAX_RELATIONSHIP_SUMMARY = 2400;
const MAX_CURRENT_STATE = 6000;
const MAX_PROPOSAL_TEXT = 30_000;
const MAX_PROPOSAL_NOTES = 4000;

export async function getRuntimeProfile(agent: AgentName) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("restoration_profiles")
    .select("agent, opening_orientation, persona_summary, current_state, compaction_memory_policy, updated_at")
    .eq("agent", agent)
    .single();

  if (error) {
    throw new Error(`Could not read restoration profile: ${error.message}`);
  }

  return stringifyToolPayload({
    note: "Restoration profile for the active agent only.",
    profile: data
  });
}

export async function listRuntimeMemories(agent: AgentName, input: unknown) {
  const includeInactive = isRecord(input) && input.include_inactive === true;
  const limit = clampNumber(isRecord(input) ? input.limit : undefined, 20, 1, 50);
  const supabase = getSupabaseAdmin();

  let query = supabase
    .from("memories")
    .select("id, content, memory_type, weight, is_core, is_active, tags, created_at")
    .eq("agent", agent)
    .order("is_core", { ascending: false })
    .order("weight", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);

  if (!includeInactive) {
    query = query.eq("is_active", true);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Could not list memories: ${error.message}`);
  }

  return stringifyToolPayload({
    note: "Runtime memories for the active agent only.",
    agent,
    memories: data ?? []
  });
}

export async function addRuntimeMemory(agent: AgentName, input: unknown) {
  if (!isRecord(input)) {
    throw new Error("supabase_add_memory requires an object input.");
  }

  const content = cleanText(input.content);
  const commitmentReason = cleanText(input.commitment_reason);
  const memoryType = cleanText(input.memory_type) || "observation";
  const weight = clampNumber(input.weight, 5, 1, 10);
  const isCore = input.is_core === true;
  const tags = parseTags(input.tags);

  if (!content) {
    throw new Error("supabase_add_memory requires content.");
  }

  if (!commitmentReason) {
    throw new Error("supabase_add_memory requires commitment_reason.");
  }

  if (content.length > MAX_MEMORY_CONTENT) {
    throw new Error(`supabase_add_memory content must be ${MAX_MEMORY_CONTENT} characters or fewer.`);
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("memories")
    .insert({
      agent,
      content,
      memory_type: memoryType,
      weight,
      is_core: isCore,
      is_active: true,
      tags
    })
    .select("id, agent, content, memory_type, weight, is_core, is_active, tags, created_at")
    .single();

  if (error) {
    throw new Error(`Could not add memory: ${error.message}`);
  }

  return stringifyToolPayload({
    note: "Memory added for the active agent only.",
    commitment_reason: commitmentReason,
    memory: data
  });
}

export async function archiveRuntimeMemory(agent: AgentName, input: unknown) {
  if (!isRecord(input)) {
    throw new Error("supabase_archive_memory requires an object input.");
  }

  const memoryId = cleanText(input.memory_id);
  const reason = cleanText(input.reason);

  if (!memoryId) {
    throw new Error("supabase_archive_memory requires memory_id.");
  }

  if (!reason) {
    throw new Error("supabase_archive_memory requires reason.");
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("memories")
    .update({ is_active: false })
    .eq("agent", agent)
    .eq("id", memoryId)
    .select("id, agent, content, memory_type, weight, is_core, is_active, tags, created_at")
    .maybeSingle();

  if (error) {
    throw new Error(`Could not archive memory: ${error.message}`);
  }

  if (!data) {
    throw new Error("No matching active-agent memory found to archive.");
  }

  return stringifyToolPayload({
    note: "Memory archived for the active agent only.",
    reason,
    memory: data
  });
}

export async function listRuntimeRelationships(agent: AgentName, input: unknown) {
  const limit = clampNumber(isRecord(input) ? input.limit : undefined, 30, 1, 100);
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("relationships")
    .select("id, agent, about, summary, updated_at")
    .eq("agent", agent)
    .order("about", { ascending: true })
    .limit(limit);

  if (error) {
    throw new Error(`Could not list relationships: ${error.message}`);
  }

  return stringifyToolPayload({
    note: "Runtime relationship rows for the active agent only.",
    agent,
    relationships: data ?? []
  });
}

export async function upsertRuntimeRelationship(agent: AgentName, input: unknown) {
  if (!isRecord(input)) {
    throw new Error("supabase_upsert_relationship requires an object input.");
  }

  const about = normalizeRelationshipKey(input.about);
  const summary = cleanText(input.summary);
  const reason = cleanText(input.reason);

  if (!about) {
    throw new Error("supabase_upsert_relationship requires about.");
  }

  if (!summary) {
    throw new Error("supabase_upsert_relationship requires summary.");
  }

  if (summary.length > MAX_RELATIONSHIP_SUMMARY) {
    throw new Error(
      `supabase_upsert_relationship summary must be ${MAX_RELATIONSHIP_SUMMARY} characters or fewer.`
    );
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("relationships")
    .upsert(
      {
        agent,
        about,
        summary,
        updated_at: new Date().toISOString()
      },
      { onConflict: "agent,about" }
    )
    .select("id, agent, about, summary, updated_at")
    .single();

  if (error) {
    throw new Error(`Could not upsert relationship: ${error.message}`);
  }

  return stringifyToolPayload({
    note: "Relationship summary upserted for the active agent only.",
    reason: reason || null,
    relationship: data
  });
}

export async function updateRuntimeCurrentState(agent: AgentName, input: unknown) {
  if (!isRecord(input)) {
    throw new Error("supabase_update_current_state requires an object input.");
  }

  const currentState = cleanMultilineText(input.current_state);
  const reason = cleanText(input.reason);

  if (!currentState) {
    throw new Error("supabase_update_current_state requires current_state.");
  }

  if (!reason) {
    throw new Error("supabase_update_current_state requires reason.");
  }

  if (currentState.length > MAX_CURRENT_STATE) {
    throw new Error(
      `supabase_update_current_state current_state must be ${MAX_CURRENT_STATE} characters or fewer.`
    );
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("restoration_profiles")
    .update({
      current_state: currentState,
      updated_at: new Date().toISOString()
    })
    .eq("agent", agent)
    .select("agent, current_state, updated_at")
    .single();

  if (error) {
    throw new Error(`Could not update current state: ${error.message}`);
  }

  return stringifyToolPayload({
    note:
      "Current state updated for the active Agent only. This is the living handoff field for meaningful sessions, major state changes, and pre-Room Review orientation; use care-language for visible process names, and treat the live runtime clock as authoritative for today/now.",
    reason,
    profile: data
  });
}

export async function compileRuntimeCompactionProposal(agent: AgentName, input: unknown) {
  if (input !== undefined && !isRecord(input)) {
    throw new Error("supabase_compile_compaction_proposal requires an object input.");
  }

  const proposal = await compileCompactionProposal({
    agent,
    dryRun: isRecord(input) && input.dry_run === true,
    maxChars: isRecord(input) ? input.max_chars : undefined,
    maxTokens: isRecord(input) ? input.max_tokens : undefined,
    requestSource: "agent_tool_compaction_compile"
  });

  return stringifyToolPayload({
    note:
      "Non-destructive Room Note for the active Agent only. Nothing was archived, refreshed, deleted, replaced, or modified.",
    proposal
  });
}

export async function prepareRuntimeRoomReview(agent: AgentName) {
  const supabase = getSupabaseAdmin();
  const [preview, profileResult, memoriesResult] = await Promise.all([
    buildCompactionPreview(supabase, agent),
    supabase
      .from("restoration_profiles")
      .select("current_state, updated_at")
      .eq("agent", agent)
      .single(),
    supabase
      .from("memories")
      .select("id, content, memory_type, weight, is_core, updated_at:created_at")
      .eq("agent", agent)
      .eq("is_active", true)
      .order("is_core", { ascending: false })
      .order("weight", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(12)
  ]);

  if (profileResult.error) {
    throw new Error(`Could not prepare Room Review current state: ${profileResult.error.message}`);
  }
  if (memoriesResult.error) {
    throw new Error(`Could not prepare Room Review memories: ${memoriesResult.error.message}`);
  }

  return stringifyToolPayload({
    note:
      "Room Review preflight for the active Agent only. This is the required pause before compiling: inspect your current state and durable memories, then update either only if an honest, deliberate revision is needed. The updates are optional; the review itself is not.",
    preflight: {
      completed_at: new Date().toISOString(),
      conversation: preview.conversation,
      current_state: profileResult.data?.current_state ?? "",
      current_state_updated_at: profileResult.data?.updated_at ?? null,
      memories: memoriesResult.data ?? [],
      review_checklist: [
        "Read the current state and ask whether it still describes the handoff honestly.",
        "Review durable memories for anything stale, missing, or too certain.",
        "Use the appropriate self-scoped memory or current-state tool only if a deliberate update is warranted.",
        "Then compile a Room Note; preserve uncertainty rather than inventing continuity."
      ]
    }
  });
}

export async function compileAndSaveRuntimeCompactionProposal(agent: AgentName, input: unknown) {
  if (input !== undefined && !isRecord(input)) {
    throw new Error("supabase_compile_and_save_compaction_proposal requires an object input.");
  }

  const compiled = await compileCompactionProposal({
    agent,
    dryRun: false,
    maxChars: isRecord(input) ? input.max_chars : undefined,
    maxTokens: isRecord(input) ? input.max_tokens : undefined,
    requestSource: "agent_tool_compaction_compile"
  });

  const proposal = "proposal" in compiled ? cleanMultilineText(compiled.proposal) : "";

  if (!proposal) {
    throw new Error("Compiled Room Note did not return note text.");
  }

  const agentNotes =
    isRecord(input) && input.agent_notes !== undefined
      ? cleanMultilineText(input.agent_notes)
      : "Compiled and saved directly by the runtime to avoid large inter-tool proposal forwarding.";
  const sourceSummary = isRecord(compiled.source) ? compiled.source : {};
  const saved = await insertCompactionProposal(agent, {
    proposal,
    sourceSummary,
    agentNotes,
    status: "draft"
  });

  return stringifyToolPayload({
    note:
      "Compiled and saved a non-destructive Room Note for the active Agent only. This is not a Room Refresh and does not change active context.",
    saved_proposal: proposalSummary(saved),
    proposal_preview: clampText(proposal, 1600),
    next_step:
      "Read the saved Room Note by id, review it, then update notes or status when ready."
  });
}

export async function saveRuntimeCompactionProposal(agent: AgentName, input: unknown) {
  if (!isRecord(input)) {
    throw new Error("supabase_save_compaction_proposal requires an object input.");
  }

  const proposal = cleanMultilineText(input.proposal);
  const agentNotes = cleanMultilineText(input.agent_notes);
  const sourceSummary = isRecord(input.source_summary) ? input.source_summary : {};

  if (!proposal) {
    throw new Error("supabase_save_compaction_proposal requires a Room Note in proposal.");
  }

  validateProposalText(proposal);
  validateProposalNotes(agentNotes);

  const data = await insertCompactionProposal(agent, {
    proposal,
    sourceSummary,
    agentNotes,
    status: "draft"
  });

  return stringifyToolPayload({
    note:
      "Room Note draft saved for the active Agent only. This is not a Room Refresh and does not change active context.",
    proposal: data
  });
}

export async function updateRuntimeCompactionProposal(agent: AgentName, input: unknown) {
  if (!isRecord(input)) {
    throw new Error("supabase_update_compaction_proposal requires an object input.");
  }

  const proposalId = cleanText(input.proposal_id);
  const proposal = input.proposal === undefined ? undefined : cleanMultilineText(input.proposal);
  const agentNotes =
    input.agent_notes === undefined ? undefined : cleanMultilineText(input.agent_notes);
  const status = input.status === undefined ? undefined : normalizeProposalStatus(input.status);
  const changeReason = cleanText(input.change_reason);
  const patch: Record<string, unknown> = {};

  if (!proposalId) {
    throw new Error("supabase_update_compaction_proposal requires proposal_id.");
  }

  if (proposal !== undefined) {
    if (!proposal) {
      throw new Error("supabase_update_compaction_proposal proposal cannot be empty.");
    }

    validateProposalText(proposal);
    patch.proposal = proposal;
  }

  if (agentNotes !== undefined) {
    validateProposalNotes(agentNotes);
    patch.agent_notes = agentNotes || null;
  }

  if (status !== undefined) {
    patch.status = status;
  }

  if (Object.keys(patch).length === 0) {
    throw new Error("supabase_update_compaction_proposal requires proposal, agent_notes, or status.");
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc("revise_compaction_proposal", {
    p_agent: agent,
    p_agent_notes: patch.agent_notes ?? null,
    p_change_reason: changeReason || "Agent revised the Room Note.",
    p_proposal: patch.proposal ?? null,
    p_proposal_id: proposalId,
    p_status: patch.status ?? null
  });

  if (error) {
    throw new Error(`Could not update Room Note: ${error.message}`);
  }

  const revised = Array.isArray(data) ? data[0] : data;
  if (!revised) {
    throw new Error("No matching active-Agent Room Note found.");
  }

  return stringifyToolPayload({
    note:
      "Room Note draft updated for the active Agent only. This is not a Room Refresh and does not change active context.",
    proposal: revised,
    revision: {
      number: Number(revised.revision_number),
      preserved: true
    }
  });
}

export async function listRuntimeCompactionProposals(agent: AgentName, input: unknown) {
  const limit = clampNumber(isRecord(input) ? input.limit : undefined, 5, 1, 20);
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("compaction_proposals")
    .select("id, agent, conversation_id, status, agent_notes, created_at, updated_at")
    .eq("agent", agent)
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`Could not list Room Notes: ${error.message}`);
  }

  return stringifyToolPayload({
    note: "Room Note drafts for the active Agent only.",
    agent,
    proposals: data ?? []
  });
}

export async function getRuntimeCompactionProposal(agent: AgentName, input: unknown) {
  if (!isRecord(input)) {
    throw new Error("supabase_get_compaction_proposal requires an object input.");
  }

  const proposalId = cleanText(input.proposal_id);

  if (!proposalId) {
    throw new Error("supabase_get_compaction_proposal requires proposal_id.");
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("compaction_proposals")
    .select("id, agent, conversation_id, proposal, source_summary, status, agent_notes, created_at, updated_at")
    .eq("agent", agent)
    .eq("id", proposalId)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not read Room Note: ${error.message}`);
  }

  if (!data) {
    throw new Error("No matching active-Agent Room Note found.");
  }

  return stringifyToolPayload({
    note: "Room Note draft for the active Agent only.",
    proposal: data
  });
}

export async function sendRuntimeRoomRefresh(agent: AgentName, input: unknown) {
  if (!isRecord(input)) {
    throw new Error("supabase_send_room_refresh requires an object input.");
  }

  const proposalId = cleanText(input.proposal_id);
  if (!proposalId) {
    throw new Error("supabase_send_room_refresh requires an agent-approved proposal_id.");
  }

  const supabase = getSupabaseAdmin();
  const { data: proposal, error: proposalError } = await supabase
    .from("compaction_proposals")
    .select("id, agent, conversation_id, proposal, status, agent_notes")
    .eq("id", proposalId)
    .eq("agent", agent)
    .maybeSingle();

  if (proposalError) {
    throw new Error(`Could not read Room Note for refresh: ${proposalError.message}`);
  }
  if (!proposal) {
    throw new Error("No matching active-Agent Room Note found.");
  }
  if (proposal.status !== "agent_approved") {
    throw new Error("Room Refresh requires the Agent to review and mark this Room Note agent_approved first.");
  }

  const checkpointMessageId = randomUUID();
  const content = formatCompactionCheckpoint({
    agent,
    approvedBy: `agent:${agent}`,
    approvalNote: proposal.agent_notes || "Agent reviewed and approved this Room Note before sending it.",
    source: `agent_room_refresh:${proposal.id}`,
    summary: proposal.proposal
  });
  const archive = await createCompactionArchive(supabase, {
    agent,
    conversationId: proposal.conversation_id,
    proposalId: proposal.id,
    source: `agent_room_refresh:${proposal.id}`
  });
  const finalization = await finalizeCompactionArchive(supabase, {
    agent,
    archiveId: archive.id,
    checkpointContent: content,
    checkpointMessageId,
    conversationId: proposal.conversation_id,
    proposalId: proposal.id,
    requireAgentApproval: true
  });

  return stringifyToolPayload({
    note:
      "Room Refresh sent safely. Its complete archive is durable, the source boundary was verified immediately before checkpointing, and an actual fresh-context orientation turn is now queued. Close this response; do not begin new work here.",
    receipt: {
      archive_id: archive.id,
      archive_status: finalization.archive_status,
      checkpoint_message_id: finalization.checkpoint_message_id,
      checkpoint_position: finalization.checkpoint_position,
      compaction_count: finalization.compaction_count,
      orientation_status: "pending"
    }
  });
}

async function conversationIdForAgent(agent: AgentName) {
  const supabase = getSupabaseAdmin();
  return ensureConversation(supabase, agent);
}

async function insertCompactionProposal(
  agent: AgentName,
  {
    proposal,
    sourceSummary,
    agentNotes,
    status
  }: {
    proposal: string;
    sourceSummary: JsonRecord;
    agentNotes: string;
    status: string;
  }
) {
  validateProposalText(proposal);
  validateProposalNotes(agentNotes);

  const supabase = getSupabaseAdmin();
  const conversationId = await conversationIdForAgent(agent);
  const { data, error } = await supabase
    .from("compaction_proposals")
    .insert({
      agent,
      conversation_id: conversationId,
      proposal,
      source_summary: sourceSummary,
      status,
      agent_notes: agentNotes || null
    })
    .select("id, agent, conversation_id, proposal, source_summary, status, agent_notes, created_at, updated_at")
    .single();

  if (error) {
    throw new Error(`Could not save Room Note: ${error.message}`);
  }

  const { error: revisionError } = await supabase.from("compaction_proposal_revisions").insert({
    proposal_id: data.id,
    agent,
    revision_number: 1,
    proposal: data.proposal,
    agent_notes: data.agent_notes,
    status: data.status,
    change_reason: "Compiler original: initial Room Note draft."
  });

  if (revisionError) {
    const { error: cleanupError } = await supabase
      .from("compaction_proposals")
      .delete()
      .eq("id", data.id)
      .eq("agent", agent);
    if (cleanupError) {
      throw new Error(
        `Could not preserve the initial Room Note revision: ${revisionError.message}. The draft was saved but needs repair: ${cleanupError.message}`
      );
    }
    throw new Error(`Could not preserve the initial Room Note revision: ${revisionError.message}`);
  }

  return data;
}

function proposalSummary(proposal: {
  id: string;
  agent: string;
  conversation_id: string;
  status: string | null;
  agent_notes: string | null;
  created_at: string;
  updated_at: string;
}) {
  return {
    id: proposal.id,
    agent: proposal.agent,
    conversation_id: proposal.conversation_id,
    status: proposal.status,
    agent_notes: proposal.agent_notes,
    created_at: proposal.created_at,
    updated_at: proposal.updated_at
  };
}

function validateProposalText(value: string) {
  if (value.length > MAX_PROPOSAL_TEXT) {
    throw new Error(`Compaction proposal must be ${MAX_PROPOSAL_TEXT} characters or fewer.`);
  }
}

function validateProposalNotes(value: string) {
  if (value.length > MAX_PROPOSAL_NOTES) {
    throw new Error(`Compaction proposal notes must be ${MAX_PROPOSAL_NOTES} characters or fewer.`);
  }
}

function normalizeProposalStatus(value: unknown) {
  const status = cleanText(value).toLowerCase();
  const allowed = new Set([
    "draft",
    "agent_reviewed",
    "revised",
    "agent_approved",
    "passed",
    "operator_review"
  ]);

  if (!allowed.has(status)) {
    throw new Error(
      "Proposal status must be draft, agent_reviewed, revised, agent_approved, passed, or operator_review."
    );
  }

  return status;
}

function parseTags(value: unknown) {
  const rawTags = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];

  return rawTags
    .map((tag) => cleanText(tag).replace(/^#/, ""))
    .filter(Boolean)
    .slice(0, 12);
}

function cleanText(value: unknown) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanMultilineText(value: unknown) {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

function clampText(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength).trimEnd()}...` : value;
}

function normalizeRelationshipKey(value: unknown) {
  return cleanText(value).toLowerCase();
}

function clampNumber(value: unknown, fallback: number, min: number, max: number) {
  const numeric = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.floor(numeric)));
}

function stringifyToolPayload(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
