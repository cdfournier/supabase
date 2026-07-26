import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export const CAFE_ROOM_ID = "cafe-main";
const CAFE_MESSAGE_LIMIT = 100;
const CAFE_MESSAGE_MAX_CHARS = 4000;

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

type CafeParticipantSeed = {
  participantId: string;
  participantType: CafeParticipant["participant_type"];
  participantAdapter: CafeParticipant["participant_adapter"];
  displayName: string;
  metadata: Record<string, unknown>;
};

const CAFE_PARTICIPANTS: CafeParticipantSeed[] = [
  {
    participantId: "operator:chris",
    participantType: "operator",
    participantAdapter: "operator_browser",
    displayName: "Chris",
    metadata: {}
  },
  {
    participantId: "agent:soren",
    participantType: "agent",
    participantAdapter: "runtime_native",
    displayName: "Soren",
    metadata: { agent: "soren" }
  },
  {
    participantId: "agent:varro",
    participantType: "agent",
    participantAdapter: "runtime_native",
    displayName: "Varro",
    metadata: { agent: "varro" }
  },
  {
    participantId: "agent:julian",
    participantType: "external_agent",
    participantAdapter: "codex_local",
    displayName: "Julian",
    metadata: { agent: "julian", adapter_status: "planned" }
  },
  {
    participantId: "agent:cael",
    participantType: "external_agent",
    participantAdapter: "codex_local",
    displayName: "Cael",
    metadata: { agent: "cael", adapter_status: "planned" }
  }
];

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
  return postCafeParticipantMessage(supabase, "operator:chris", content);
}

export async function postCafeParticipantMessage(
  supabase: Supabase,
  participantId: string,
  content: string
) {
  const participant = CAFE_PARTICIPANTS.find((candidate) => candidate.participantId === participantId);
  const trimmed = content.trim();

  if (!participant) {
    throw new Error(`Unknown Cafe participant: ${participantId}`);
  }

  if (!trimmed) {
    throw new Error("Message is required.");
  }

  if (trimmed.length > CAFE_MESSAGE_MAX_CHARS) {
    throw new Error(`Cafe messages must be ${CAFE_MESSAGE_MAX_CHARS} characters or fewer.`);
  }

  await ensureCafeSeed(supabase);

  const { data, error } = await supabase
    .from("cafe_messages")
    .insert({
      room_id: CAFE_ROOM_ID,
      author_id: participant.participantId,
      author_type: participant.participantType,
      author_display_name: participant.displayName,
      content: trimmed,
      metadata: {
        source: participant.participantAdapter,
        participant_adapter: participant.participantAdapter
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
    CAFE_PARTICIPANTS.map((participant) => ({
      room_id: CAFE_ROOM_ID,
      participant_id: participant.participantId,
      participant_type: participant.participantType,
      participant_adapter: participant.participantAdapter,
      display_name: participant.displayName,
      status: "active",
      metadata: participant.metadata
    })),
    { onConflict: "room_id,participant_id" }
  );

  if (participantsError) {
    throw cafeSetupError(participantsError.message);
  }
}

export function cafeBridgeTokenConfigured() {
  return Boolean(cafeBridgeToken());
}

export function cafeBridgeTokenMatches(input: string) {
  const expected = cafeBridgeToken();

  return Boolean(expected && timingSafeEqual(input.trim(), expected));
}

function cafeBridgeToken() {
  return process.env.CAFE_BRIDGE_TOKEN?.trim() ?? "";
}

function timingSafeEqual(input: string, expected: string) {
  const encoder = new TextEncoder();
  const inputBytes = encoder.encode(input);
  const expectedBytes = encoder.encode(expected);
  let difference = inputBytes.length ^ expectedBytes.length;
  const maxLength = Math.max(inputBytes.length, expectedBytes.length);

  for (let index = 0; index < maxLength; index += 1) {
    difference |= (inputBytes[index] ?? 0) ^ (expectedBytes[index] ?? 0);
  }

  return difference === 0;
}

function cafeSetupError(message: string) {
  if (message.includes("cafe_")) {
    return new Error(
      `Cafe schema is not installed. Run sql/2026-07-26-cafe-mvp.sql in Supabase, then restart the runtime. (${message})`
    );
  }

  return new Error(message);
}
