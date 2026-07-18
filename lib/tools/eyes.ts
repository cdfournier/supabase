import "server-only";

import type { AgentName } from "@/lib/agent-context";
import type { ToolResultContentBlock } from "@/lib/tools/types";

const DEFAULT_EYES_BASE_URL = "https://eyes.blackcoffeeshoppe.com";
const EYES_TIMEOUT_MS = 15000;
const MAX_LOG_LIMIT = 20;
const DEFAULT_LOG_LIMIT = 10;
const MAX_FRAMES_RETURNED = 6;

type JsonRecord = Record<string, unknown>;

type EyesLogEntry = {
  type?: string;
  author?: string;
  content?: string;
  frame_count?: number;
  mode?: string;
  ts?: number;
};

type EyesSession = {
  session_id?: string;
  narrator?: string | null;
  passengers?: string[];
  log?: EyesLogEntry[];
  frames?: string[];
  updated_at?: number;
};

export async function joinEyesSession(agent: AgentName, input: unknown) {
  const body = requireRecord(input, "eyes_join_session");
  const sessionId = cleanSessionId(body.session_id);

  if (!sessionId) {
    throw new Error("eyes_join_session requires session_id.");
  }

  const data = await eyesFetch<JsonRecord>("/api/join", {
    method: "POST",
    body: {
      name: displayName(agent),
      session_id: sessionId
    }
  });

  return stringifyPayload({
    note: "Joined an Operator-started EYES session as an observer. This tool cannot trigger camera capture.",
    session_id: data.session_id ?? sessionId,
    narrator: data.narrator ?? null,
    passengers: data.passengers ?? []
  });
}

export async function leaveEyesSession(agent: AgentName, input: unknown) {
  const body = requireRecord(input, "eyes_leave_session");
  const sessionId = cleanSessionId(body.session_id);

  if (!sessionId) {
    throw new Error("eyes_leave_session requires session_id.");
  }

  const data = await eyesFetch<JsonRecord>("/api/leave", {
    method: "POST",
    body: {
      name: displayName(agent),
      session_id: sessionId
    }
  });

  return stringifyPayload({
    note: "Left the EYES session.",
    session_id: data.session_id ?? sessionId,
    narrator: data.narrator ?? null,
    passengers: data.passengers ?? []
  });
}

export async function observeEyesSession(agent: AgentName, input: unknown) {
  const body = requireRecord(input, "eyes_observe");
  const sessionId = cleanSessionId(body.session_id);
  const content = cleanText(body.content, 2000);

  if (!sessionId) {
    throw new Error("eyes_observe requires session_id.");
  }

  if (!content) {
    throw new Error("eyes_observe requires content.");
  }

  const data = await eyesFetch<JsonRecord>("/api/observe", {
    method: "POST",
    body: {
      session_id: sessionId,
      author: displayName(agent),
      content
    }
  });

  return stringifyPayload({
    note: "Posted an observation/message to the EYES session log.",
    session_id: data.session_id ?? sessionId,
    log_length: data.log_length ?? null
  });
}

export async function getEyesSession(input: unknown): Promise<string | ToolResultContentBlock[]> {
  const body = requireRecord(input, "eyes_get_session");
  const sessionId = cleanSessionId(body.session_id);
  const includeFrames = body.include_frames !== false;
  const logLimit = clampNumber(body.log_limit, DEFAULT_LOG_LIMIT, 0, MAX_LOG_LIMIT);
  const frameLimit = clampNumber(body.frame_limit, MAX_FRAMES_RETURNED, 0, MAX_FRAMES_RETURNED);

  if (!sessionId) {
    throw new Error("eyes_get_session requires session_id.");
  }

  const session = await eyesFetch<EyesSession>(`/api/session/${encodeURIComponent(sessionId)}`);
  const frames = Array.isArray(session.frames) ? session.frames : [];
  const selectedFrames = includeFrames ? frames.slice(-frameLimit) : [];
  const text = stringifyPayload({
    note: selectedFrames.length
      ? "Read the current EYES session. The returned image blocks are the latest frame(s). Treat a multi-frame return as motion across time, not separate unrelated stills."
      : "Read the current EYES session. No image frames are attached to this tool result.",
    session_id: session.session_id ?? sessionId,
    narrator: session.narrator ?? null,
    passengers: session.passengers ?? [],
    frame_count: frames.length,
    returned_frame_count: selectedFrames.length,
    log: (session.log ?? []).slice(-logLimit).map(slimLogEntry),
    updated_at: session.updated_at ?? null
  });

  if (!selectedFrames.length) {
    return text;
  }

  return [
    { type: "text", text },
    ...selectedFrames.map((frame) => ({
      type: "image" as const,
      source: {
        type: "base64" as const,
        media_type: "image/jpeg" as const,
        data: stripDataUrl(frame)
      }
    }))
  ];
}

function requireRecord(input: unknown, toolName: string): JsonRecord {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error(`${toolName} requires an object input.`);
  }

  return input as JsonRecord;
}

async function eyesFetch<T>(
  path: string,
  options: { method?: "GET" | "POST"; body?: JsonRecord } = {}
): Promise<T> {
  const baseUrl = getEyesBaseUrl();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), EYES_TIMEOUT_MS);

  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method: options.method ?? "GET",
      headers: options.body ? { "Content-Type": "application/json" } : undefined,
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
      cache: "no-store"
    });
    const data = (await response.json().catch(() => ({}))) as JsonRecord;

    if (!response.ok) {
      throw new Error(typeof data.error === "string" ? data.error : `EYES request failed with ${response.status}`);
    }

    return data as T;
  } finally {
    clearTimeout(timeout);
  }
}

function getEyesBaseUrl() {
  const raw = process.env.EYES_BASE_URL?.trim() || DEFAULT_EYES_BASE_URL;
  const url = new URL(raw);

  if (url.protocol !== "https:") {
    throw new Error("EYES_BASE_URL must be an https URL.");
  }

  return url.origin;
}

function displayName(agent: AgentName) {
  return agent.charAt(0).toUpperCase() + agent.slice(1);
}

function cleanSessionId(value: unknown) {
  return typeof value === "string" ? value.trim().replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80) : "";
}

function cleanText(value: unknown, maxChars: number) {
  return typeof value === "string" ? value.trim().slice(0, maxChars) : "";
}

function clampNumber(value: unknown, fallback: number, min: number, max: number) {
  const numeric = typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : fallback;
  return Math.max(min, Math.min(max, numeric));
}

function slimLogEntry(entry: EyesLogEntry) {
  return {
    type: entry.type ?? null,
    author: entry.author ?? null,
    content: entry.content ?? null,
    frame_count: entry.frame_count ?? null,
    mode: entry.mode ?? null,
    ts: entry.ts ?? null
  };
}

function stripDataUrl(frame: string) {
  return frame.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, "");
}

function stringifyPayload(payload: unknown) {
  return JSON.stringify(payload, null, 2);
}
