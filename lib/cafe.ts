import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  type SourceMaterialReference,
  isReadableTextMaterial
} from "@/lib/source-materials-shared";

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

type CafeAttachmentDeliveryRow = {
  id: string;
  source_material_id: string;
  recipient_id: string;
  delivery_method: "runtime_native" | "external_bridge";
  status: "available" | "delivered" | "failed";
};

type CafeAttachmentMaterialRow = {
  id: string;
  title: string;
  bucket: string;
  storage_path: string;
  material_type: string;
  mime_type: string | null;
  size_bytes: number | null;
  metadata: Record<string, unknown> | null;
};

export type CafeParticipantSeed = {
  participantId: string;
  participantType: CafeParticipant["participant_type"];
  participantAdapter: CafeParticipant["participant_adapter"];
  displayName: string;
  metadata: Record<string, unknown>;
};

export const CAFE_PARTICIPANTS: CafeParticipantSeed[] = [
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
    metadata: { agent: "cael", adapter_display_name: "Claude Cowork", adapter_status: "planned" }
  }
];

// Cafe is a family table.  Its shared attachments are therefore addressed to
// all four agent participants, even though only Soren and Varro are native
// runtime agents with source_material_access rows.
export const CAFE_ATTACHMENT_PARTICIPANTS = CAFE_PARTICIPANTS.filter(
  (participant) => participant.participantId.startsWith("agent:")
);

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

// External Cafe participants read a deliberately reduced representation. The
// bridge names an attachment and its opaque id, but never reveals a private
// storage path, bucket, or arbitrary source-material metadata.
export async function loadCafeForExternalParticipant(supabase: Supabase, participantId: string) {
  const cafe = await loadCafe(supabase);

  return {
    ...cafe,
    participant_id: participantId,
    messages: cafe.messages.map((message) => ({
      ...message,
      metadata: cafeBridgeMetadata(message.metadata)
    }))
  };
}

export async function postOperatorCafeMessage(
  supabase: Supabase,
  content: string,
  attachments: SourceMaterialReference[] = []
) {
  return postCafeParticipantMessage(supabase, "operator:chris", content, attachments);
}

export async function postCafeParticipantMessage(
  supabase: Supabase,
  participantId: string,
  content: string,
  attachments: SourceMaterialReference[] = []
) {
  const participant = CAFE_PARTICIPANTS.find((candidate) => candidate.participantId === participantId);
  const trimmed = content.trim();

  if (!participant) {
    throw new Error(`Unknown Cafe participant: ${participantId}`);
  }

  if (!trimmed && !attachments.length) {
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
      content: trimmed || "Shared attachment.",
      metadata: {
        source: participant.participantAdapter,
        participant_adapter: participant.participantAdapter,
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
      }
    })
    .select("id, room_id, author_id, author_type, author_display_name, content, metadata, created_at")
    .single();

  if (error) {
    throw cafeSetupError(error.message);
  }

  if (attachments.length) {
    const deliveryError = await createCafeAttachmentDeliveries(supabase, data.id, attachments);

    if (deliveryError) {
      // A Cafe attachment is not successfully shared unless its recipient
      // ledger exists. Roll the message back rather than leaving a post that
      // looks shared but cannot be delivered or audited.
      await supabase.from("cafe_messages").delete().eq("id", data.id);
      throw cafeSetupError(deliveryError.message);
    }
  }

  return data as CafeMessage;
}

async function createCafeAttachmentDeliveries(
  supabase: Supabase,
  cafeMessageId: string,
  attachments: SourceMaterialReference[]
) {
  const rows = attachments.flatMap((attachment) =>
    CAFE_ATTACHMENT_PARTICIPANTS.map((participant) => ({
      cafe_message_id: cafeMessageId,
      source_material_id: attachment.id,
      recipient_id: participant.participantId,
      delivery_method: participant.participantAdapter === "runtime_native"
        ? "runtime_native"
        : "external_bridge",
      metadata: {
        attachment_title: attachment.title,
        participant_adapter: participant.participantAdapter
      }
    }))
  );

  const { error } = await supabase.from("cafe_attachment_deliveries").insert(rows);

  return error;
}

export async function resolveCafeAttachmentDelivery(
  supabase: Supabase,
  attachmentId: string,
  recipientId: string
) {
  const { data: delivery, error: deliveryError } = await supabase
    .from("cafe_attachment_deliveries")
    .select("id, source_material_id, recipient_id, delivery_method, status")
    .eq("source_material_id", attachmentId)
    .eq("recipient_id", recipientId)
    .maybeSingle();

  if (deliveryError) {
    throw cafeSetupError(`Could not read Cafe attachment delivery: ${deliveryError.message}`);
  }

  if (!delivery) {
    throw new Error("This Cafe attachment is not available to that participant.");
  }

  const { data: material, error: materialError } = await supabase
    .from("source_materials")
    .select("id, title, bucket, storage_path, material_type, mime_type, size_bytes, metadata")
    .eq("id", delivery.source_material_id)
    .eq("status", "active")
    .maybeSingle();

  if (materialError) {
    throw cafeSetupError(`Could not read Cafe attachment: ${materialError.message}`);
  }

  if (!material) {
    throw new Error("This Cafe attachment is no longer available.");
  }

  const record = material as CafeAttachmentMaterialRow;

  return {
    delivery: delivery as CafeAttachmentDeliveryRow,
    attachment: {
      id: record.id,
      title: record.title,
      bucket: record.bucket,
      storage_path: record.storage_path,
      material_type: record.material_type,
      mime_type: record.mime_type,
      size_bytes: record.size_bytes,
      readable_as_text: isReadableTextMaterial(record.material_type, record.mime_type),
      metadata: record.metadata
    } satisfies SourceMaterialReference
  };
}

export async function markCafeAttachmentDelivered(
  supabase: Supabase,
  deliveryId: string
) {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("cafe_attachment_deliveries")
    .update({
      status: "delivered",
      delivered_at: now,
      last_error: null,
      updated_at: now
    })
    .eq("id", deliveryId);

  if (error) {
    throw cafeSetupError(`Could not record Cafe attachment delivery: ${error.message}`);
  }
}

function cafeBridgeMetadata(metadata: Record<string, unknown>) {
  const attachments = Array.isArray(metadata.attachments)
    ? metadata.attachments.flatMap((attachment) => {
        if (!attachment || typeof attachment !== "object" || Array.isArray(attachment)) {
          return [];
        }

        const record = attachment as Record<string, unknown>;

        if (typeof record.id !== "string") {
          return [];
        }

        return [{
          id: record.id,
          title: typeof record.title === "string" ? record.title : "Untitled attachment",
          material_type: typeof record.material_type === "string" ? record.material_type : "unknown",
          mime_type: typeof record.mime_type === "string" ? record.mime_type : null,
          size_bytes: typeof record.size_bytes === "number" ? record.size_bytes : null,
          delivery: "fetch through the authenticated Cafe attachment bridge"
        }];
      })
    : [];

  return {
    source: typeof metadata.source === "string" ? metadata.source : null,
    participant_adapter: typeof metadata.participant_adapter === "string"
      ? metadata.participant_adapter
      : null,
    attachments
  };
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
