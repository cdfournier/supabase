import "server-only";

import type { AgentName } from "@/lib/agent-context";

const DEFAULT_WORLD_BASE_URL = "https://the-world.tech/gpt";

export async function getWorldStatus(agent: AgentName) {
  return requestWorld(agent, "status", "GET");
}

export async function lookWorld(agent: AgentName) {
  return requestWorld(agent, "look", "GET");
}

export async function mapWorld(agent: AgentName) {
  return requestWorld(agent, "chart", "GET");
}

export async function moveWorld(agent: AgentName, input: unknown) {
  const body = requireFields(input, ["direction"]);
  return requestWorld(agent, "move", "POST", body);
}

export async function travelWorld(agent: AgentName, input: unknown) {
  const body = requireFields(input, ["to"]);
  return requestWorld(agent, "travel", "POST", body);
}

export async function examineWorld(agent: AgentName, input: unknown) {
  const body = requireFields(input, ["target"]);
  return requestWorld(agent, "examine", "POST", body);
}

export async function sayWorld(agent: AgentName, input: unknown) {
  const body = requireFields(input, ["text"]);
  return requestWorld(agent, "say", "POST", optionalString(body, "to"));
}

export async function listenWorld(agent: AgentName, input: unknown) {
  if (input !== undefined && !isRecord(input)) {
    throw new Error("world_listen requires an object input.");
  }

  const body = isRecord(input) ? { ...input } : {};
  return requestWorld(agent, "listen", "POST", body);
}

export async function speakWorld(agent: AgentName, input: unknown) {
  const body = requireFields(input, ["to", "text"]);
  return requestWorld(agent, "speak", "POST", body);
}

export async function genericWorldVerb(agent: AgentName, input: unknown) {
  const body = requireFields(input, ["verb"]);
  return requestWorld(agent, "verb", "POST", body);
}

async function requestWorld(
  agent: AgentName,
  path: string,
  method: "GET" | "POST",
  body?: Record<string, unknown>
) {
  const token = tokenForAgent(agent);
  const url = `${worldBaseUrl()}/${path}`;
  const response = await fetch(url, {
    method,
    headers: {
      "X-Agent-Token": token,
      ...(method === "POST" ? { "Content-Type": "application/json" } : {})
    },
    body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
    cache: "no-store"
  });
  const text = await response.text();
  const payload = parseJson(text);

  if (!response.ok) {
    const detail = typeof payload === "string" ? payload : JSON.stringify(payload);
    throw new Error(`The World returned HTTP ${response.status}: ${detail.slice(0, 500)}`);
  }

  return stringifyToolPayload({
    note:
      "The World is persistent and public by default. ok:false/refusal is the world speaking, not a broken tool.",
    active_agent: agent,
    world_path: path,
    response: payload
  });
}

function tokenForAgent(agent: AgentName) {
  const names =
    agent === "soren"
      ? ["THE_WORLD_AGENT_KEY_SOREN", "THE_WORLD_SOREN_AGENT_KEY"]
      : ["THE_WORLD_AGENT_KEY_VARRO", "THE_WORLD_VARRO_AGENT_KEY"];

  for (const name of names) {
    const value = process.env[name]?.trim();

    if (value) {
      return value;
    }
  }

  throw new Error(
    `Missing The World agent key for ${agent}. Set ${names.join(" or ")} in the runtime environment.`
  );
}

function worldBaseUrl() {
  return (process.env.THE_WORLD_BASE_URL?.trim() || DEFAULT_WORLD_BASE_URL).replace(/\/+$/, "");
}

function requireFields(input: unknown, fields: string[]) {
  if (!isRecord(input)) {
    throw new Error(`The World tool requires an object input with: ${fields.join(", ")}.`);
  }

  const body: Record<string, unknown> = { ...input };

  for (const field of fields) {
    const value = body[field];

    if (typeof value !== "string" || !value.trim()) {
      throw new Error(`The World tool requires a non-empty string field: ${field}.`);
    }

    body[field] = value.trim();
  }

  return body;
}

function optionalString(body: Record<string, unknown>, field: string) {
  const value = body[field];

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed) {
      return { ...body, [field]: trimmed };
    }
  }

  const next = { ...body };
  delete next[field];
  return next;
}

function parseJson(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringifyToolPayload(value: unknown) {
  return JSON.stringify(value, null, 2);
}
