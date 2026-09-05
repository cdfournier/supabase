import {
  type PresenceParticipantType,
  exportPresenceReceipts,
  importPresenceReceipts,
  listPresence,
  listPresenceAdapters,
  leavePresence,
  upsertPresenceReceipt
} from "./presence.ts";
import type { SourceMaterialReference } from "./source-materials-shared.ts";

const EYES_MESSAGE_LIMIT = 50;
const EYES_FRAME_LIMIT = 6;

export type EyesMessageKind = "message" | "capture" | "observation" | "system";

export type EyesMessage = {
  id: string;
  room_id: string;
  kind: EyesMessageKind;
  author_id: string;
  author_type: PresenceParticipantType;
  author_display_name: string;
  content: string;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type EyesFrame = SourceMaterialReference & {
  captured_at: string;
  sequence: number;
};

type EyesState = {
  messages: EyesMessage[];
  frames: EyesFrame[];
};

type EyesParticipantInput = {
  participant_id: string;
  participant_type?: PresenceParticipantType;
  display_name?: string;
  source?: string;
  metadata?: Record<string, unknown>;
};

type EyesPostInput = EyesParticipantInput & {
  content: string;
  kind?: EyesMessageKind;
  frames?: SourceMaterialReference[];
};

const EYES_ROOM_ID = "eyes-main";
const EYES_STATE_KEY = "eyes_state_v1";
const state = globalEyesState();
let hydrated = false;

export async function loadEyes() {
  await ensureEyesHydrated();

  return {
    generated_at: new Date().toISOString(),
    room: {
      id: EYES_ROOM_ID,
      title: "EYES",
      status: "live_v1",
      metadata: {
        presence_contract: "camp_2_eyes_observation_v1",
        storage: "runtime_settings_json",
        frame_limit: EYES_FRAME_LIMIT,
        note: "Runtime-native EYES surface. Operator controls capture; agents observe shared frames and room messages."
      }
    },
    adapters: listPresenceAdapters(),
    presence: listPresence({ surface: "eyes" }),
    messages: state.messages.slice(0, EYES_MESSAGE_LIMIT),
    frames: state.frames.slice(0, EYES_FRAME_LIMIT),
    message_limit: EYES_MESSAGE_LIMIT,
    frame_limit: EYES_FRAME_LIMIT
  };
}

export async function joinEyes(input: EyesParticipantInput) {
  await ensureEyesHydrated();

  const receipt = upsertPresenceReceipt({
    surface: "eyes",
    participant_id: input.participant_id,
    participant_type: input.participant_type,
    display_name: input.display_name,
    source: input.source ?? "eyes_join",
    metadata: input.metadata
  });

  await persistEyesState();

  return receipt;
}

export async function leaveEyes(input: EyesParticipantInput) {
  await ensureEyesHydrated();

  const receipt = leavePresence({
    surface: "eyes",
    participant_id: input.participant_id,
    participant_type: input.participant_type,
    display_name: input.display_name,
    source: input.source ?? "eyes_leave",
    metadata: input.metadata
  });

  await persistEyesState();

  return receipt;
}

export async function postEyesMessage(input: EyesPostInput) {
  await ensureEyesHydrated();

  const content = input.content.trim();
  const frames = input.frames ?? [];

  if (!content && !frames.length) {
    throw new Error("EYES message or frame is required.");
  }

  const presence = upsertPresenceReceipt({
    surface: "eyes",
    participant_id: input.participant_id,
    participant_type: input.participant_type,
    display_name: input.display_name,
    source: input.source ?? "eyes_post",
    metadata: input.metadata
  });
  const now = new Date().toISOString();
  const kind = frames.length ? "capture" : input.kind ?? "message";
  const capturedFrames = frames.map((frame, index) => ({
    ...frame,
    captured_at: now,
    sequence: index + 1
  }));
  const message: EyesMessage = {
    id: crypto.randomUUID(),
    room_id: EYES_ROOM_ID,
    kind,
    author_id: presence.participant_id,
    author_type: presence.participant_type,
    author_display_name: presence.display_name,
    content: content || frameMessage(capturedFrames.length),
    metadata: {
      source: input.source ?? "eyes_post",
      presence_receipt_id: presence.id,
      frame_count: capturedFrames.length,
      frames: capturedFrames.map((frame) => frameReference(frame))
    },
    created_at: now
  };

  if (capturedFrames.length) {
    state.frames = [...capturedFrames.reverse(), ...state.frames].slice(0, EYES_FRAME_LIMIT);
  }

  state.messages = [message, ...state.messages].slice(0, EYES_MESSAGE_LIMIT);
  await persistEyesState();

  return message;
}

export function eyesParticipantForAgent(agent: "soren" | "varro") {
  return {
    participant_id: `agent:${agent}`,
    participant_type: "agent" as const,
    display_name: agent === "soren" ? "Soren" : "Varro",
    source: "runtime_native"
  };
}

function frameMessage(frameCount: number) {
  return frameCount === 1 ? "Shared 1 EYES frame." : `Shared ${frameCount} EYES frames.`;
}

function frameReference(frame: EyesFrame) {
  return {
    id: frame.id,
    title: frame.title,
    bucket: frame.bucket,
    storage_path: frame.storage_path,
    material_type: frame.material_type,
    mime_type: frame.mime_type,
    size_bytes: frame.size_bytes,
    readable_as_text: frame.readable_as_text,
    metadata: frame.metadata ?? null,
    captured_at: frame.captured_at,
    sequence: frame.sequence
  };
}

function globalEyesState() {
  const globalKey = "__hug_eyes_state__";
  const globalStore = globalThis as typeof globalThis & {
    [globalKey]?: EyesState;
  };

  if (!globalStore[globalKey]) {
    globalStore[globalKey] = {
      messages: [],
      frames: []
    };
  }

  return globalStore[globalKey];
}

async function ensureEyesHydrated() {
  if (hydrated) {
    return;
  }

  hydrated = true;

  if (!durabilityEnabled()) {
    return;
  }

  const { readRuntimeSettingValue } = await import("./runtime-settings.ts");
  const value = await readRuntimeSettingValue(EYES_STATE_KEY);

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return;
  }

  const record = value as Record<string, unknown>;
  state.messages = normalizeEyesMessages(record.messages);
  state.frames = normalizeEyesFrames(record.frames);
  importPresenceReceipts(record.presence);
}

async function persistEyesState() {
  if (!durabilityEnabled()) {
    return;
  }

  const { writeRuntimeSettingValue } = await import("./runtime-settings.ts");
  await writeRuntimeSettingValue(EYES_STATE_KEY, {
    version: EYES_STATE_KEY,
    messages: state.messages,
    frames: state.frames,
    presence: exportPresenceReceipts().filter((receipt) => receipt.surface === "eyes"),
    updated_at: new Date().toISOString()
  });
}

function durabilityEnabled() {
  return process.env.NODE_ENV !== "test";
}

function normalizeEyesMessages(value: unknown): EyesMessage[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(normalizeEyesMessage)
    .filter((message): message is EyesMessage => Boolean(message))
    .slice(0, EYES_MESSAGE_LIMIT);
}

function normalizeEyesMessage(value: unknown): EyesMessage | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const content = String(record.content ?? "").trim();
  const createdAt = String(record.created_at ?? "").trim();

  if (!content || !Number.isFinite(Date.parse(createdAt))) {
    return null;
  }

  return {
    id: String(record.id ?? crypto.randomUUID()),
    room_id: String(record.room_id ?? EYES_ROOM_ID),
    kind: normalizeKind(record.kind),
    author_id: String(record.author_id ?? "system:unknown"),
    author_type: normalizeParticipantType(record.author_type),
    author_display_name: String(record.author_display_name ?? "Unknown"),
    content,
    metadata: normalizeMetadata(record.metadata),
    created_at: createdAt
  };
}

function normalizeEyesFrames(value: unknown): EyesFrame[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(normalizeEyesFrame)
    .filter((frame): frame is EyesFrame => Boolean(frame))
    .slice(0, EYES_FRAME_LIMIT);
}

function normalizeEyesFrame(value: unknown): EyesFrame | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const id = String(record.id ?? "").trim();
  const title = String(record.title ?? "").trim();
  const capturedAt = String(record.captured_at ?? "").trim();

  if (!id || !title || !Number.isFinite(Date.parse(capturedAt))) {
    return null;
  }

  return {
    id,
    title,
    bucket: typeof record.bucket === "string" ? record.bucket : undefined,
    storage_path: typeof record.storage_path === "string" ? record.storage_path : undefined,
    material_type: String(record.material_type ?? "image"),
    mime_type: typeof record.mime_type === "string" ? record.mime_type : null,
    size_bytes: typeof record.size_bytes === "number" ? record.size_bytes : null,
    readable_as_text: record.readable_as_text === true,
    metadata: normalizeMetadata(record.metadata),
    captured_at: capturedAt,
    sequence: typeof record.sequence === "number" ? record.sequence : 1
  };
}

function normalizeKind(value: unknown): EyesMessageKind {
  if (value === "message" || value === "capture" || value === "observation" || value === "system") {
    return value;
  }

  return "message";
}

function normalizeParticipantType(value: unknown): PresenceParticipantType {
  if (value === "operator" || value === "agent" || value === "system" || value === "external_agent") {
    return value;
  }

  return "system";
}

function normalizeMetadata(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
