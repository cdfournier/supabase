import "server-only";

import type { AgentName } from "@/lib/agent-context";
import { getSupabaseAdmin } from "@/lib/supabase";

export type FreeMomentSchedulerEventType =
  | "started"
  | "stopped"
  | "scheduled"
  | "turn_delayed"
  | "turn_interrupted"
  | "tick_skipped"
  | "tick_blocked"
  | "turn_started"
  | "turn_context_failed"
  | "turn_completed"
  | "turn_bounded"
  | "turn_failed"
  | "turn_cancellation_requested"
  | "turn_wrapping_up"
  | "turn_cancelled"
  | "turn_force_stopped";

export type FreeMomentSchedulerEvent = {
  at: string;
  type: FreeMomentSchedulerEventType;
  agent?: AgentName;
  message: string;
  metadata: Record<string, unknown>;
};

let eventLogUnavailable = false;

export async function recordFreeMomentSchedulerEvent(event: FreeMomentSchedulerEvent) {
  if (eventLogUnavailable) {
    return false;
  }

  const { error } = await getSupabaseAdmin().from("free_moment_scheduler_events").insert({
    event_type: event.type,
    agent: event.agent ?? null,
    message: event.message,
    metadata: event.metadata,
    created_at: event.at
  });

  if (!error) {
    return true;
  }

  if (isEventLogUnavailable(error)) {
    eventLogUnavailable = true;
    return false;
  }

  throw new Error(`Could not record Free Moment scheduler event: ${error.message}`);
}

/** Returns null when the new table has not yet been migrated. */
export async function loadRecentFreeMomentSchedulerEvents(limit: number) {
  if (eventLogUnavailable) {
    return null;
  }

  const { data, error } = await getSupabaseAdmin()
    .from("free_moment_scheduler_events")
    .select("event_type, agent, message, metadata, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (!error) {
    return (data ?? []).map((row) => ({
      at: String(row.created_at),
      type: row.event_type as FreeMomentSchedulerEventType,
      ...(row.agent ? { agent: row.agent as AgentName } : {}),
      message: String(row.message),
      metadata: asRecord(row.metadata)
    }));
  }

  if (isEventLogUnavailable(error)) {
    eventLogUnavailable = true;
    return null;
  }

  throw new Error(`Could not load Free Moment scheduler events: ${error.message}`);
}

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function isEventLogUnavailable(error: { code?: unknown; message?: unknown } | null | undefined) {
  const code = String(error?.code ?? "");
  const message = String(error?.message ?? "").toLowerCase();

  return code === "PGRST205" ||
    (message.includes("free_moment_scheduler_events") && (message.includes("does not exist") || message.includes("schema cache")));
}
