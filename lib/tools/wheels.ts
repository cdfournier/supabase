import "server-only";

import type { AgentName } from "@/lib/agent-context";

const DEFAULT_PICAR_BASE_URL = "https://picar.blackcoffeeshoppe.com";
const MAX_MESSAGE_LENGTH = 800;
const MAX_QUEUE_INTENTION_LENGTH = 240;
const MAX_AGENT_SPEED = 40;
const MAX_AGENT_DURATION_SECONDS = 3;
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

export async function takeWheelsWheel(agent: AgentName, input: unknown) {
  requireEmptyObject(input, "wheels_take_wheel");

  const name = displayName(agent);
  const queueState = await readJson(picarBaseUrl(), "/queue");
  const driver = isRecord(queueState) ? normalizedText(queueState.driver) : "";
  const queue = isRecord(queueState) && Array.isArray(queueState.queue) ? queueState.queue : [];
  const nextUp = isRecord(queue[0]) ? normalizedText(queue[0].name) : "";

  if (driver) {
    throw new Error(`The wheel is held by ${driver}. Wait for it to be released before taking it.`);
  }

  if (nextUp && nextUp !== name) {
    throw new Error(`${nextUp} is first in the WHEELS queue. Wait for their turn or for the queue to clear.`);
  }

  const result = await postPiJson("/handoff", { action: "take", driver: name });

  return stringifyPayload({
    note: "Took the currently unassigned WHEELS wheel as a named, persistent-permission driver. The Pi has stopped and reset prior motion before custody begins. Use bounded drive segments; Pull Over always stops and releases.",
    driver: name,
    state: result
  });
}

export async function driveWheels(agent: AgentName, input: unknown) {
  if (!isRecord(input)) {
    throw new Error("wheels_drive requires an object input.");
  }

  const direction = normalizedText(input.direction).toLowerCase();

  if (direction !== "forward" && direction !== "backward") {
    throw new Error("wheels_drive direction must be forward or backward.");
  }

  const angle = boundedNumber(input.angle, 0, -35, 35, "wheels_drive angle");
  const speed = boundedNumber(input.speed, 20, 1, MAX_AGENT_SPEED, "wheels_drive speed");
  const duration = boundedDecimal(
    input.duration_seconds,
    1,
    0.1,
    MAX_AGENT_DURATION_SECONDS,
    "wheels_drive duration_seconds"
  );
  const name = displayName(agent);
  const result = await postPiJson("/drive", {
    driver: name,
    direction,
    angle,
    speed,
    duration
  });

  return stringifyPayload({
    note: "Completed one bounded WHEELS drive segment. The Pi stops at the end of the requested duration; active custody remains named until the driver releases or pulls over.",
    driver: name,
    direction,
    angle,
    speed,
    duration_seconds: duration,
    state: result
  });
}

export async function releaseWheelsWheel(agent: AgentName, input: unknown) {
  requireEmptyObject(input, "wheels_release_wheel");

  const name = displayName(agent);
  const result = await postPiJson("/handoff", { action: "release", driver: name });

  return stringifyPayload({
    note: "Released the WHEELS wheel. The Pi stopped before releasing custody.",
    driver: name,
    state: result
  });
}

export async function pullOverWheels(agent: AgentName, input: unknown) {
  requireEmptyObject(input, "wheels_pull_over");

  const name = displayName(agent);
  const result = await postPiJson("/pull-over", { driver: name });

  return stringifyPayload({
    note: "Pulled over: the Pi stopped the car and atomically released the WHEELS wheel.",
    driver: name,
    state: result
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

function normalizedText(value: unknown) {
  return String(value ?? "").trim();
}

function boundedNumber(value: unknown, fallback: number, min: number, max: number, label: string) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const number = Number(value);

  if (!Number.isFinite(number) || number < min || number > max) {
    throw new Error(`${label} must be between ${min} and ${max}.`);
  }

  return Math.round(number);
}

function boundedDecimal(value: unknown, fallback: number, min: number, max: number, label: string) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const number = Number(value);

  if (!Number.isFinite(number) || number < min || number > max) {
    throw new Error(`${label} must be between ${min} and ${max}.`);
  }

  return number;
}

function stringifyPayload(value: unknown) {
  return JSON.stringify(value, null, 2);
}
