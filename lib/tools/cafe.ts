import "server-only";

import type { AgentName } from "@/lib/agent-context";
import { getSupabaseAdmin } from "@/lib/supabase";
import { loadCafe, postCafeParticipantMessage } from "@/lib/cafe";

const CAFE_TOOL_MESSAGE_LIMIT = 25;

export async function readCafeRoom(agent: AgentName, input: unknown) {
  if (input !== undefined && !isRecord(input)) {
    throw new Error("cafe_read_room requires an object input.");
  }

  const limit = clampNumber(
    isRecord(input) ? input.limit : undefined,
    CAFE_TOOL_MESSAGE_LIMIT,
    1,
    CAFE_TOOL_MESSAGE_LIMIT
  );
  const cafe = await loadCafe(getSupabaseAdmin());

  return stringifyToolPayload({
    note:
      "Shared Cafe room. This is Operator-visible group space, not private memory. Messages are newest-first.",
    room: cafe.room,
    participant_count: cafe.participants.length,
    participants: cafe.participants.map((participant) => ({
      participant_id: participant.participant_id,
      display_name: participant.display_name,
      participant_type: participant.participant_type,
      participant_adapter: participant.participant_adapter,
      status: participant.status
    })),
    messages: cafe.messages.slice(0, limit).map((message) => ({
      id: message.id,
      author_id: message.author_id,
      author_display_name: message.author_display_name,
      author_type: message.author_type,
      created_at: message.created_at,
      content: message.content
    })),
    limits: {
      requested_messages: limit,
      max_messages: CAFE_TOOL_MESSAGE_LIMIT
    },
    active_agent: agent
  });
}

export async function postCafeMessage(agent: AgentName, input: unknown) {
  if (!isRecord(input)) {
    throw new Error("cafe_post_message requires an object input.");
  }

  const content = String(input.content ?? "").trim();

  if (!content) {
    throw new Error("cafe_post_message requires content.");
  }

  const posted = await postCafeParticipantMessage(getSupabaseAdmin(), `agent:${agent}`, content);

  return stringifyToolPayload({
    note: "Posted to the shared Cafe room as the active runtime agent.",
    posted: {
      id: posted.id,
      author_id: posted.author_id,
      author_display_name: posted.author_display_name,
      created_at: posted.created_at,
      content: posted.content
    }
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
