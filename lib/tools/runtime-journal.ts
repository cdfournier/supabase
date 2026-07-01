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
      visibility: "operator_visible"
    })
    .select("id, agent, title, mood, tags, visibility, created_at, updated_at")
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
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("journal_entries")
    .select("id, agent, title, body, mood, tags, visibility, created_at, updated_at")
    .eq("agent", agent)
    .order("created_at", { ascending: false })
    .limit(limit);

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
    .select("id, agent, title, body, mood, tags, visibility, created_at, updated_at")
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
