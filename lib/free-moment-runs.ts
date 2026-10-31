import "server-only";
import { randomUUID } from "node:crypto";

import type { AgentName } from "@/lib/agent-context";
import { getSupabaseAdmin } from "@/lib/supabase";

export type FreeMomentRunStatus =
  | "running"
  | "cancellation_requested"
  | "wrapping_up"
  | "completed"
  | "bounded"
  | "cancelled"
  | "forced_stop"
  | "failed"
  | "interrupted";

export type FreeMomentRunPhase = "preparing" | "model" | "tool" | "wrap_up" | "finished";

export type FreeMomentRunReceipt = {
  id: string;
  agent: AgentName;
  status: FreeMomentRunStatus;
  phase: FreeMomentRunPhase;
  started_at: string;
  cancellation_requested_at: string | null;
  cancellation_mode: "graceful" | "force" | null;
  cancellation_reason: string | null;
  last_activity: Record<string, unknown>;
  completed_at: string | null;
  error: string | null;
};

type FreeMomentRunRow = Omit<FreeMomentRunReceipt, "agent" | "last_activity"> & {
  agent: string;
  last_activity: Record<string, unknown> | null;
};

// Keeps the existing scheduler safe while a branch is checked out before its
// migration has been applied. The feature becomes durable as soon as the new
// tables exist and the runtime restarts; this fallback never masks another DB
// failure such as permissions or connectivity.
let receiptsUnavailable = false;
let warnedAboutUnavailableReceipts = false;

export async function startFreeMomentRun(agent: AgentName) {
  if (receiptsUnavailable) {
    return ephemeralReceipt(agent);
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("free_moment_runs")
    .insert({ agent, source: "free_time", status: "running", phase: "preparing" })
    .select("id, agent, status, phase, started_at, cancellation_requested_at, cancellation_mode, cancellation_reason, last_activity, completed_at, error")
    .single();

  if (error || !data) {
    if (isReceiptTableUnavailable(error)) {
      noteUnavailableReceipts();
      return ephemeralReceipt(agent);
    }
    throw new Error(`Could not create Free Moment receipt: ${error?.message ?? "no row returned"}`);
  }

  const receipt = normalizeRun(data as FreeMomentRunRow);
  await recordFreeMomentRunEvent(receipt.id, "started", "Free Moment started.", { agent });
  return receipt;
}

export async function markFreeMomentRunCancellation(
  runId: string,
  mode: "graceful" | "force",
  reason?: string
) {
  if (receiptsUnavailable) {
    return;
  }

  const now = new Date().toISOString();
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("free_moment_runs")
    .update({
      // A force request is still a request until the runtime confirms it has
      // stopped. Keeping this non-terminal avoids a false receipt if process
      // loss happens between the abort signal and the catch/finalizer.
      status: "cancellation_requested",
      cancellation_requested_at: now,
      cancellation_mode: mode,
      cancellation_reason: reason?.trim() || null,
      phase: "model"
    })
    .eq("id", runId)
    .in("status", ["running", "cancellation_requested", "wrapping_up"])
    .select("id");

  if (error) {
    if (isReceiptTableUnavailable(error)) {
      noteUnavailableReceipts();
      return;
    }
    throw new Error(`Could not record Free Moment cancellation request: ${error.message}`);
  }

  if (data?.length) {
    await recordFreeMomentRunEvent(
      runId,
      mode === "force" ? "force_stop_requested" : "cancellation_requested",
      mode === "force"
        ? "Operator requested an immediate Free Moment stop."
        : "Operator requested that this Free Moment end after its current activity.",
      { reason: reason?.trim() || null }
    );
  }
}

export async function markFreeMomentRunWrappingUp(runId: string) {
  if (receiptsUnavailable) {
    return;
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("free_moment_runs")
    .update({ status: "wrapping_up", phase: "wrap_up" })
    .eq("id", runId)
    .in("status", ["cancellation_requested", "wrapping_up"])
    .select("id");

  if (error) {
    if (isReceiptTableUnavailable(error)) {
      noteUnavailableReceipts();
      return;
    }
    throw new Error(`Could not record Free Moment wrap-up: ${error.message}`);
  }

  if (data?.length) {
    await recordFreeMomentRunEvent(
      runId,
      "wrapping_up",
      "Free Moment is closing after the current activity."
    );
  }
}

export async function updateFreeMomentRunActivity(
  runId: string,
  phase: FreeMomentRunPhase,
  activity: Record<string, unknown>
) {
  if (receiptsUnavailable) {
    return;
  }

  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("free_moment_runs")
    .update({ phase, last_activity: sanitizeRecord(activity) })
    .eq("id", runId)
    .in("status", ["running", "cancellation_requested", "wrapping_up"]);

  if (error) {
    if (isReceiptTableUnavailable(error)) {
      noteUnavailableReceipts();
      return;
    }
    throw new Error(`Could not update Free Moment activity: ${error.message}`);
  }
}

export async function finishFreeMomentRun(
  runId: string,
  status: Extract<FreeMomentRunStatus, "completed" | "bounded" | "cancelled" | "forced_stop" | "failed" | "interrupted">,
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

  const message = options.message ?? defaultFinishMessage(status);
  await updateRun(runId, {
    status,
    phase: "finished",
    completed_at: new Date().toISOString(),
    error: options.error ?? null,
    ...(options.metadata ? { metadata: sanitizeRecord(options.metadata) } : {}),
    ...(options.lastActivity ? { last_activity: sanitizeRecord(options.lastActivity) } : {})
  });
  await recordFreeMomentRunEvent(runId, status, message, {
    error: options.error ?? null,
    ...(options.metadata ?? {})
  });
}

export async function reconcileInterruptedFreeMomentRuns() {
  if (receiptsUnavailable) {
    return 0;
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("free_moment_runs")
    .select("id")
    .in("status", ["running", "cancellation_requested", "wrapping_up"]);

  if (error) {
    if (isReceiptTableUnavailable(error)) {
      noteUnavailableReceipts();
      return 0;
    }
    throw new Error(`Could not inspect interrupted Free Moments: ${error.message}`);
  }

  for (const row of data ?? []) {
    const runId = String(row.id ?? "");
    if (!runId) {
      continue;
    }

    await finishFreeMomentRun(runId, "interrupted", {
      message: "Free Moment was interrupted by a runtime restart or process loss."
    });
  }

  return (data ?? []).length;
}

async function updateRun(runId: string, patch: Record<string, unknown>) {
  if (receiptsUnavailable) {
    return;
  }

  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("free_moment_runs").update(patch).eq("id", runId);

  if (error) {
    if (isReceiptTableUnavailable(error)) {
      noteUnavailableReceipts();
      return;
    }
    throw new Error(`Could not update Free Moment receipt: ${error.message}`);
  }
}

async function recordFreeMomentRunEvent(
  runId: string,
  eventType: string,
  message: string,
  metadata: Record<string, unknown> = {}
) {
  if (receiptsUnavailable) {
    return;
  }

  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("free_moment_run_events").insert({
    run_id: runId,
    event_type: eventType,
    message,
    metadata: sanitizeRecord(metadata)
  });

  if (error) {
    if (isReceiptTableUnavailable(error)) {
      noteUnavailableReceipts();
      return;
    }
    throw new Error(`Could not record Free Moment event: ${error.message}`);
  }
}

function normalizeRun(row: FreeMomentRunRow): FreeMomentRunReceipt {
  return {
    ...row,
    agent: row.agent as AgentName,
    status: row.status as FreeMomentRunStatus,
    phase: row.phase as FreeMomentRunPhase,
    cancellation_mode: row.cancellation_mode as FreeMomentRunReceipt["cancellation_mode"],
    last_activity: row.last_activity ?? {}
  };
}

function sanitizeRecord(value: Record<string, unknown>) {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function defaultFinishMessage(status: FreeMomentRunStatus) {
  const messages: Record<string, string> = {
    completed: "Free Moment completed normally.",
    bounded: "Free Moment settled at its configured action bound.",
    cancelled: "Free Moment ended at the Operator's request.",
    forced_stop: "Free Moment was force-stopped at the Operator's request.",
    failed: "Free Moment failed before completion.",
    interrupted: "Free Moment was interrupted before completion."
  };

  return messages[status] ?? "Free Moment ended.";
}

function ephemeralReceipt(agent: AgentName): FreeMomentRunReceipt {
  return {
    id: `ephemeral-${randomUUID()}`,
    agent,
    status: "running",
    phase: "preparing",
    started_at: new Date().toISOString(),
    cancellation_requested_at: null,
    cancellation_mode: null,
    cancellation_reason: null,
    last_activity: {},
    completed_at: null,
    error: null
  };
}

function isReceiptTableUnavailable(error: { code?: unknown; message?: unknown } | null | undefined) {
  const code = String(error?.code ?? "");
  const message = String(error?.message ?? "").toLowerCase();

  return code === "PGRST205" ||
    (message.includes("free_moment_runs") && (message.includes("does not exist") || message.includes("schema cache")));
}

function noteUnavailableReceipts() {
  receiptsUnavailable = true;

  if (!warnedAboutUnavailableReceipts) {
    warnedAboutUnavailableReceipts = true;
    console.warn(
      "Free Moment run receipts are not installed yet; using an in-memory receipt until sql/2026-10-30-free-moment-run-receipts.sql is applied and the runtime restarts."
    );
  }
}
