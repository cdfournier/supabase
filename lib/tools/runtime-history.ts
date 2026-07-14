import "server-only";

import {
  contentToText,
  ensureConversation,
  loadConversationMessages,
  type AgentName,
  type ChatMessage
} from "@/lib/agent-context";
import { getSupabaseAdmin } from "@/lib/supabase";

type JsonRecord = Record<string, unknown>;

const DEFAULT_RECENT_LIMIT = 10;
const MAX_RECENT_LIMIT = 30;
const DEFAULT_SEARCH_LIMIT = 5;
const MAX_SEARCH_LIMIT = 15;
const DEFAULT_CONTEXT_RADIUS = 3;
const MAX_CONTEXT_RADIUS = 8;
const DEFAULT_MESSAGE_CHARS = 1200;
const MAX_MESSAGE_CHARS = 3000;
const MAX_QUERY_LENGTH = 120;
const ALLOWED_SOURCES = new Set(["chat_api", "free_time", "unknown"]);

export async function readRecentRuntimeMessages(agent: AgentName, input: unknown) {
  const limit = clampNumber(isRecord(input) ? input.limit : undefined, DEFAULT_RECENT_LIMIT, 1, MAX_RECENT_LIMIT);
  const maxChars = clampNumber(
    isRecord(input) ? input.message_chars : undefined,
    DEFAULT_MESSAGE_CHARS,
    200,
    MAX_MESSAGE_CHARS
  );
  const source = optionalSource(isRecord(input) ? input.source : undefined);
  const messages = filterMessagesBySource(await loadOwnMessages(agent), source);
  const selected = messages.slice(-limit);

  return stringifyToolPayload({
    note:
      "Recent raw transcript messages for the active agent only. Use for orientation gaps; do not treat this as durable memory until reviewed.",
    agent,
    source: source ?? "all",
    total_messages: messages.length,
    returned_messages: selected.length,
    messages: selected.map((message) => messageSummary(message, maxChars))
  });
}

export async function searchRuntimeMessages(agent: AgentName, input: unknown) {
  if (!isRecord(input)) {
    throw new Error("runtime_search_conversation requires an object input.");
  }

  const query = cleanMultilineText(input.query);
  const limit = clampNumber(input.limit, DEFAULT_SEARCH_LIMIT, 1, MAX_SEARCH_LIMIT);
  const maxChars = clampNumber(input.message_chars, DEFAULT_MESSAGE_CHARS, 200, MAX_MESSAGE_CHARS);
  const source = optionalSource(input.source);

  if (!query) {
    throw new Error("runtime_search_conversation requires query.");
  }

  if (query.length > MAX_QUERY_LENGTH) {
    throw new Error(`runtime_search_conversation query must be ${MAX_QUERY_LENGTH} characters or fewer.`);
  }

  const normalizedQuery = normalizeSearchText(query);
  const needles = normalizedQuery.split(/\s+/).filter(Boolean);
  const messages = filterMessagesBySource(await loadOwnMessages(agent), source);
  const matches = messages
    .map((message) => {
      const text = contentToText(message.content);
      const haystack = normalizeSearchText(text);
      const exact_phrase_count = normalizedQuery ? countOccurrences(haystack, normalizedQuery) : 0;
      const matched_terms = needles.filter((needle) => haystack.includes(needle)).length;
      const term_occurrences = needles.reduce((total, needle) => total + countOccurrences(haystack, needle), 0);
      const score = exact_phrase_count > 0 || matched_terms > 0
        ? term_occurrences + exact_phrase_count * 1000
        : 0;

      return { message, text, exact_phrase_count, matched_terms, score };
    })
    .filter((match) => match.score > 0)
    .sort((left, right) => {
      if (right.exact_phrase_count !== left.exact_phrase_count) {
        return right.exact_phrase_count - left.exact_phrase_count;
      }

      if (right.matched_terms !== left.matched_terms) {
        return right.matched_terms - left.matched_terms;
      }

      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return right.message.position - left.message.position;
    })
    .slice(0, limit);

  return stringifyToolPayload({
    note:
      "Bounded keyword search over the active agent's own raw transcript. Search locates candidates; use runtime_get_message_window to inspect surrounding context before preserving conclusions.",
    agent,
    query,
    source: source ?? "all",
    total_messages: messages.length,
    returned_matches: matches.length,
    matches: matches.map((match) => ({
      score: match.score,
      exact_phrase_count: match.exact_phrase_count,
      matched_terms: match.matched_terms,
      ...messageSummary(match.message, maxChars)
    }))
  });
}

export async function getRuntimeMessageWindow(agent: AgentName, input: unknown) {
  if (!isRecord(input)) {
    throw new Error("runtime_get_message_window requires an object input.");
  }

  const position = Number(input.position);
  const before = clampNumber(input.before, DEFAULT_CONTEXT_RADIUS, 0, MAX_CONTEXT_RADIUS);
  const after = clampNumber(input.after, DEFAULT_CONTEXT_RADIUS, 0, MAX_CONTEXT_RADIUS);
  const maxChars = clampNumber(input.message_chars, DEFAULT_MESSAGE_CHARS, 200, MAX_MESSAGE_CHARS);

  if (!Number.isInteger(position) || position < 0) {
    throw new Error("runtime_get_message_window requires a non-negative integer position.");
  }

  const messages = await loadOwnMessages(agent);
  const start = Math.max(0, position - before);
  const end = position + after;
  const selected = messages.filter((message) => message.position >= start && message.position <= end);

  return stringifyToolPayload({
    note:
      "Narrow transcript window around one message position for the active agent only. Use after recent/search locates a moment.",
    agent,
    requested_position: position,
    before,
    after,
    total_messages: messages.length,
    returned_messages: selected.length,
    messages: selected.map((message) => messageSummary(message, maxChars))
  });
}

async function loadOwnMessages(agent: AgentName) {
  const supabase = getSupabaseAdmin();
  const conversationId = await ensureConversation(supabase, agent);

  return loadConversationMessages(supabase, conversationId);
}

function filterMessagesBySource(messages: ChatMessage[], source?: string) {
  if (!source) {
    return messages;
  }

  return messages.filter((message) => (message.source ?? "unknown") === source);
}

function messageSummary(message: ChatMessage, maxChars: number) {
  const text = contentToText(message.content);

  return {
    id: message.id ?? null,
    position: message.position,
    role: message.role,
    source: message.source ?? "unknown",
    turn_id: message.turn_id ?? null,
    created_at: message.created_at ?? null,
    chars: text.length,
    truncated: text.length > maxChars,
    content: clampText(text, maxChars)
  };
}

function countOccurrences(value: string, needle: string) {
  if (!needle) {
    return 0;
  }

  let count = 0;
  let index = value.indexOf(needle);

  while (index !== -1) {
    count += 1;
    index = value.indexOf(needle, index + needle.length);
  }

  return count;
}

function cleanMultilineText(value: unknown) {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

function optionalSource(value: unknown) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  const source = String(value);

  if (!ALLOWED_SOURCES.has(source)) {
    throw new Error('source must be "chat_api", "free_time", or "unknown".');
  }

  return source;
}

function normalizeSearchText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function clampText(value: string, maxLength: number) {
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
