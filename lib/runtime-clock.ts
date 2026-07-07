import "server-only";

export const DEFAULT_TIME_ZONE = "America/New_York";

export type RuntimeClock = {
  utc_iso: string;
  time_zone: string;
  local_readable: string;
  weekday: string;
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  second: string;
  time_zone_name: string;
};

export function runtimeClock(): RuntimeClock {
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

  return {
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
  };
}

export function formatRuntimeTemporalAnchor() {
  const clock = runtimeClock();

  return [
    `UTC: ${clock.utc_iso}`,
    `Local (${clock.time_zone}): ${clock.local_readable}`,
    "",
    "Use this live runtime clock as the source of truth for today's date and current time.",
    "Dates, weekdays, holidays, and relative-time statements inside restoration context, current_state, memories, journals, peer notes, source materials, or conversation history are historical claims from earlier turns. Treat them as stale until checked against this anchor or runtime_get_time.",
    "If a saved note conflicts with this live clock, trust the live clock and briefly acknowledge the stale note when it matters."
  ].join("\n");
}

function part(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes) {
  return parts.find((item) => item.type === type)?.value ?? "";
}
