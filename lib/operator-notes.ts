import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

const NOTE_LIST_LIMIT = 25;
const MAX_TEXT = 4000;
const MAX_SHORT_TEXT = 240;

export type OperatorNoteStatus = "open" | "archived";
export type OperatorNoteReadStatus = "unread" | "read";
export type OperatorNoteActorSide = "operator" | "agent";
export type OperatorNoteEventType = "created" | "reply";

export type OperatorNote = {
  id: string;
  note_key: string | null;
  subject: string;
  agent: string;
  created_by: string;
  last_message_by: string;
  status: OperatorNoteStatus;
  operator_status: OperatorNoteReadStatus;
  agent_status: OperatorNoteReadStatus;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  operator_read_at: string | null;
  agent_read_at: string | null;
  archived_at: string | null;
  latest_event?: OperatorNoteEvent | null;
};

export type OperatorNoteEvent = {
  id: string;
  note_id: string;
  actor_id: string;
  actor_display_name: string;
  event_type: OperatorNoteEventType;
  content: string;
  metadata: Record<string, unknown>;
  created_at: string;
};

type Supabase = SupabaseClient;

type Actor = {
  actorId: string;
  displayName: string;
  side: OperatorNoteActorSide;
  agent?: string;
};

const READ_STATUSES: OperatorNoteReadStatus[] = ["unread", "read"];
const LIST_READ_STATUSES = [...READ_STATUSES, "all"] as const;
const LIST_STATUSES = ["open", "archived", "all"] as const;
const AGENT_NAMES: Record<string, string> = {
  cael: "Cael",
  julian: "Julian",
  soren: "Soren",
  varro: "Varro"
};

export function operatorNoteActorFromAgent(agent: string): Actor {
  const normalized = normalizeAgent(agent);

  return {
    actorId: `agent:${normalized}`,
    displayName: AGENT_NAMES[normalized] ?? normalized,
    side: "agent",
    agent: normalized
  };
}

export function operatorNoteOperatorActor(): Actor {
  return {
    actorId: "operator:chris",
    displayName: "Chris",
    side: "operator"
  };
}

export async function listOperatorNotes(supabase: Supabase, input: unknown = {}) {
  const filter = isRecord(input) ? input : {};
  const side = optionalSide(filter.side) ?? "operator";
  const limit = clampNumber(filter.limit, NOTE_LIST_LIMIT, 1, NOTE_LIST_LIMIT);
  const status = optionalEnum(filter.status, LIST_STATUSES) ?? "open";
  const operatorStatus = optionalEnum(filter.operator_status, LIST_READ_STATUSES) ?? "all";
  const agentStatus = optionalEnum(filter.agent_status, LIST_READ_STATUSES) ?? "all";
  const agent = side === "agent"
    ? normalizeAgent(filter.agent)
    : optionalAgent(filter.agent);

  let query = supabase
    .from("operator_notes")
    .select(noteColumns())
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (status !== "all") {
    query = query.eq("status", status);
  }

  if (agent) {
    query = query.eq("agent", agent);
  }

  if (side === "operator" && operatorStatus !== "all") {
    query = query.eq("operator_status", operatorStatus);
  }

  if (side === "agent" && agentStatus !== "all") {
    query = query.eq("agent_status", agentStatus);
  }

  const { data, error } = await query;

  if (error) {
    throw operatorNotesSetupError(error.message);
  }

  return attachLatestEvents(supabase, asOperatorNotes(data));
}

export async function countUnreadOperatorNotesForAgent(supabase: Supabase, agent: string) {
  const normalized = normalizeAgent(agent);
  const { count, error } = await supabase
    .from("operator_notes")
    .select("id", { count: "exact", head: true })
    .eq("agent", normalized)
    .eq("status", "open")
    .eq("agent_status", "unread");

  if (error) {
    throw operatorNotesSetupError(error.message);
  }

  return count ?? 0;
}

export async function getOperatorNote(supabase: Supabase, input: unknown, actor: Actor = operatorNoteOperatorActor()) {
  const id = requireId(input);
  const { data, error } = await supabase
    .from("operator_notes")
    .select(noteColumns())
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw operatorNotesSetupError(error.message);
  }

  if (!data) {
    throw new Error("No matching Operator note was found.");
  }

  const note = asOperatorNote(data);

  assertActorCanAccessNote(note, actor);

  const events = await listOperatorNoteEvents(supabase, id);

  return {
    note,
    events
  };
}

export async function createOperatorNote(supabase: Supabase, input: unknown, actor: Actor) {
  if (!isRecord(input)) {
    throw new Error("Operator note input is required.");
  }

  const agent = actor.side === "agent" ? actor.agent ?? "" : normalizeAgent(input.agent);
  const subject = optionalString(input.subject, MAX_SHORT_TEXT) ?? "";
  const body = requiredString(input.body, "body", MAX_TEXT);
  const metadata = optionalRecord(input.metadata);
  const now = new Date().toISOString();

  if (!agent) {
    throw invalidAgentError();
  }

  const { data, error } = await supabase
    .from("operator_notes")
    .insert({
      note_key: optionalString(input.note_key, MAX_SHORT_TEXT),
      subject,
      agent,
      created_by: actor.actorId,
      last_message_by: actor.actorId,
      status: "open",
      operator_status: actor.side === "operator" ? "read" : "unread",
      agent_status: actor.side === "agent" ? "read" : "unread",
      operator_read_at: actor.side === "operator" ? now : null,
      agent_read_at: actor.side === "agent" ? now : null,
      metadata
    })
    .select(noteColumns())
    .single();

  if (error) {
    throw operatorNotesSetupError(error.message);
  }

  const note = asOperatorNote(data);

  await createOperatorNoteEvent(supabase, note.id, actor, "created", body, metadata);

  return getOperatorNote(supabase, { id: note.id }, actor);
}

export async function replyToOperatorNote(supabase: Supabase, input: unknown, actor: Actor) {
  const id = requireId(input);
  const body = requiredString(isRecord(input) ? input.body : undefined, "body", MAX_TEXT);
  const metadata = optionalRecord(isRecord(input) ? input.metadata : undefined);
  const note = await requireAccessibleNote(supabase, id, actor);
  const now = new Date().toISOString();

  await createOperatorNoteEvent(supabase, note.id, actor, "reply", body, metadata);

  const { error } = await supabase
    .from("operator_notes")
    .update({
      last_message_by: actor.actorId,
      updated_at: now,
      operator_status: actor.side === "operator" ? "read" : "unread",
      agent_status: actor.side === "agent" ? "read" : "unread",
      operator_read_at: actor.side === "operator" ? now : note.operator_read_at,
      agent_read_at: actor.side === "agent" ? now : note.agent_read_at,
      status: "open",
      archived_at: null
    })
    .eq("id", note.id);

  if (error) {
    throw operatorNotesSetupError(error.message);
  }

  return getOperatorNote(supabase, { id: note.id }, actor);
}

export async function markOperatorNoteRead(supabase: Supabase, input: unknown, actor: Actor) {
  const id = requireId(input);
  const note = await requireAccessibleNote(supabase, id, actor);
  const now = new Date().toISOString();
  const update = actor.side === "operator"
    ? { operator_status: "read", operator_read_at: now }
    : { agent_status: "read", agent_read_at: now };

  const { data, error } = await supabase
    .from("operator_notes")
    .update(update)
    .eq("id", note.id)
    .select(noteColumns())
    .single();

  if (error) {
    throw operatorNotesSetupError(error.message);
  }

  return asOperatorNote(data);
}

export async function archiveOperatorNote(supabase: Supabase, input: unknown, actor: Actor = operatorNoteOperatorActor()) {
  if (actor.side !== "operator") {
    throw new Error("Only the Operator can archive Operator notes.");
  }

  const id = requireId(input);
  const note = await requireAccessibleNote(supabase, id, actor);
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("operator_notes")
    .update({
      status: "archived",
      operator_status: "read",
      operator_read_at: now,
      archived_at: now,
      updated_at: now
    })
    .eq("id", note.id)
    .select(noteColumns())
    .single();

  if (error) {
    throw operatorNotesSetupError(error.message);
  }

  return asOperatorNote(data);
}

async function requireAccessibleNote(supabase: Supabase, id: string, actor: Actor) {
  const { data, error } = await supabase
    .from("operator_notes")
    .select(noteColumns())
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw operatorNotesSetupError(error.message);
  }

  if (!data) {
    throw new Error("No matching Operator note was found.");
  }

  const note = asOperatorNote(data);

  assertActorCanAccessNote(note, actor);

  return note;
}

async function createOperatorNoteEvent(
  supabase: Supabase,
  noteId: string,
  actor: Actor,
  eventType: OperatorNoteEventType,
  content: string,
  metadata: Record<string, unknown>
) {
  const { error } = await supabase
    .from("operator_note_events")
    .insert({
      note_id: noteId,
      actor_id: actor.actorId,
      actor_display_name: actor.displayName,
      event_type: eventType,
      content,
      metadata
    });

  if (error) {
    throw operatorNotesSetupError(error.message);
  }
}

async function listOperatorNoteEvents(supabase: Supabase, noteId: string) {
  const { data, error } = await supabase
    .from("operator_note_events")
    .select(eventColumns())
    .eq("note_id", noteId)
    .order("created_at", { ascending: true });

  if (error) {
    throw operatorNotesSetupError(error.message);
  }

  return asOperatorNoteEvents(data);
}

async function attachLatestEvents(supabase: Supabase, notes: OperatorNote[]) {
  if (!notes.length) {
    return notes;
  }

  const ids = notes.map((note) => note.id);
  const { data, error } = await supabase
    .from("operator_note_events")
    .select(eventColumns())
    .in("note_id", ids)
    .order("created_at", { ascending: false });

  if (error) {
    throw operatorNotesSetupError(error.message);
  }

  const latestByNote = new Map<string, OperatorNoteEvent>();

  for (const event of asOperatorNoteEvents(data)) {
    if (!latestByNote.has(event.note_id)) {
      latestByNote.set(event.note_id, event);
    }
  }

  return notes.map((note) => ({
    ...note,
    latest_event: latestByNote.get(note.id) ?? null
  }));
}

function assertActorCanAccessNote(note: OperatorNote, actor: Actor) {
  if (actor.side === "agent" && note.agent !== actor.agent) {
    throw new Error("No matching Operator note addressed to the active agent was found.");
  }
}

function noteColumns() {
  return [
    "id",
    "note_key",
    "subject",
    "agent",
    "created_by",
    "last_message_by",
    "status",
    "operator_status",
    "agent_status",
    "metadata",
    "created_at",
    "updated_at",
    "operator_read_at",
    "agent_read_at",
    "archived_at"
  ].join(", ");
}

function eventColumns() {
  return [
    "id",
    "note_id",
    "actor_id",
    "actor_display_name",
    "event_type",
    "content",
    "metadata",
    "created_at"
  ].join(", ");
}

function asOperatorNote(value: unknown) {
  return value as OperatorNote;
}

function asOperatorNotes(value: unknown) {
  return (Array.isArray(value) ? value : []) as OperatorNote[];
}

function asOperatorNoteEvents(value: unknown) {
  return (Array.isArray(value) ? value : []) as OperatorNoteEvent[];
}

function requireId(input: unknown) {
  if (!isRecord(input)) {
    throw new Error("Operator note id is required.");
  }

  return requiredString(input.id ?? input.note_id, "id", MAX_SHORT_TEXT);
}

function requiredString(value: unknown, field: string, maxLength: number) {
  const normalized = optionalString(value, maxLength);

  if (!normalized) {
    throw new Error(`${field} is required.`);
  }

  return normalized;
}

function optionalString(value: unknown, maxLength: number) {
  if (value === undefined || value === null) {
    return null;
  }

  const normalized = String(value).trim();

  if (!normalized) {
    return null;
  }

  return normalized.slice(0, maxLength);
}

function optionalEnum<T extends string>(value: unknown, allowed: readonly T[]) {
  const normalized = optionalString(value, MAX_SHORT_TEXT);

  if (!normalized) {
    return null;
  }

  if (!allowed.includes(normalized as T)) {
    throw new Error(`Value must be one of: ${allowed.join(", ")}.`);
  }

  return normalized as T;
}

function optionalSide(value: unknown) {
  return optionalEnum(value, ["operator", "agent"] as const);
}

function optionalAgent(value: unknown) {
  const normalized = optionalString(value, MAX_SHORT_TEXT)?.toLowerCase() ?? "";
  return normalized && AGENT_NAMES[normalized] ? normalized : "";
}

function normalizeAgent(value: unknown) {
  const normalized = optionalAgent(value);

  if (!normalized) {
    throw invalidAgentError();
  }

  return normalized;
}

function invalidAgentError() {
  return new Error("agent must be cael, julian, soren, or varro.");
}

function optionalRecord(value: unknown) {
  return isRecord(value) ? value : {};
}

function clampNumber(value: unknown, fallback: number, min: number, max: number) {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.floor(numeric)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function operatorNotesSetupError(message: string) {
  if (message.includes("operator_notes") || message.includes("operator_note_events")) {
    return new Error(
      `Operator notes schema is not installed. Run sql/2026-08-15-operator-notes.sql in Supabase, then restart the runtime. (${message})`
    );
  }

  return new Error(message);
}
