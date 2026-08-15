export type WakePriority = "loud" | "quiet" | "digest_only" | "silent";
export type WakeTone =
  | "quiet"
  | "soft"
  | "directed"
  | "high_signal"
  | "recovery"
  | "curiosity"
  | "maintenance";

export const WAKE_PRIORITIES: WakePriority[] = ["loud", "quiet", "digest_only", "silent"];
export const WAKE_RECEIPT_REDISPATCH_BLOCKING_STATUSES = ["attempted", "completed"];

export function normalizeWakePriority(value: unknown): WakePriority {
  const priority = String(value ?? "");

  return WAKE_PRIORITIES.includes(priority as WakePriority)
    ? priority as WakePriority
    : "digest_only";
}

export function shouldShowPacketSignalInDigest(wakePriority: unknown) {
  return normalizeWakePriority(wakePriority) !== "silent";
}

export function shouldDispatchNativePacketSignalWake(wakePriority: unknown) {
  const priority = normalizeWakePriority(wakePriority);

  return priority !== "digest_only" && priority !== "silent";
}

export function wakeToneForWorkPacketSignal(packetEventType?: string, wakePriority?: string): WakeTone {
  const priority = normalizeWakePriority(wakePriority);

  if (priority === "silent") {
    return "quiet";
  }

  if (priority === "loud") {
    return "high_signal";
  }

  if (packetEventType === "hold" || packetEventType === "question" || packetEventType === "stale") {
    return "high_signal";
  }

  if (priority === "quiet") {
    return "soft";
  }

  if (packetEventType === "rollup_review") {
    return "quiet";
  }

  if (packetEventType === "open_packet" || packetEventType === "created" || packetEventType === "packet_ready_for_rollup") {
    return "directed";
  }

  return "directed";
}

export function wakePriorityForOperatorNote(): WakePriority {
  return "quiet";
}

export function wakeToneForOperatorNote(): WakeTone {
  return "soft";
}
