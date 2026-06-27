import "server-only";

const DEFAULT_TIME_ZONE = "America/New_York";

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
