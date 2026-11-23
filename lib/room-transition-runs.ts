import "server-only";

import { randomUUID } from "node:crypto";

import type { AgentName } from "@/lib/agent-context";
import { RuntimeTurnCancelController } from "@/lib/free-moment-cancel-controller";
import { getSupabaseAdmin } from "@/lib/supabase";

export type RoomTransitionStatus =
  | "queued"
  | "waiting_for_active_turn"
  | "in_progress"
  | "cancel_requested"
  | "completed"
  | "deferred"
  | "cancelled"
  | "failed"
  | "interrupted";

export type RoomTransitionStage = "queued" | "waiting" | "model" | "tool" | "wrap_up" | "finished";

export type RoomTransitionRun = {
  id: string;
  agent: AgentName;
  conversation_id: string;
  trigger_receipt_id: string | null;
  trigger: string;
  status: RoomTransitionStatus;
  stage: RoomTransitionStage;
  started_at: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  cancellation_requested_at: string | null;
  cancellation_reason: string | null;
  last_activity: Record<string, unknown>;
  error: string | null;
};

type RoomTransitionRow = Omit<RoomTransitionRun, "agent" | "last_activity"> & {
  agent: string;
  last_activity: Record<string, unknown> | null;
};

type RuntimeGlobal = typeof globalThis & {
  __roomTransitionControllers?: Map<string, RuntimeTurnCancelController>;
  __roomTransitionReceiptsReconciled?: boolean;
};

let receiptsUnavailable = false;
let warnedAboutUnavailableReceipts = false;

function controllers() {
  const runtimeGlobal = globalThis as RuntimeGlobal;
  runtimeGlobal.__roomTransitionControllers ??= new Map();
  return runtimeGlobal.__roomTransitionControllers;
}

/** Establishes one durable lifecycle record for a capacity-trigger receipt. */
export async function ensureRoomTransition(input: {
  agent: AgentName;
  conversationId: string;
  triggerReceiptId: string;
  trigger: string;
}) {
  if (receiptsUnavailable) {
    return null;
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("room_transition_runs")
    .upsert({
      id: randomUUID(),
      agent: input.agent,
      conversation_id: input.conversationId,
      trigger_receipt_id: input.triggerReceiptId,
      trigger: input.trigger,
      status: "queued",
      stage: "queued"
    }, { onConflict: "trigger_receipt_id", ignoreDuplicates: true })
    .select("*")
    .maybeSingle();
  await handleWriteError(error, "Could not create Room Transition receipt");

  if (data) {
    const run = normalize(data as RoomTransitionRow);
    await recordEvent(run.id, "queued", "Room Transition queued from its capacity trigger.", {
      trigger: input.trigger
    });
    return run;
  }

  const { data: existing, error: existingError } = await supabase
    .from("room_transition_runs")
    .select("*")
    .eq("trigger_receipt_id", input.triggerReceiptId)
    .maybeSingle();
  await handleWriteError(existingError, "Could not read Room Transition receipt");
  return existing ? normalize(existing as RoomTransitionRow) : null;
}

export async function markRoomTransitionWaiting(
  triggerReceiptId: string,
  activity: { id: string; kind: string; started_at: string }
) {
  return updateByTrigger(triggerReceiptId, {
    status: "waiting_for_active_turn",
    stage: "waiting",
    last_activity: {
      kind: "waiting_for_active_turn",
      active_activity_id: activity.id,
      active_activity_kind: activity.kind,
      active_since: activity.started_at
    }
  }, "waiting_for_active_turn", "Room Transition is waiting for the active room turn to reach a safe boundary.");
}

export async function markRoomTransitionInProgress(triggerReceiptId: string) {
  return updateByTrigger(triggerReceiptId, {
    status: "in_progress",
    stage: "model",
    started_at: new Date().toISOString(),
    last_activity: { kind: "model", message: "Starting the dedicated Room Transition." }
  }, "started", "Room Transition began after the room reached a safe boundary.", {}, [
    "queued",
    "waiting_for_active_turn",
    "deferred",
    "failed"
  ]);
}

export async function updateRoomTransitionActivity(
  triggerReceiptId: string,
  stage: Extract<RoomTransitionStage, "model" | "tool" | "wrap_up">,
  lastActivity: Record<string, unknown>
) {
  return updateByTrigger(triggerReceiptId, { stage, last_activity: sanitize(lastActivity) });
}

export async function finishRoomTransition(
  triggerReceiptId: string,
  status: Extract<RoomTransitionStatus, "completed" | "deferred" | "cancelled" | "failed">,
  options: { error?: string | null; message?: string; lastActivity?: Record<string, unknown> } = {}
) {
  return updateByTrigger(triggerReceiptId, {
    status,
    stage: "finished",
    completed_at: new Date().toISOString(),
    error: options.error?.slice(0, 2_000) ?? null,
    ...(options.lastActivity ? { last_activity: sanitize(options.lastActivity) } : {})
  }, status, options.message ?? finishMessage(status), options.error ? { error: options.error.slice(0, 2_000) } : {});
}

export function registerRoomTransitionController(id: string, controller: RuntimeTurnCancelController) {
  controllers().set(id, controller);
  return () => {
    controller.clear();
    if (controllers().get(id) === controller) {
      controllers().delete(id);
    }
  };
}

/**
 * Cancel has two intentionally different paths. A queued transition is
 * terminal immediately; an active one asks the runtime to stop at its next
 * safe checkpoint and never aborts an in-flight provider or tool call.
 */
export async function cancelRoomTransition(id: string, reason?: string) {
  await reconcileInterruptedRoomTransitions();
  if (receiptsUnavailable) {
    return { changed: false, error: "Room Transition receipts are unavailable until the migration is applied.", run: null };
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from("room_transition_runs").select("*").eq("id", id).maybeSingle();
  await handleWriteError(error, "Could not read Room Transition receipt");
  if (!data) {
    return { changed: false, error: "That Room Transition no longer exists.", run: null };
  }
  const run = normalize(data as RoomTransitionRow);
  const now = new Date().toISOString();

  if (run.status === "queued" || run.status === "waiting_for_active_turn") {
    const { data: cancelled, error: cancelError } = await supabase
      .from("room_transition_runs")
      .update({
        status: "cancelled",
        stage: "finished",
        cancellation_requested_at: now,
        cancellation_reason: reason?.trim() || null,
        completed_at: now,
        last_activity: { kind: "cancelled_before_start" }
      })
      .eq("id", id)
      .in("status", ["queued", "waiting_for_active_turn"])
      .select("*")
      .maybeSingle();
    await handleWriteError(cancelError, "Could not cancel queued Room Transition");
    if (!cancelled) {
      return { changed: false, error: "That Room Transition changed before it could be cancelled.", run };
    }
    if (run.trigger_receipt_id) {
      await cancelQueuedTrigger(run.trigger_receipt_id);
    }
    const next = normalize(cancelled as RoomTransitionRow);
    await recordEvent(id, "cancelled", "Operator cancelled the staged Room Transition before it began.", { reason: reason?.trim() || null });
    return { changed: true, error: null, run: next };
  }

  if (run.status !== "in_progress") {
    return { changed: false, error: "That Room Transition is no longer active.", run };
  }

  const { data: requested, error: requestError } = await supabase
    .from("room_transition_runs")
    .update({
      status: "cancel_requested",
      cancellation_requested_at: now,
      cancellation_reason: reason?.trim() || null
    })
    .eq("id", id)
    .eq("status", "in_progress")
    .select("*")
    .maybeSingle();
  await handleWriteError(requestError, "Could not request Room Transition cancellation");
  if (!requested) {
    return { changed: false, error: "That Room Transition changed before cancellation could be requested.", run };
  }

  const controller = controllers().get(id);
  controller?.requestGracefulStop(0, () => undefined);
  const next = normalize(requested as RoomTransitionRow);
  await recordEvent(id, "cancel_requested", "Operator asked this Room Transition to stop after its current safe checkpoint.", { reason: reason?.trim() || null });
  return { changed: true, error: null, run: next };
}

export async function activeRoomTransitionForAgent(agent: AgentName, conversationId: string) {
  if (receiptsUnavailable) {
    return null;
  }
  const { data, error } = await getSupabaseAdmin()
    .from("room_transition_runs")
    .select("*")
    .eq("agent", agent)
    .eq("conversation_id", conversationId)
    .in("status", ["queued", "waiting_for_active_turn", "in_progress", "cancel_requested"])
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    if (isMissingSchemaError(error)) {
      return null;
    }
    throw new Error(`Could not read active Room Transition: ${error.message}`);
  }
  return data ? normalize(data as RoomTransitionRow) : null;
}

export async function recentRoomTransitionEvents(runId: string, limit = 8) {
  if (receiptsUnavailable) {
    return [];
  }
  const { data, error } = await getSupabaseAdmin()
    .from("room_transition_events")
    .select("event_type, message, created_at")
    .eq("run_id", runId)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) {
    if (isMissingSchemaError(error)) {
      return [];
    }
    throw new Error(`Could not read Room Transition timeline: ${error.message}`);
  }
  return data ?? [];
}

export async function reconcileInterruptedRoomTransitions() {
  const runtimeGlobal = globalThis as RuntimeGlobal;
  if (runtimeGlobal.__roomTransitionReceiptsReconciled || receiptsUnavailable) {
    return 0;
  }
  runtimeGlobal.__roomTransitionReceiptsReconciled = true;
  const { data, error } = await getSupabaseAdmin()
    .from("room_transition_runs")
    .select("trigger_receipt_id")
    .in("status", ["in_progress", "cancel_requested"]);
  await handleWriteError(error, "Could not inspect interrupted Room Transitions");
  for (const row of data ?? []) {
    const triggerReceiptId = typeof row.trigger_receipt_id === "string" ? row.trigger_receipt_id : "";
    if (triggerReceiptId) {
      await finishRoomTransition(triggerReceiptId, "failed", {
        error: "Runtime restarted or lost process ownership before this Room Transition settled.",
        message: "Room Transition was interrupted by a runtime restart or process loss."
      });
    }
  }
  return (data ?? []).length;
}

async function updateByTrigger(
  triggerReceiptId: string,
  patch: Record<string, unknown>,
  eventType?: string,
  message?: string,
  metadata: Record<string, unknown> = {},
  allowedStatuses: RoomTransitionStatus[] = ["queued", "waiting_for_active_turn", "in_progress", "cancel_requested"]
) {
  if (receiptsUnavailable) {
    return null;
  }
  const { data, error } = await getSupabaseAdmin()
    .from("room_transition_runs")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("trigger_receipt_id", triggerReceiptId)
    .in("status", allowedStatuses)
    .select("*")
    .maybeSingle();
  await handleWriteError(error, "Could not update Room Transition receipt");
  if (data && eventType && message) {
    await recordEvent(String(data.id), eventType, message, metadata);
  }
  return data ? normalize(data as RoomTransitionRow) : null;
}

async function cancelQueuedTrigger(triggerReceiptId: string) {
  const { error } = await getSupabaseAdmin()
    .from("room_refresh_trigger_receipts")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("id", triggerReceiptId)
    .in("status", ["queued", "waiting_for_active_turn"]);
  if (error && !isMissingSchemaError(error)) {
    throw new Error(`Could not cancel staged Room Refresh trigger: ${error.message}`);
  }
}

async function recordEvent(runId: string, eventType: string, message: string, metadata: Record<string, unknown> = {}) {
  if (receiptsUnavailable) {
    return;
  }
  const { error } = await getSupabaseAdmin().from("room_transition_events").insert({
    run_id: runId,
    event_type: eventType,
    message,
    metadata: sanitize(metadata)
  });
  await handleWriteError(error, "Could not record Room Transition event");
}

function normalize(row: RoomTransitionRow): RoomTransitionRun {
  return {
    ...row,
    agent: row.agent as AgentName,
    last_activity: row.last_activity ?? {}
  };
}

function sanitize(value: Record<string, unknown>) {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function finishMessage(status: Extract<RoomTransitionStatus, "completed" | "deferred" | "cancelled" | "failed">) {
  if (status === "completed") return "Room Transition completed.";
  if (status === "deferred") return "Room Transition concluded without a Room Refresh.";
  if (status === "cancelled") return "Room Transition stopped at a safe boundary.";
  return "Room Transition failed before it could settle.";
}

async function handleWriteError(error: { code?: string; message?: string } | null, prefix: string) {
  if (!error) {
    return;
  }
  if (isMissingSchemaError(error)) {
    receiptsUnavailable = true;
    if (!warnedAboutUnavailableReceipts) {
      warnedAboutUnavailableReceipts = true;
      console.warn("Room Transition receipts are unavailable until the migration is applied; using staged in-process safety only.");
    }
    return;
  }
  throw new Error(`${prefix}: ${error.message ?? "unknown database error"}`);
}

function isMissingSchemaError(error: { code?: string; message?: string }) {
  const message = String(error.message ?? "").toLowerCase();
  return error.code === "42P01" || error.code === "PGRST205" ||
    (message.includes("room_transition_") && (message.includes("does not exist") || message.includes("schema cache")));
}
