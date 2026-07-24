import "server-only";

import { ensureConversation, type AgentName } from "@/lib/agent-context";
import { compileCompactionProposal } from "@/lib/compaction-compile";
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
      "Current state updated for the active agent only. This is the living handoff field for meaningful sessions, major state changes, and pre-compaction orientation; live runtime clock remains authoritative for today/now.",
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
      "Non-destructive compaction proposal for the active agent only. Nothing was archived, checkpointed, deleted, replaced, or modified.",
    proposal
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
    throw new Error("Compiled proposal did not return proposal text.");
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
      "Compiled and saved a non-destructive compaction proposal for the active agent only. This is not a checkpoint and does not change active context.",
    saved_proposal: proposalSummary(saved),
    proposal_preview: clampText(proposal, 1600),
    next_step:
      "Read the saved proposal by id, review it, then update notes or status when ready."
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
    throw new Error("supabase_save_compaction_proposal requires proposal.");
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
      "Compaction proposal draft saved for the active agent only. This is not a checkpoint and does not change active context.",
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
  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString()
  };

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

  if (Object.keys(patch).length === 1) {
    throw new Error("supabase_update_compaction_proposal requires proposal, agent_notes, or status.");
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("compaction_proposals")
    .update(patch)
    .eq("agent", agent)
    .eq("id", proposalId)
    .select("id, agent, conversation_id, proposal, source_summary, status, agent_notes, created_at, updated_at")
    .maybeSingle();

  if (error) {
    throw new Error(`Could not update compaction proposal: ${error.message}`);
  }

  if (!data) {
    throw new Error("No matching active-agent compaction proposal found.");
  }

  return stringifyToolPayload({
    note:
      "Compaction proposal draft updated for the active agent only. This is not a checkpoint and does not change active context.",
    proposal: data
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
    throw new Error(`Could not list compaction proposals: ${error.message}`);
  }

  return stringifyToolPayload({
    note: "Compaction proposal drafts for the active agent only.",
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
    throw new Error(`Could not read compaction proposal: ${error.message}`);
  }

  if (!data) {
    throw new Error("No matching active-agent compaction proposal found.");
  }

  return stringifyToolPayload({
    note: "Compaction proposal draft for the active agent only.",
    proposal: data
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
    throw new Error(`Could not save compaction proposal: ${error.message}`);
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
  const allowed = new Set(["draft", "agent_reviewed", "agent_approved", "operator_review"]);

  if (!allowed.has(status)) {
    throw new Error("Proposal status must be draft, agent_reviewed, agent_approved, or operator_review.");
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
