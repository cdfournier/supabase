import "server-only";

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type LocalRelayStatus = {
  status: "running" | "starting" | "degraded" | "stopped" | "stale" | "offline" | "unknown";
  updated_at: string | null;
  last_poll_at: string | null;
  last_delivery_at: string | null;
  last_error: string | null;
};

const DEFAULT_STATE_PATH = join(homedir(), "Library", "Application Support", "HUG", "julian-live-session-relay.json");

/**
 * Reads the Mac-local Codex delivery relay receipt. The relay is intentionally
 * external to the Next process, so a healthy session runner alone cannot be
 * mistaken for a healthy Julian delivery path.
 */
export function localJulianRelayStatus(): LocalRelayStatus {
  const path = process.env.HUG_LOCAL_RELAY_STATE_PATH?.trim() || DEFAULT_STATE_PATH;

  try {
    const value = JSON.parse(readFileSync(/* turbopackIgnore: true */ path, "utf8")) as Record<string, unknown>;
    const updatedAt = iso(value.updated_at);
    const intervalSeconds = positiveNumber(value.interval_seconds) ?? 5;

    if (!updatedAt || Date.now() - Date.parse(updatedAt) > Math.max(30_000, intervalSeconds * 3_000)) {
      return {
        status: "stale",
        updated_at: updatedAt,
        last_poll_at: iso(value.last_poll_at),
        last_delivery_at: iso(value.last_delivery_at),
        last_error: text(value.last_error)
      };
    }

    return {
      status: relayStatus(value.status),
      updated_at: updatedAt,
      last_poll_at: iso(value.last_poll_at),
      last_delivery_at: iso(value.last_delivery_at),
      last_error: text(value.last_error)
    };
  } catch {
    return {
      status: "offline",
      updated_at: null,
      last_poll_at: null,
      last_delivery_at: null,
      last_error: null
    };
  }
}

function relayStatus(value: unknown): LocalRelayStatus["status"] {
  if (value === "running" || value === "starting" || value === "degraded" || value === "stopped") {
    return value;
  }

  return "unknown";
}

function iso(value: unknown) {
  const candidate = typeof value === "string" ? value : "";
  return candidate && Number.isFinite(Date.parse(candidate)) ? candidate : null;
}

function positiveNumber(value: unknown) {
  const candidate = Number(value);
  return Number.isFinite(candidate) && candidate > 0 ? candidate : null;
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
