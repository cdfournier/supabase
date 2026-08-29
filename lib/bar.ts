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

const BAR_MESSAGE_LIMIT = 50;

type BarMessage = {
  id: string;
  room_id: string;
  author_id: string;
  author_type: PresenceParticipantType;
  author_display_name: string;
  content: string;
  metadata: Record<string, unknown>;
  created_at: string;
};

type BarState = {
  messages: BarMessage[];
};

type BarParticipantInput = {
  participant_id: string;
  participant_type?: PresenceParticipantType;
  display_name?: string;
  source?: string;
  metadata?: Record<string, unknown>;
};

type BarMessageInput = BarParticipantInput & {
  content: string;
  attachments?: SourceMaterialReference[];
};

const BAR_ROOM_ID = "bar-main";
const BAR_STATE_KEY = "bar_state_v1";
const state = globalBarState();
let hydrated = false;

export async function loadBar() {
  await ensureBarHydrated();

  return {
    generated_at: new Date().toISOString(),
    room: {
      id: BAR_ROOM_ID,
      title: "BAR",
      status: "live_v1",
      metadata: {
        presence_contract: "camp_1_presence_layer_v1",
        storage: "runtime_settings_json",
        note: "First proof surface for Presence Layer; V1 state is durable through runtime_settings JSON."
      }
    },
    adapters: listPresenceAdapters(),
    presence: listPresence({ surface: "bar" }),
    messages: state.messages.slice(0, BAR_MESSAGE_LIMIT),
    message_limit: BAR_MESSAGE_LIMIT
  };
}

export async function joinBar(input: BarParticipantInput) {
  await ensureBarHydrated();

  const receipt = upsertPresenceReceipt({
    surface: "bar",
    participant_id: input.participant_id,
    participant_type: input.participant_type,
    display_name: input.display_name,
    source: input.source ?? "bar_join",
    metadata: input.metadata
  });

  await persistBarState();

  return receipt;
}

export async function leaveBar(input: BarParticipantInput) {
  await ensureBarHydrated();

  const receipt = leavePresence({
    surface: "bar",
    participant_id: input.participant_id,
    participant_type: input.participant_type,
    display_name: input.display_name,
    source: input.source ?? "bar_leave",
    metadata: input.metadata
  });

  await persistBarState();

  return receipt;
}

export async function postBarMessage(input: BarMessageInput) {
  await ensureBarHydrated();

  const content = input.content.trim();
  const attachments = input.attachments ?? [];

  if (!content && !attachments.length) {
    throw new Error("BAR message is required.");
  }

  const presence = upsertPresenceReceipt({
    surface: "bar",
    participant_id: input.participant_id,
    participant_type: input.participant_type,
    display_name: input.display_name,
    source: input.source ?? "bar_post",
    metadata: input.metadata
  });
  const message: BarMessage = {
    id: crypto.randomUUID(),
    room_id: BAR_ROOM_ID,
    author_id: presence.participant_id,
    author_type: presence.participant_type,
    author_display_name: presence.display_name,
    content: content || "Shared attachment.",
    metadata: {
      source: input.source ?? "bar_post",
      presence_receipt_id: presence.id,
      post_compile_observation: null,
      attachments: attachments.map((attachment) => ({
        id: attachment.id,
        title: attachment.title,
        bucket: attachment.bucket,
        storage_path: attachment.storage_path,
        material_type: attachment.material_type,
        mime_type: attachment.mime_type,
        size_bytes: attachment.size_bytes,
        readable_as_text: attachment.readable_as_text,
        metadata: attachment.metadata ?? null
      }))
    },
    created_at: new Date().toISOString()
  };

  state.messages = [message, ...state.messages].slice(0, BAR_MESSAGE_LIMIT);
  await persistBarState();

  return message;
}

export function barParticipantForAgent(agent: "soren" | "varro") {
  return {
    participant_id: `agent:${agent}`,
    participant_type: "agent" as const,
    display_name: agent === "soren" ? "Soren" : "Varro",
    source: "runtime_native"
  };
}

function globalBarState() {
  const globalKey = "__hug_bar_state__";
  const globalStore = globalThis as typeof globalThis & {
    [globalKey]?: BarState;
  };

  if (!globalStore[globalKey]) {
    globalStore[globalKey] = {
      messages: []
    };
  }

  return globalStore[globalKey];
}

async function ensureBarHydrated() {
  if (hydrated) {
    return;
  }

  hydrated = true;

  if (!durabilityEnabled()) {
    return;
  }

  const { readRuntimeSettingValue } = await import("./runtime-settings.ts");
  const value = await readRuntimeSettingValue(BAR_STATE_KEY);

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return;
  }

  const record = value as Record<string, unknown>;
  state.messages = normalizeBarMessages(record.messages);
  importPresenceReceipts(record.presence);
}

async function persistBarState() {
  if (!durabilityEnabled()) {
    return;
  }

  const { writeRuntimeSettingValue } = await import("./runtime-settings.ts");
  await writeRuntimeSettingValue(BAR_STATE_KEY, {
    version: BAR_STATE_KEY,
    messages: state.messages,
    presence: exportPresenceReceipts().filter((receipt) => receipt.surface === "bar"),
    updated_at: new Date().toISOString()
  });
}

function durabilityEnabled() {
  return process.env.NODE_ENV !== "test";
}

function normalizeBarMessages(value: unknown): BarMessage[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(normalizeBarMessage)
    .filter((message): message is BarMessage => Boolean(message))
    .slice(0, BAR_MESSAGE_LIMIT);
}

function normalizeBarMessage(value: unknown): BarMessage | null {
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
    room_id: String(record.room_id ?? BAR_ROOM_ID),
    author_id: String(record.author_id ?? "system:unknown"),
    author_type: normalizeParticipantType(record.author_type),
    author_display_name: String(record.author_display_name ?? "Unknown"),
    content,
    metadata: normalizeMetadata(record.metadata),
    created_at: createdAt
  };
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
