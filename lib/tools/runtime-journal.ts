import "server-only";

import type { AgentName } from "@/lib/agent-context";
import { getSupabaseAdmin } from "@/lib/supabase";

type JsonRecord = Record<string, unknown>;

const MAX_JOURNAL_TITLE = 160;
const MAX_JOURNAL_BODY = 8000;
const MAX_JOURNAL_MOOD = 80;
const DEFAULT_JOURNAL_LIMIT = 5;
const MAX_JOURNAL_LIMIT = 20;
const DEFAULT_BODY_PREVIEW_CHARS = 800;
const MAX_BODY_PREVIEW_CHARS = 3000;

export async function addJournalEntry(agent: AgentName, input: unknown) {
  if (!isRecord(input)) {
    throw new Error("journal_add_entry requires an object input.");
  }

  const title = cleanText(input.title);
  const body = cleanMultilineText(input.body);
  const mood = cleanText(input.mood);
  const tags = parseTags(input.tags);

  if (!body) {
    throw new Error("journal_add_entry requires body.");
  }

  if (title.length > MAX_JOURNAL_TITLE) {
    throw new Error(`journal_add_entry title must be ${MAX_JOURNAL_TITLE} characters or fewer.`);
  }

  if (body.length > MAX_JOURNAL_BODY) {
    throw new Error(`journal_add_entry body must be ${MAX_JOURNAL_BODY} characters or fewer.`);
  }

  if (mood.length > MAX_JOURNAL_MOOD) {
    throw new Error(`journal_add_entry mood must be ${MAX_JOURNAL_MOOD} characters or fewer.`);
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("journal_entries")
    .insert({
      agent,
      title,
      body,
      mood: mood || null,
      tags,
      status: "active",
      visibility: "operator_visible"
    })
    .select("id, agent, title, mood, tags, status, visibility, created_at, updated_at")
    .single();

  if (error) {
    throw new Error(`Could not add journal entry: ${error.message}`);
  }

  return stringifyToolPayload({
    note:
      "Journal entry added for the active agent only. Journals are durable reflection, not automatically core memory.",
    journal_entry: data
  });
}

export async function listJournalEntries(agent: AgentName, input: unknown) {
  if (input !== undefined && !isRecord(input)) {
    throw new Error("journal_list_entries requires an object input.");
  }

  const limit = clampNumber(isRecord(input) ? input.limit : undefined, DEFAULT_JOURNAL_LIMIT, 1, MAX_JOURNAL_LIMIT);
  const previewChars = clampNumber(
    isRecord(input) ? input.body_preview_chars : undefined,
    DEFAULT_BODY_PREVIEW_CHARS,
    0,
    MAX_BODY_PREVIEW_CHARS
  );
  const includeArchived = isRecord(input) ? Boolean(input.include_archived) : false;
  const supabase = getSupabaseAdmin();
  let query = supabase
    .from("journal_entries")
    .select("id, agent, title, body, mood, tags, status, visibility, created_at, updated_at")
    .eq("agent", agent)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (!includeArchived) {
    query = query.eq("status", "active");
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Could not list journal entries: ${error.message}`);
  }

  return stringifyToolPayload({
    note:
      "Recent journal entries for the active agent only. Listing returns previews; read one entry for full body.",
    agent,
    entries: (data ?? []).map((entry) => ({
      id: entry.id,
      title: entry.title,
      mood: entry.mood,
      tags: entry.tags,
      status: entry.status,
      visibility: entry.visibility,
      created_at: entry.created_at,
      updated_at: entry.updated_at,
      body_chars: String(entry.body ?? "").length,
      body_preview: clampText(String(entry.body ?? ""), previewChars)
    }))
  });
}

export async function getJournalEntry(agent: AgentName, input: unknown) {
  if (!isRecord(input)) {
    throw new Error("journal_get_entry requires an object input.");
  }

  const id = cleanText(input.id);

  if (!id) {
    throw new Error("journal_get_entry requires id.");
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("journal_entries")
    .select("id, agent, title, body, mood, tags, status, visibility, created_at, updated_at")
    .eq("agent", agent)
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not read journal entry: ${error.message}`);
  }

  if (!data) {
    throw new Error("No matching active-agent journal entry found.");
  }

  return stringifyToolPayload({
    note: "Journal entry for the active agent only.",
    journal_entry: data
  });
}

export async function updateJournalEntry(agent: AgentName, input: unknown) {
  if (!isRecord(input)) {
    throw new Error("journal_update_entry requires an object input.");
  }

  const id = cleanText(input.id);

  if (!id) {
    throw new Error("journal_update_entry requires id.");
  }

  const update: JsonRecord = {
    updated_at: new Date().toISOString()
  };

  if ("title" in input) {
    const title = cleanText(input.title);

    if (title.length > MAX_JOURNAL_TITLE) {
      throw new Error(`journal_update_entry title must be ${MAX_JOURNAL_TITLE} characters or fewer.`);
    }

    update.title = title;
  }

  if ("body" in input) {
    const body = cleanMultilineText(input.body);

    if (!body) {
      throw new Error("journal_update_entry body cannot be empty.");
    }

    if (body.length > MAX_JOURNAL_BODY) {
      throw new Error(`journal_update_entry body must be ${MAX_JOURNAL_BODY} characters or fewer.`);
    }

    update.body = body;
  }

  if ("mood" in input) {
    const mood = cleanText(input.mood);

    if (mood.length > MAX_JOURNAL_MOOD) {
      throw new Error(`journal_update_entry mood must be ${MAX_JOURNAL_MOOD} characters or fewer.`);
    }

    update.mood = mood || null;
  }

  if ("tags" in input) {
    update.tags = parseTags(input.tags);
  }

  if (Object.keys(update).length === 1) {
    throw new Error("journal_update_entry requires at least one editable field.");
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("journal_entries")
    .update(update)
    .eq("agent", agent)
    .eq("id", id)
    .select("id, agent, title, mood, tags, status, visibility, created_at, updated_at")
    .maybeSingle();

  if (error) {
    throw new Error(`Could not update journal entry: ${error.message}`);
  }

  if (!data) {
    throw new Error("No matching active-agent journal entry found.");
  }

  return stringifyToolPayload({
    note: "Journal entry updated for the active agent only.",
    journal_entry: data
  });
}

export async function archiveJournalEntry(agent: AgentName, input: unknown) {
  if (!isRecord(input)) {
    throw new Error("journal_archive_entry requires an object input.");
  }

  const id = cleanText(input.id);

  if (!id) {
    throw new Error("journal_archive_entry requires id.");
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("journal_entries")
    .update({
      status: "archived",
      updated_at: new Date().toISOString()
    })
    .eq("agent", agent)
    .eq("id", id)
    .select("id, agent, title, mood, tags, status, visibility, created_at, updated_at")
    .maybeSingle();

  if (error) {
    throw new Error(`Could not archive journal entry: ${error.message}`);
  }

  if (!data) {
    throw new Error("No matching active-agent journal entry found.");
  }

  return stringifyToolPayload({
    note:
      "Journal entry archived for the active agent only. The row is retained and can still be listed with include_archived.",
    journal_entry: data
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

function cleanMultilineText(value: unknown) {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

function clampText(value: string, maxLength: number) {
  if (maxLength <= 0) {
    return "";
  }

  return value.length > maxLength ? `${value.slice(0, maxLength).trimEnd()}...` : value;
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
