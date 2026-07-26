import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export const CAFE_ROOM_ID = "cafe-main";
const CAFE_MESSAGE_LIMIT = 100;

export type CafeParticipant = {
  id: string;
  room_id: string;
  participant_id: string;
  participant_type: "operator" | "agent" | "system" | "external_agent";
  participant_adapter: "operator_browser" | "runtime_native" | "codex_local" | "external_bridge";
  display_name: string;
  status: string;
  metadata: Record<string, unknown>;
  joined_at: string;
  updated_at: string;
};

export type CafeMessage = {
  id: string;
  room_id: string;
  author_id: string;
  author_type: "operator" | "agent" | "system" | "external_agent";
  author_display_name: string;
  content: string;
  metadata: Record<string, unknown>;
  created_at: string;
};

type CafeRoom = {
  id: string;
  title: string;
  status: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

type Supabase = SupabaseClient;

export async function loadCafe(supabase: Supabase) {
  await ensureCafeSeed(supabase);

  const [roomResult, participantsResult, messagesResult] = await Promise.all([
    supabase
      .from("cafe_rooms")
      .select("id, title, status, metadata, created_at, updated_at")
      .eq("id", CAFE_ROOM_ID)
      .single(),
    supabase
      .from("cafe_participants")
      .select(
        "id, room_id, participant_id, participant_type, participant_adapter, display_name, status, metadata, joined_at, updated_at"
      )
      .eq("room_id", CAFE_ROOM_ID)
      .order("joined_at", { ascending: true }),
    supabase
      .from("cafe_messages")
      .select("id, room_id, author_id, author_type, author_display_name, content, metadata, created_at")
      .eq("room_id", CAFE_ROOM_ID)
      .order("created_at", { ascending: false })
      .limit(CAFE_MESSAGE_LIMIT)
  ]);

  if (roomResult.error) {
    throw cafeSetupError(roomResult.error.message);
  }

  if (participantsResult.error) {
    throw cafeSetupError(participantsResult.error.message);
  }

  if (messagesResult.error) {
    throw cafeSetupError(messagesResult.error.message);
  }

  return {
    room: roomResult.data as CafeRoom,
    participants: (participantsResult.data ?? []) as CafeParticipant[],
    messages: (messagesResult.data ?? []) as CafeMessage[],
    message_limit: CAFE_MESSAGE_LIMIT
  };
}

export async function postOperatorCafeMessage(supabase: Supabase, content: string) {
  const trimmed = content.trim();

  if (!trimmed) {
    throw new Error("Message is required.");
  }

  await ensureCafeSeed(supabase);

  const { data, error } = await supabase
    .from("cafe_messages")
    .insert({
      room_id: CAFE_ROOM_ID,
      author_id: "operator:chris",
      author_type: "operator",
      author_display_name: "Chris",
      content: trimmed,
      metadata: {
        source: "operator_browser",
        participant_adapter: "operator_browser"
      }
    })
    .select("id, room_id, author_id, author_type, author_display_name, content, metadata, created_at")
    .single();

  if (error) {
    throw cafeSetupError(error.message);
  }

  return data as CafeMessage;
}

async function ensureCafeSeed(supabase: Supabase) {
  const { error: roomError } = await supabase.from("cafe_rooms").upsert(
    {
      id: CAFE_ROOM_ID,
      title: "Cafe",
      status: "active",
      metadata: {
        working_name: "Cafe",
        mvp: true
      }
    },
    { onConflict: "id" }
  );

  if (roomError) {
    throw cafeSetupError(roomError.message);
  }

  const { error: participantsError } = await supabase.from("cafe_participants").upsert(
    [
      {
        room_id: CAFE_ROOM_ID,
        participant_id: "operator:chris",
        participant_type: "operator",
        participant_adapter: "operator_browser",
        display_name: "Chris",
        status: "active",
        metadata: {}
      },
      {
        room_id: CAFE_ROOM_ID,
        participant_id: "agent:soren",
        participant_type: "agent",
        participant_adapter: "runtime_native",
        display_name: "Soren",
        status: "active",
        metadata: { agent: "soren" }
      },
      {
        room_id: CAFE_ROOM_ID,
        participant_id: "agent:varro",
        participant_type: "agent",
        participant_adapter: "runtime_native",
        display_name: "Varro",
        status: "active",
        metadata: { agent: "varro" }
      }
    ],
    { onConflict: "room_id,participant_id" }
  );

  if (participantsError) {
    throw cafeSetupError(participantsError.message);
  }
}

function cafeSetupError(message: string) {
  if (message.includes("cafe_")) {
    return new Error(
      `Cafe schema is not installed. Run sql/2026-07-26-cafe-mvp.sql in Supabase, then restart the runtime. (${message})`
    );
  }

  return new Error(message);
}
