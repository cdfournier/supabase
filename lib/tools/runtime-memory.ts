import "server-only";

import type { AgentName } from "@/lib/agent-context";
import { getSupabaseAdmin } from "@/lib/supabase";

type JsonRecord = Record<string, unknown>;

const MAX_MEMORY_CONTENT = 2200;
const MAX_RELATIONSHIP_SUMMARY = 2400;

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
