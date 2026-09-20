const DEFAULT_PICAR_BASE_URL = "https://picar.blackcoffeeshoppe.com";
const REQUEST_TIMEOUT_MS = 10_000;

export type WheelsLiveMessage = {
  id: string;
  author_id: string;
  author_display_name: string;
  content: string;
  created_at: string;
};

type WheelsLiveState = {
  messages: WheelsLiveMessage[];
};

/**
 * Reads the PiCar ride log for the Live Session Host.
 *
 * This adapter is deliberately read-only. A HUG live-session participant is
 * present in the WHEELS coordination room, not in the physical car. Passenger
 * enrollment and wheel custody remain explicit PiCar actions.
 */
export async function loadWheelsLiveMessages() {
  // Test suites seed the in-memory source directly. They never need a live
  // PiCar or an outbound network dependency to verify session semantics.
  if (process.env.NODE_ENV === "test") {
    return latestWheelsLiveMessages();
  }

  const baseUrl = (process.env.PICAR_BASE_URL || DEFAULT_PICAR_BASE_URL).replace(/\/+$/, "");
  const response = await fetch(`${baseUrl}/observe`, {
    cache: "no-store",
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });

  if (!response.ok) {
    throw new Error(`PiCar ride log returned ${response.status}.`);
  }

  const body = await response.json() as { log?: unknown };
  const messages = normalizeRideLog(body.log);
  globalWheelsLiveState().messages = messages;

  return messages;
}

export function latestWheelsLiveMessages() {
  return globalWheelsLiveState().messages;
}

function normalizeRideLog(value: unknown): WheelsLiveMessage[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item, index): WheelsLiveMessage | null => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return null;
      }

      const record = item as Record<string, unknown>;
      const author = String(record.author ?? "PiCar").trim() || "PiCar";
      const content = String(record.message ?? "").trim();
      const timestamp = Number(record.ts);

      // Events without a Pi timestamp can still appear in the room UI, but
      // cannot safely participate in incremental live-session delivery.
      if (!content || !Number.isFinite(timestamp) || timestamp <= 0) {
        return null;
      }

      const createdAt = new Date(timestamp * 1_000);

      if (Number.isNaN(createdAt.getTime())) {
        return null;
      }

      const created_at = createdAt.toISOString();
      const normalizedAuthor = author.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "picar";
      const author_id = normalizedAuthor === "chris" || normalizedAuthor === "operator"
        ? "operator:chris"
        : normalizedAuthor === "soren" || normalizedAuthor === "varro" || normalizedAuthor === "julian" || normalizedAuthor === "cael"
          ? `agent:${normalizedAuthor}`
          : `wheels:${normalizedAuthor}`;

      return {
        id: `${author_id}:${timestamp}:${index}`,
        author_id,
        author_display_name: author,
        content,
        created_at
      };
    })
    .filter((message): message is WheelsLiveMessage => Boolean(message))
    .sort((left, right) => right.created_at.localeCompare(left.created_at));
}

function globalWheelsLiveState(): WheelsLiveState {
  const globalKey = "__hug_wheels_live_state__";
  const globalStore = globalThis as typeof globalThis & {
    [globalKey]?: WheelsLiveState;
  };

  if (!globalStore[globalKey]) {
    globalStore[globalKey] = { messages: [] };
  }

  return globalStore[globalKey];
}
