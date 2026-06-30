import "server-only";

import type { AgentName } from "@/lib/agent-context";
import { getSupabaseAdmin } from "@/lib/supabase";

const DEFAULT_TIME_ZONE = "America/New_York";
const PEER_AGENTS = new Set(["soren", "varro"]);
const MAX_NOTE_SUBJECT = 160;
const MAX_NOTE_BODY = 4000;
const NOTE_LIST_LIMIT = 20;

export async function getRuntimeTime() {
  const now = new Date();
  const timeZone = process.env.RUNTIME_TIME_ZONE || DEFAULT_TIME_ZONE;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short"
  }).formatToParts(now);

  return JSON.stringify(
    {
      note: "Runtime clock. Use when temporal orientation matters; it is not injected into every turn.",
      utc_iso: now.toISOString(),
      time_zone: timeZone,
      local_readable: new Intl.DateTimeFormat("en-US", {
        timeZone,
        dateStyle: "full",
        timeStyle: "long"
      }).format(now),
      weekday: part(parts, "weekday"),
      year: part(parts, "year"),
      month: part(parts, "month"),
      day: part(parts, "day"),
      hour: part(parts, "hour"),
      minute: part(parts, "minute"),
      second: part(parts, "second"),
      time_zone_name: part(parts, "timeZoneName")
    },
    null,
    2
  );
}

function part(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes) {
  return parts.find((item) => item.type === type)?.value ?? "";
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

function stringifyToolPayload(payload: unknown) {
  return JSON.stringify(payload, null, 2);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
