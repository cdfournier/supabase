import "server-only";

import { statusWithSettings as freeMomentsStatusWithSettings } from "@/lib/free-time";
import { statusWithSettings as operatorNoteWakeStatusWithSettings } from "@/lib/operator-note-wakes";
import { statusWithSettings as workPacketSignalsStatusWithSettings } from "@/lib/work-packet-signals";

type ArrivalLaneStatus = {
  lane: "free_moments" | "work_packet_signals" | "work_packet_signal_wake" | "operator_note_wake";
  label: string;
  role: string;
  enabled: boolean | null;
  running?: boolean | null;
  active_wakes?: string[];
  next_check_at?: string | null;
  last_check_at?: string | null;
  last_turn_at?: string | null;
  last_wake_at?: Record<string, string | null> | null;
  last_error?: string | null;
};

export async function wakeArrivalsStatus() {
  const [freeMoments, workPacketSignals, operatorNoteWake] = await Promise.all([
    freeMomentsStatusWithSettings().catch((error) => ({ error: errorMessage(error) })),
    workPacketSignalsStatusWithSettings().catch((error) => ({ error: errorMessage(error) })),
    operatorNoteWakeStatusWithSettings({ dispatchPending: false }).catch((error) => ({ error: errorMessage(error) }))
  ]);

  const lanes: ArrivalLaneStatus[] = [
    {
      lane: "free_moments",
      label: "Free Moments",
      role: "Scheduled self-directed time; joy-first arrivals and gentle context cues.",
      enabled: boolOrNull(freeMoments, "durable_enabled"),
      running: boolOrNull(freeMoments, "running"),
      next_check_at: stringOrNull(freeMoments, "next_turn_at"),
      last_turn_at: stringOrNull(freeMoments, "last_turn_at"),
      last_error: errorFrom(freeMoments, "durable_error", "last_error")
    },
    {
      lane: "work_packet_signals",
      label: "Packet Signals",
      role: "Packet inbox monitor; refreshes collaboration signals without forcing work.",
      enabled: boolOrNull(workPacketSignals, "durable_enabled"),
      running: boolOrNull(workPacketSignals, "running"),
      next_check_at: stringOrNull(workPacketSignals, "next_check_at"),
      last_check_at: stringOrNull(workPacketSignals, "last_check_at"),
      last_error: errorFrom(workPacketSignals, "durable_error", "last_error")
    },
    {
      lane: "work_packet_signal_wake",
      label: "Packet Signal WAKE",
      role: "Tone-gated native wake delivery for non-digest packet arrivals.",
      enabled: boolOrNull(workPacketSignals, "wake_durable_enabled"),
      active_wakes: stringArray(workPacketSignals, "native_wakes_in_progress"),
      last_wake_at: recordOrNull(workPacketSignals, "last_native_wake_at"),
      last_error: errorFrom(workPacketSignals, "wake_durable_error", "last_error")
    },
    {
      lane: "operator_note_wake",
      label: "Operator Note WAKE",
      role: "Soft native wake delivery for unread Operator-authored notes.",
      enabled: boolOrNull(operatorNoteWake, "durable_enabled"),
      active_wakes: stringArray(operatorNoteWake, "native_wakes_in_progress"),
      last_check_at: stringOrNull(operatorNoteWake, "last_check_at"),
      last_wake_at: recordOrNull(operatorNoteWake, "last_native_wake_at"),
      last_error: errorFrom(operatorNoteWake, "durable_error", "last_error")
    }
  ];

  return {
    generated_at: new Date().toISOString(),
    summary: {
      enabled_lanes: lanes.filter((lane) => lane.enabled === true).length,
      running_lanes: lanes.filter((lane) => lane.running === true).length,
      active_wakes: lanes.flatMap((lane) => lane.active_wakes ?? []),
      error_count: lanes.filter((lane) => Boolean(lane.last_error)).length
    },
    lanes
  };
}

function boolOrNull(record: unknown, key: string) {
  if (!isRecord(record)) {
    return null;
  }

  const value = record[key];

  return typeof value === "boolean" ? value : null;
}

function stringOrNull(record: unknown, key: string) {
  if (!isRecord(record)) {
    return null;
  }

  const value = record[key];

  return typeof value === "string" && value.trim() ? value : null;
}

function stringArray(record: unknown, key: string) {
  if (!isRecord(record) || !Array.isArray(record[key])) {
    return [];
  }

  return record[key].filter((value): value is string => typeof value === "string");
}

function recordOrNull(record: unknown, key: string) {
  if (!isRecord(record) || !isRecord(record[key])) {
    return null;
  }

  return Object.fromEntries(
    Object.entries(record[key]).filter(([, value]) => typeof value === "string" || value === null)
  ) as Record<string, string | null>;
}

function errorFrom(record: unknown, ...keys: string[]) {
  if (!isRecord(record)) {
    return errorMessage(record);
  }

  for (const key of keys) {
    const value = record[key];

    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }

  return null;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error || "Unknown WAKE arrival error.");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
