import "server-only";

import type { AgentName } from "@/lib/agent-context";
import { getSupabaseAdmin } from "@/lib/supabase";

export type RuntimeTurnRunStatus =
  | "running"
  | "cancellation_requested"
  | "force_stopping"
  | "completed"
  | "cancelled"
  | "forced_stop"
  | "failed"
  | "interrupted";

export type RuntimeTurnRunPhase = "preparing" | "model" | "tool" | "wrap_up" | "finished";

type FinishStatus = Extract<RuntimeTurnRunStatus, "completed" | "cancelled" | "forced_stop" | "failed" | "interrupted">;

let receiptsUnavailable = false;
let warnedAboutUnavailableReceipts = false;

export async function startRuntimeTurnRun(input: {
  id: string;
  agent: AgentName;
  source: string;
}) {
  if (receiptsUnavailable) {
    return;
  }

  const { error } = await getSupabaseAdmin().from("runtime_turn_runs").insert({
    id: input.id,
    agent: input.agent,
    source: input.source,
    status: "running",
    phase: "preparing"
  });
  await handleWriteError(error, "Could not create runtime turn receipt");
  await recordRuntimeTurnEvent(input.id, "started", "Runtime turn started.", { source: input.source });
}

export async function updateRuntimeTurnActivity(
  id: string,
  phase: RuntimeTurnRunPhase,
  lastActivity: Record<string, unknown>
) {
  if (receiptsUnavailable) {
    return;
  }

  const { error } = await getSupabaseAdmin()
    .from("runtime_turn_runs")
    .update({ phase, last_activity: sanitizeRecord(lastActivity) })
    .eq("id", id)
    .in("status", ["running", "cancellation_requested", "force_stopping"]);
  await handleWriteError(error, "Could not update runtime turn activity");
}

export async function markRuntimeTurnCancellation(
  id: string,
  mode: "graceful" | "force",
  reason?: string
) {
  if (receiptsUnavailable) {
    return;
  }

  const status = mode === "force" ? "force_stopping" : "cancellation_requested";
  const { data, error } = await getSupabaseAdmin()
    .from("runtime_turn_runs")
    .update({
      status,
      cancellation_requested_at: new Date().toISOString(),
      cancellation_mode: mode,
      cancellation_reason: reason?.trim() || null
    })
    .eq("id", id)
    .in("status", ["running", "cancellation_requested", "force_stopping"])
    .select("id");
  await handleWriteError(error, "Could not record runtime turn cancellation");

  if (data?.length) {
    await recordRuntimeTurnEvent(
      id,
      mode === "force" ? "force_stop_requested" : "cancellation_requested",
      mode === "force"
        ? "Operator requested an immediate runtime turn stop."
        : "Operator requested that this runtime turn end after its current activity.",
      { reason: reason?.trim() || null }
    );
  }
}

export async function markRuntimeTurnWrappingUp(id: string) {
  if (receiptsUnavailable) {
    return;
  }

  const { data, error } = await getSupabaseAdmin()
    .from("runtime_turn_runs")
    .update({ status: "cancellation_requested", phase: "wrap_up" })
    .eq("id", id)
    .eq("status", "cancellation_requested")
    .select("id");
  await handleWriteError(error, "Could not record runtime turn wrap-up");

  if (data?.length) {
    await recordRuntimeTurnEvent(id, "wrapping_up", "Runtime turn is closing after the current activity.");
  }
}

export async function finishRuntimeTurnRun(
  id: string,
  status: FinishStatus,
  options: {
    error?: string;
    message?: string;
    metadata?: Record<string, unknown>;
    lastActivity?: Record<string, unknown>;
  } = {}
) {
  if (receiptsUnavailable) {
    return;
  }

  const { error } = await getSupabaseAdmin()
    .from("runtime_turn_runs")
    .update({
      status,
      phase: "finished",
      completed_at: new Date().toISOString(),
      error: options.error ?? null,
      ...(options.metadata ? { metadata: sanitizeRecord(options.metadata) } : {}),
      ...(options.lastActivity ? { last_activity: sanitizeRecord(options.lastActivity) } : {})
    })
    .eq("id", id);
  await handleWriteError(error, "Could not finish runtime turn receipt");
  await recordRuntimeTurnEvent(id, status, options.message ?? finishMessage(status), {
    error: options.error ?? null,
    ...(options.metadata ?? {})
  });
}

export async function reconcileInterruptedRuntimeTurns() {
  if (receiptsUnavailable) {
    return 0;
  }

  const { data, error } = await getSupabaseAdmin()
    .from("runtime_turn_runs")
    .select("id")
    .in("status", ["running", "cancellation_requested", "force_stopping"]);
  await handleWriteError(error, "Could not inspect interrupted runtime turns");

  for (const row of data ?? []) {
    const id = String(row.id ?? "");
    if (id) {
      await finishRuntimeTurnRun(id, "interrupted", {
        message: "Runtime turn was interrupted by a runtime restart or process loss."
      });
    }
  }

  return (data ?? []).length;
}

async function recordRuntimeTurnEvent(
  runId: string,
  eventType: string,
  message: string,
  metadata: Record<string, unknown> = {}
) {
  if (receiptsUnavailable) {
    return;
  }

  const { error } = await getSupabaseAdmin().from("runtime_turn_events").insert({
    run_id: runId,
    event_type: eventType,
    message,
    metadata: sanitizeRecord(metadata)
  });
  await handleWriteError(error, "Could not record runtime turn event");
}

async function handleWriteError(error: { code?: string; message?: string } | null, prefix: string) {
  if (!error) {
    return;
  }
  if (error.code === "42P01" || /relation .*runtime_turn_(runs|events).* does not exist/i.test(error.message ?? "")) {
    receiptsUnavailable = true;
    if (!warnedAboutUnavailableReceipts) {
      warnedAboutUnavailableReceipts = true;
      console.warn("Runtime turn receipts are unavailable until the migration is applied; using in-process safety only.");
    }
    return;
  }
  throw new Error(`${prefix}: ${error.message ?? "unknown database error"}`);
}

function sanitizeRecord(value: Record<string, unknown>) {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function finishMessage(status: FinishStatus) {
  switch (status) {
    case "cancelled":
      return "Runtime turn stopped cleanly after its current activity.";
    case "forced_stop":
      return "Runtime turn was force-stopped by the Operator.";
    case "failed":
      return "Runtime turn failed.";
    case "interrupted":
      return "Runtime turn was interrupted.";
    default:
      return "Runtime turn completed.";
  }
}
