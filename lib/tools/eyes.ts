import "server-only";

import { Buffer } from "node:buffer";
import type { AgentName } from "@/lib/agent-context";
import {
  eyesParticipantForAgent,
  joinEyes,
  leaveEyes,
  loadEyes,
  postEyesMessage,
  type EyesFrame,
  type EyesMessage
} from "@/lib/eyes";
import { getSupabaseAdmin } from "@/lib/supabase";
import type { ToolResultContentBlock } from "@/lib/tools/types";

const MAX_LOG_LIMIT = 20;
const DEFAULT_LOG_LIMIT = 10;
const MAX_FRAMES_RETURNED = 6;

type JsonRecord = Record<string, unknown>;

export async function joinEyesSession(agent: AgentName, input: unknown) {
  requireRecord(input, "eyes_join_session");
  const receipt = await joinEyes({
    ...eyesParticipantForAgent(agent),
    source: "eyes_join_session"
  });

  return stringifyPayload({
    note: "Joined the runtime EYES surface as an observer. Capture remains Operator-controlled.",
    room_id: "eyes-main",
    presence: {
      participant_id: receipt.participant_id,
      display_name: receipt.display_name,
      state: receipt.state,
      last_seen_at: receipt.last_seen_at
    }
  });
}

export async function leaveEyesSession(agent: AgentName, input: unknown) {
  requireRecord(input, "eyes_leave_session");
  const receipt = await leaveEyes({
    ...eyesParticipantForAgent(agent),
    source: "eyes_leave_session"
  });

  return stringifyPayload({
    note: "Left the runtime EYES surface.",
    room_id: "eyes-main",
    presence: {
      participant_id: receipt.participant_id,
      display_name: receipt.display_name,
      state: receipt.state,
      last_seen_at: receipt.last_seen_at
    }
  });
}

export async function observeEyesSession(agent: AgentName, input: unknown) {
  const body = requireRecord(input, "eyes_observe");
  const content = cleanText(body.content, 2000);

  if (!content) {
    throw new Error("eyes_observe requires content.");
  }

  const message = await postEyesMessage({
    ...eyesParticipantForAgent(agent),
    source: "eyes_observe",
    kind: "observation",
    content
  });

  return stringifyPayload({
    note: "Posted an observation/message to the runtime EYES log.",
    room_id: message.room_id,
    message_id: message.id,
    created_at: message.created_at
  });
}

export async function getEyesSession(input: unknown): Promise<string | ToolResultContentBlock[]> {
  const body = requireRecord(input, "eyes_get_session");
  const includeFrames = body.include_frames !== false;
  const logLimit = clampNumber(body.log_limit, DEFAULT_LOG_LIMIT, 0, MAX_LOG_LIMIT);
  const frameLimit = clampNumber(body.frame_limit, MAX_FRAMES_RETURNED, 0, MAX_FRAMES_RETURNED);
  const session = await loadEyes();
  const selectedFrames = includeFrames ? session.frames.slice(0, frameLimit) : [];
  const text = stringifyPayload({
    note: selectedFrames.length
      ? "Read the runtime EYES surface. The returned image blocks are the latest frame(s). Treat multiple frames as motion across time."
      : "Read the runtime EYES surface. No image frames are attached to this tool result.",
    room: session.room,
    presence: session.presence,
    frame_count: session.frames.length,
    returned_frame_count: selectedFrames.length,
    frames: selectedFrames.map(slimFrame),
    log: session.messages.slice(0, logLimit).map(slimMessage),
    generated_at: session.generated_at
  });

  if (!selectedFrames.length) {
    return text;
  }

  return [
    { type: "text", text },
    ...(await imageBlocksForFrames(selectedFrames))
  ];
}

function requireRecord(input: unknown, toolName: string): JsonRecord {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error(`${toolName} requires an object input.`);
  }

  return input as JsonRecord;
}

async function imageBlocksForFrames(frames: EyesFrame[]): Promise<ToolResultContentBlock[]> {
  const blocks: ToolResultContentBlock[] = [];

  for (const frame of frames) {
    const mediaType = imageMediaType(frame.mime_type);

    if (!mediaType || !frame.bucket || !frame.storage_path) {
      continue;
    }

    const buffer = await downloadFrame(frame);
    blocks.push({
      type: "image",
      source: {
        type: "base64",
        media_type: mediaType,
        data: buffer.toString("base64")
      }
    });
  }

  return blocks;
}

async function downloadFrame(frame: EyesFrame) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.storage
    .from(String(frame.bucket))
    .download(String(frame.storage_path));

  if (error) {
    throw new Error(`Could not download EYES frame ${frame.title}: ${error.message}`);
  }

  return Buffer.from(await data.arrayBuffer());
}

function imageMediaType(value: string | null | undefined) {
  const mime = String(value ?? "").split(";")[0].trim().toLowerCase();

  if (mime === "image/jpeg" || mime === "image/png" || mime === "image/gif" || mime === "image/webp") {
    return mime;
  }

  return null;
}

function slimMessage(message: EyesMessage) {
  return {
    id: message.id,
    kind: message.kind,
    author: message.author_display_name,
    content: message.content,
    frame_count: typeof message.metadata.frame_count === "number" ? message.metadata.frame_count : 0,
    created_at: message.created_at
  };
}

function slimFrame(frame: EyesFrame) {
  return {
    id: frame.id,
    title: frame.title,
    material_type: frame.material_type,
    mime_type: frame.mime_type,
    size_bytes: frame.size_bytes,
    captured_at: frame.captured_at,
    sequence: frame.sequence
  };
}

function cleanText(value: unknown, maxChars: number) {
  return typeof value === "string" ? value.trim().slice(0, maxChars) : "";
}

function clampNumber(value: unknown, fallback: number, min: number, max: number) {
  const numeric = typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : fallback;
  return Math.max(min, Math.min(max, numeric));
}

function stringifyPayload(payload: unknown) {
  return JSON.stringify(payload, null, 2);
}
