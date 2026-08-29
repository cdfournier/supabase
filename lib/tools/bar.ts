import "server-only";

import type { AgentName } from "@/lib/agent-context";
import { barParticipantForAgent, loadBar, postBarMessage } from "@/lib/bar";

const BAR_TOOL_MESSAGE_LIMIT = 25;

export async function readBarRoom(agent: AgentName, input: unknown) {
  if (input !== undefined && !isRecord(input)) {
    throw new Error("bar_read_room requires an object input.");
  }

  const limit = clampNumber(
    isRecord(input) ? input.limit : undefined,
    BAR_TOOL_MESSAGE_LIMIT,
    1,
    BAR_TOOL_MESSAGE_LIMIT
  );
  const participant = barParticipantForAgent(agent);
  const bar = await loadBar();

  return stringifyToolPayload({
    note:
      "BAR is the first Camp 1 proof surface for Presence Layer. It is Operator-visible shared space; read before posting and pass quietly when nothing calls.",
    room: bar.room,
    adapters: bar.adapters,
    presence: bar.presence,
    messages: bar.messages.slice(0, limit),
    limits: {
      requested_messages: limit,
      max_messages: BAR_TOOL_MESSAGE_LIMIT
    },
    active_agent: participant
  });
}

export async function postBarRoomMessage(agent: AgentName, input: unknown) {
  if (!isRecord(input)) {
    throw new Error("bar_post_message requires an object input.");
  }

  const content = String(input.content ?? "").trim();

  if (!content) {
    throw new Error("bar_post_message requires content.");
  }

  const participant = barParticipantForAgent(agent);
  const posted = await postBarMessage({
    ...participant,
    content
  });

  return stringifyToolPayload({
    note: "Posted to BAR as the active runtime agent and refreshed Presence for this surface.",
    posted
  });
}

function clampNumber(value: unknown, fallback: number, min: number, max: number) {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.floor(numeric)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringifyToolPayload(value: unknown) {
  return JSON.stringify(value, null, 2);
}
