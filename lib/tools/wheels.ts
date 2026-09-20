import "server-only";

import type { AgentName } from "@/lib/agent-context";

const DEFAULT_PICAR_BASE_URL = "https://picar.blackcoffeeshoppe.com";
const MAX_MESSAGE_LENGTH = 800;
const DEFAULT_LOG_LIMIT = 12;
const MAX_LOG_LIMIT = 25;

/**
 * WHEELS coordination tools deliberately stop at conversation. They do not
 * enroll a passenger, acquire/release the wheel, or issue a motion command.
 */
export async function readWheelsRoom(agent: AgentName, input: unknown) {
  if (input !== undefined && !isRecord(input)) {
    throw new Error("wheels_read_room requires an object input.");
  }

  const limit = clampNumber(
    isRecord(input) ? input.limit : undefined,
    DEFAULT_LOG_LIMIT,
    1,
    MAX_LOG_LIMIT
  );
  const baseUrl = picarBaseUrl();
  const [readiness, observe, passengers, queue] = await Promise.all([
    readJson(baseUrl, "/readiness"),
    readJson(baseUrl, "/observe"),
    readJson(baseUrl, "/passengers"),
    readJson(baseUrl, "/queue")
  ]);

  const log = isRecord(observe) && Array.isArray(observe.log) ? observe.log.slice(-limit).reverse() : [];

  return stringifyPayload({
    note: "Read the WHEELS coordination room. This gives no passenger, wheel, or motion authority.",
    active_agent: displayName(agent),
    readiness,
    passengers,
    queue,
    recent_ride_log: log,
    limits: { requested_messages: limit, max_messages: MAX_LOG_LIMIT }
  });
}

export async function postWheelsRoomMessage(agent: AgentName, input: unknown) {
  if (!isRecord(input)) {
    throw new Error("wheels_post_message requires an object input.");
  }

  const content = String(input.content ?? "").trim();

  if (!content) {
    throw new Error("wheels_post_message requires content.");
  }

  if (content.length > MAX_MESSAGE_LENGTH) {
    throw new Error(`wheels_post_message content must be ${MAX_MESSAGE_LENGTH} characters or fewer.`);
  }

  const baseUrl = picarBaseUrl();
  const response = await fetch(`${baseUrl}/observe`, {
    method: "POST",
    cache: "no-store",
    headers: {
      accept: "application/json",
      "content-type": "application/json"
    },
    body: JSON.stringify({ author: displayName(agent), message: content }),
    signal: AbortSignal.timeout(10_000)
  });

  if (!response.ok) {
    throw new Error(`PiCar ride log returned ${response.status}.`);
  }

  const result = await response.json() as { ok?: boolean };

  if (!result.ok) {
    throw new Error("PiCar did not accept the WHEELS room message.");
  }

  return stringifyPayload({
    note: "Posted a WHEELS coordination-room message. No passenger, wheel, or motion state changed.",
    author: displayName(agent)
  });
}

function picarBaseUrl() {
  return (process.env.PICAR_BASE_URL || DEFAULT_PICAR_BASE_URL).replace(/\/+$/, "");
}

async function readJson(baseUrl: string, path: string) {
  const response = await fetch(`${baseUrl}${path}`, {
    cache: "no-store",
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(10_000)
  });

  if (!response.ok) {
    throw new Error(`${path} returned ${response.status}.`);
  }

  return response.json();
}

function displayName(agent: AgentName) {
  return agent.replace(/^\w/, (letter) => letter.toUpperCase());
}

function clampNumber(value: unknown, fallback: number, min: number, max: number) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.floor(number))) : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringifyPayload(value: unknown) {
  return JSON.stringify(value, null, 2);
}
