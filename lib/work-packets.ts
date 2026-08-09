import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

const PACKET_LIST_LIMIT = 25;
const MAX_TEXT = 8000;
const MAX_SHORT_TEXT = 240;
const MAX_ITEMS = 24;

export type WorkPacket = {
  id: string;
  packet_key: string | null;
  title: string;
  objective: string;
  context: string;
  repo: string | null;
  base_branch: string | null;
  working_branch: string | null;
  owner_agent: string | null;
  conductor: string;
  collaborators: string[];
  allowed_paths: string[];
  allowed_tools: string[];
  done_criteria: string[];
  review_path: string;
  review_rollup: Record<string, unknown>;
  merge_authority: string;
  rollback_note: string;
  status: WorkPacketStatus;
  wake_priority: WakePriority;
  metadata: Record<string, unknown>;
  created_by: string;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
};

export type WorkPacketEvent = {
  id: string;
  packet_id: string;
  actor_id: string;
  actor_display_name: string;
  event_type: WorkPacketEventType;
  response_state: WorkPacketResponseState | null;
  content: string;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type WorkPacketStatus = "queued" | "active" | "blocked" | "review" | "merged" | "closed";
export type WakePriority = "loud" | "quiet" | "digest_only" | "silent";
export type WorkPacketResponseState =
  | "accepted"
  | "passed"
  | "deferred"
  | "reviewed"
  | "no_comment"
  | "question"
  | "hold";
export type WorkPacketEventType = "created" | "response" | "comment" | "question" | "hold" | "rollup";

type Supabase = SupabaseClient;

type Actor = {
  actorId: string;
  displayName: string;
};

type CreatePacketInput = {
  packet_key?: unknown;
  title?: unknown;
  objective?: unknown;
  context?: unknown;
  repo?: unknown;
  base_branch?: unknown;
  working_branch?: unknown;
  owner_agent?: unknown;
  conductor?: unknown;
  collaborators?: unknown;
  allowed_paths?: unknown;
  allowed_tools?: unknown;
  done_criteria?: unknown;
  review_path?: unknown;
  merge_authority?: unknown;
  rollback_note?: unknown;
  wake_priority?: unknown;
  metadata?: unknown;
};

const STATUSES: WorkPacketStatus[] = ["queued", "active", "blocked", "review", "merged", "closed"];
const WAKE_PRIORITIES: WakePriority[] = ["loud", "quiet", "digest_only", "silent"];
const RESPONSE_STATES: WorkPacketResponseState[] = [
  "accepted",
  "passed",
  "deferred",
  "reviewed",
  "no_comment",
  "question",
  "hold"
];

const PARTICIPANT_NAMES: Record<string, string> = {
  "operator:chris": "Chris",
  "agent:soren": "Soren",
  "agent:varro": "Varro",
  "agent:julian": "Julian",
  "agent:cael": "Cael"
};

export async function listWorkPackets(supabase: Supabase, input: unknown = {}) {
  const filter = isRecord(input) ? input : {};
  const limit = clampNumber(filter.limit, PACKET_LIST_LIMIT, 1, PACKET_LIST_LIMIT);
  const status = optionalEnum(filter.status, STATUSES);
  const participant = optionalString(filter.participant, MAX_SHORT_TEXT);

  let query = supabase
    .from("work_packets")
    .select(packetColumns())
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (status) {
    query = query.eq("status", status);
  }

  if (participant) {
    query = query.or(
      `owner_agent.eq.${participant},conductor.eq.${participant},collaborators.cs.{${participant}}`
    );
  }

  const { data, error } = await query;

  if (error) {
    throw workPacketSetupError(error.message);
  }

  return (data ?? []) as unknown as WorkPacket[];
}

export async function getWorkPacket(supabase: Supabase, input: unknown) {
  const id = requireId(input);
  const [packet, events] = await Promise.all([
    loadPacket(supabase, id),
    loadPacketEvents(supabase, id)
  ]);

  return { packet, events };
}

export async function createWorkPacket(supabase: Supabase, input: unknown, actor = actorFromId("operator:chris")) {
  if (!isRecord(input)) {
    throw new Error("work packet create requires an object input.");
  }

  const title = requiredString(input.title, "title", MAX_SHORT_TEXT);
  const objective = requiredString(input.objective, "objective", MAX_TEXT);
  const context = optionalString(input.context, MAX_TEXT) ?? "";
  const conductor = optionalString(input.conductor, MAX_SHORT_TEXT) ?? "agent:julian";

  const { data, error } = await supabase
    .from("work_packets")
    .insert({
      packet_key: optionalString(input.packet_key, MAX_SHORT_TEXT),
      title,
      objective,
      context,
      repo: optionalString(input.repo, MAX_SHORT_TEXT),
      base_branch: optionalString(input.base_branch, MAX_SHORT_TEXT),
      working_branch: optionalString(input.working_branch, MAX_SHORT_TEXT),
      owner_agent: optionalString(input.owner_agent, MAX_SHORT_TEXT),
      conductor,
      collaborators: stringList(input.collaborators),
      allowed_paths: stringList(input.allowed_paths),
      allowed_tools: stringList(input.allowed_tools),
      done_criteria: stringList(input.done_criteria),
      review_path: optionalString(input.review_path, MAX_TEXT) ?? "",
      merge_authority: optionalString(input.merge_authority, MAX_SHORT_TEXT) ?? "",
      rollback_note: optionalString(input.rollback_note, MAX_TEXT) ?? "",
      wake_priority: optionalEnum(input.wake_priority, WAKE_PRIORITIES) ?? "digest_only",
      metadata: optionalRecord(input.metadata),
      created_by: actor.actorId
    })
    .select(packetColumns())
    .single();

  if (error) {
    throw workPacketSetupError(error.message);
  }

  const packet = data as unknown as WorkPacket;
  await insertPacketEvent(supabase, packet.id, actor, "created", null, "Work packet created.", {
    wake_priority: packet.wake_priority
  });

  return getWorkPacket(supabase, { id: packet.id });
}

export async function respondToWorkPacket(supabase: Supabase, input: unknown, actor: Actor) {
  if (!isRecord(input)) {
    throw new Error("work_packet_respond requires an object input.");
  }

  const packetId = requireId(input);
  const responseState = requiredEnum(input.response_state, "response_state", RESPONSE_STATES);
  const content = optionalString(input.content, MAX_TEXT) ?? "";
  const metadata = optionalRecord(input.metadata);
  const eventType = responseState === "question" || responseState === "hold" ? responseState : "response";

  await loadPacket(supabase, packetId);
  await insertPacketEvent(supabase, packetId, actor, eventType, responseState, content, metadata);
  await updatePacketAfterResponse(supabase, packetId, responseState);

  return getWorkPacket(supabase, { id: packetId });
}

export async function commentOnWorkPacket(supabase: Supabase, input: unknown, actor: Actor) {
  if (!isRecord(input)) {
    throw new Error("work_packet_comment requires an object input.");
  }

  const packetId = requireId(input);
  const content = requiredString(input.content, "content", MAX_TEXT);
  const isQuestion = Boolean(input.question);
  const hold = Boolean(input.hold);
  const eventType: WorkPacketEventType = hold ? "hold" : isQuestion ? "question" : "comment";
  const responseState: WorkPacketResponseState | null = hold ? "hold" : isQuestion ? "question" : null;

  await loadPacket(supabase, packetId);
  await insertPacketEvent(supabase, packetId, actor, eventType, responseState, content, optionalRecord(input.metadata));

  if (hold) {
    await touchPacket(supabase, packetId, { status: "blocked" });
  } else {
    await touchPacket(supabase, packetId);
  }

  return getWorkPacket(supabase, { id: packetId });
}

export async function rollupWorkPacket(supabase: Supabase, input: unknown, actor: Actor) {
  if (!isRecord(input)) {
    throw new Error("work_packet_rollup requires an object input.");
  }

  const packetId = requireId(input);
  const summary = requiredString(input.summary, "summary", MAX_TEXT);
  const decisionNeeded = optionalString(input.decision_needed, MAX_TEXT) ?? "";
  const status = optionalEnum(input.status, STATUSES) ?? "review";
  const rollup = {
    summary,
    reviewed_by: stringList(input.reviewed_by),
    aligned: stringList(input.aligned),
    disagreed: stringList(input.disagreed),
    blocked: stringList(input.blocked),
    decision_needed: decisionNeeded,
    next_step: optionalString(input.next_step, MAX_TEXT) ?? "",
    created_by: actor.actorId,
    created_at: new Date().toISOString()
  };

  await loadPacket(supabase, packetId);

  const { error } = await supabase
    .from("work_packets")
    .update({
      review_rollup: rollup,
      status,
      updated_at: new Date().toISOString(),
      closed_at: status === "closed" || status === "merged" ? new Date().toISOString() : null
    })
    .eq("id", packetId);

  if (error) {
    throw workPacketSetupError(error.message);
  }

  await insertPacketEvent(supabase, packetId, actor, "rollup", null, summary, {
    decision_needed: decisionNeeded,
    status
  });

  return getWorkPacket(supabase, { id: packetId });
}

export function actorFromId(actorId: string): Actor {
  return {
    actorId,
    displayName: PARTICIPANT_NAMES[actorId] ?? actorId
  };
}

async function loadPacket(supabase: Supabase, id: string) {
  const { data, error } = await supabase
    .from("work_packets")
    .select(packetColumns())
    .eq("id", id)
    .single();

  if (error) {
    throw workPacketSetupError(error.message);
  }

  return data as unknown as WorkPacket;
}

async function loadPacketEvents(supabase: Supabase, id: string) {
  const { data, error } = await supabase
    .from("work_packet_events")
    .select("id, packet_id, actor_id, actor_display_name, event_type, response_state, content, metadata, created_at")
    .eq("packet_id", id)
    .order("created_at", { ascending: true });

  if (error) {
    throw workPacketSetupError(error.message);
  }

  return (data ?? []) as WorkPacketEvent[];
}

async function insertPacketEvent(
  supabase: Supabase,
  packetId: string,
  actor: Actor,
  eventType: WorkPacketEventType,
  responseState: WorkPacketResponseState | null,
  content: string,
  metadata: Record<string, unknown>
) {
  const { error } = await supabase.from("work_packet_events").insert({
    packet_id: packetId,
    actor_id: actor.actorId,
    actor_display_name: actor.displayName,
    event_type: eventType,
    response_state: responseState,
    content,
    metadata
  });

  if (error) {
    throw workPacketSetupError(error.message);
  }
}

async function updatePacketAfterResponse(
  supabase: Supabase,
  packetId: string,
  responseState: WorkPacketResponseState
) {
  const status: WorkPacketStatus | undefined =
    responseState === "hold" ? "blocked" : responseState === "accepted" ? "active" : undefined;

  await touchPacket(supabase, packetId, status ? { status } : undefined);
}

async function touchPacket(supabase: Supabase, packetId: string, patch: Partial<WorkPacket> = {}) {
  const { error } = await supabase
    .from("work_packets")
    .update({
      ...patch,
      updated_at: new Date().toISOString()
    })
    .eq("id", packetId);

  if (error) {
    throw workPacketSetupError(error.message);
  }
}

function packetColumns() {
  return [
    "id",
    "packet_key",
    "title",
    "objective",
    "context",
    "repo",
    "base_branch",
    "working_branch",
    "owner_agent",
    "conductor",
    "collaborators",
    "allowed_paths",
    "allowed_tools",
    "done_criteria",
    "review_path",
    "review_rollup",
    "merge_authority",
    "rollback_note",
    "status",
    "wake_priority",
    "metadata",
    "created_by",
    "created_at",
    "updated_at",
    "closed_at"
  ].join(", ");
}

function requireId(input: unknown) {
  if (!isRecord(input)) {
    throw new Error("A packet id is required.");
  }

  return requiredString(input.id ?? input.packet_id, "id", MAX_SHORT_TEXT);
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

function requiredEnum<T extends string>(value: unknown, field: string, allowed: T[]) {
  const normalized = optionalEnum(value, allowed);

  if (!normalized) {
    throw new Error(`${field} must be one of: ${allowed.join(", ")}.`);
  }

  return normalized;
}

function optionalEnum<T extends string>(value: unknown, allowed: T[]) {
  const normalized = optionalString(value, MAX_SHORT_TEXT);

  if (!normalized) {
    return null;
  }

  if (!allowed.includes(normalized as T)) {
    throw new Error(`Value must be one of: ${allowed.join(", ")}.`);
  }

  return normalized as T;
}

function stringList(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => optionalString(item, MAX_SHORT_TEXT))
    .filter((item): item is string => Boolean(item))
    .slice(0, MAX_ITEMS);
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

function workPacketSetupError(message: string) {
  if (message.includes("work_packet")) {
    return new Error(
      `Work packet schema is not installed. Run sql/2026-08-09-work-packets.sql in Supabase, then restart the runtime. (${message})`
    );
  }

  return new Error(message);
}
