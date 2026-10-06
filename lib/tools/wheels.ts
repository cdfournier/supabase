import "server-only";

import type { AgentName } from "@/lib/agent-context";

const DEFAULT_PICAR_BASE_URL = "https://picar.blackcoffeeshoppe.com";
const MAX_MESSAGE_LENGTH = 800;
const MAX_QUEUE_INTENTION_LENGTH = 240;
const DEFAULT_LOG_LIMIT = 12;
const MAX_LOG_LIMIT = 25;

/**
 * WHEELS room tools support explicit, Operator-visible ride participation.
 * They never acquire/release the wheel or issue a motion command.
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

export async function joinWheelsRide(agent: AgentName, input: unknown) {
  requireEmptyObject(input, "wheels_join_ride");

  const result = await postPiJson("/passengers", {
    action: "join",
    name: displayName(agent)
  });

  return stringifyPayload({
    note: "Joined the PiCar as a named passenger. This is visible in WHEELS but grants no wheel or motion authority.",
    passenger: displayName(agent),
    state: result
  });
}

export async function leaveWheelsRide(agent: AgentName, input: unknown) {
  requireEmptyObject(input, "wheels_leave_ride");

  const name = displayName(agent);
  const [queue, passenger] = await Promise.all([
    postPiJson("/queue", { action: "leave", name }),
    postPiJson("/passengers", { action: "leave", name })
  ]);

  return stringifyPayload({
    note: "Left the PiCar and withdrew any pending wheel request. If this agent had somehow held the wheel, the Pi stops before releasing it.",
    passenger: name,
    queue,
    state: passenger
  });
}

export async function requestWheelsTurn(agent: AgentName, input: unknown) {
  if (!isRecord(input)) {
    throw new Error("wheels_request_turn requires an object input.");
  }

  const intention = String(input.intention ?? "").trim();

  if (!intention) {
    throw new Error("wheels_request_turn requires a short intention.");
  }

  if (intention.length > MAX_QUEUE_INTENTION_LENGTH) {
    throw new Error(`wheels_request_turn intention must be ${MAX_QUEUE_INTENTION_LENGTH} characters or fewer.`);
  }

  const result = await postPiJson("/queue", {
    action: "join",
    name: displayName(agent),
    intention
  });

  return stringifyPayload({
    note: "Requested a turn in the WHEELS queue. This is a visible request only: the Operator must explicitly hand over custody before the Pi will accept motion from this agent.",
    requester: displayName(agent),
    intention,
    queue: result
  });
}

export async function withdrawWheelsTurn(agent: AgentName, input: unknown) {
  requireEmptyObject(input, "wheels_withdraw_turn");

  const result = await postPiJson("/queue", {
    action: "leave",
    name: displayName(agent)
  });

  return stringifyPayload({
    note: "Withdrew the pending WHEELS request. No passenger, wheel, or motion state changed.",
    requester: displayName(agent),
    queue: result
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

async function postPiJson(path: string, payload: Record<string, unknown>) {
  const response = await fetch(`${picarBaseUrl()}${path}`, {
    method: "POST",
    cache: "no-store",
    headers: {
      accept: "application/json",
      "content-type": "application/json"
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10_000)
  });

  if (!response.ok) {
    throw new Error(`${path} returned ${response.status}.`);
  }

  const result = await response.json() as { ok?: boolean };

  if (!result.ok) {
    throw new Error(`PiCar did not accept ${path}.`);
  }

  return result;
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

function requireEmptyObject(input: unknown, toolName: string) {
  if (!isRecord(input) || Object.keys(input).length) {
    throw new Error(`${toolName} requires an empty object input.`);
  }
}

function stringifyPayload(value: unknown) {
  return JSON.stringify(value, null, 2);
}
