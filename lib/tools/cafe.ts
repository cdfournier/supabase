import "server-only";

import type { AgentName } from "@/lib/agent-context";
import { getSupabaseAdmin } from "@/lib/supabase";
import {
  loadCafe,
  markCafeAttachmentDelivered,
  postCafeParticipantMessage,
  resolveCafeAttachmentDelivery
} from "@/lib/cafe";
import { buildAttachmentDelivery } from "@/lib/anthropic-attachments";
import type { ToolResultContentBlock } from "@/lib/tools/types";

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
      content: message.content,
      attachments: cafeAttachmentsFromMetadata(message.metadata)
    })),
    limits: {
      requested_messages: limit,
      max_messages: CAFE_TOOL_MESSAGE_LIMIT
    },
    active_agent: agent
  });
}

export async function openCafeAttachment(agent: AgentName, input: unknown): Promise<ToolResultContentBlock[]> {
  if (!isRecord(input)) {
    throw new Error("cafe_open_attachment requires an object input.");
  }

  const attachmentId = String(input.attachment_id ?? "").trim();

  if (!attachmentId) {
    throw new Error("cafe_open_attachment requires attachment_id.");
  }

  const { delivery, attachment } = await resolveCafeAttachmentDelivery(
    getSupabaseAdmin(),
    attachmentId,
    `agent:${agent}`
  );

  if (delivery.delivery_method !== "runtime_native") {
    throw new Error("This Cafe attachment is delivered through a different participant adapter.");
  }

  const rendered = await buildAttachmentDelivery([attachment]);
  const imageBlocks = rendered.blocks.filter(
    (block): block is ToolResultContentBlock => block.type === "text" || block.type === "image"
  );
  const included = rendered.summaries.some((summary) => summary.status === "included" && summary.kind === "image");

  if (!included || !imageBlocks.some((block) => block.type === "image")) {
    const reason = rendered.summaries[0]?.reason ?? "this attachment is not a supported direct image";
    throw new Error(`Could not open ${attachment.title}: ${reason}.`);
  }

  await markCafeAttachmentDelivered(getSupabaseAdmin(), delivery.id);

  return [
    {
      type: "text",
      text: `Cafe attachment opened for you: ${attachment.title}. Treat the image itself as the source; describe only details you can actually see.`
    },
    ...imageBlocks
  ];
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

function cafeAttachmentsFromMetadata(metadata: Record<string, unknown>) {
  const candidate = metadata.attachments;

  if (!Array.isArray(candidate)) {
    return [];
  }

  return candidate.flatMap((attachment) => {
    if (!isRecord(attachment) || typeof attachment.id !== "string") {
      return [];
    }

    return [{
      id: attachment.id,
      title: typeof attachment.title === "string" ? attachment.title : "Untitled attachment",
      material_type: typeof attachment.material_type === "string" ? attachment.material_type : "unknown",
      mime_type: typeof attachment.mime_type === "string" ? attachment.mime_type : null,
      size_bytes: typeof attachment.size_bytes === "number" ? attachment.size_bytes : null,
      open_with: "cafe_open_attachment"
    }];
  });
}

function stringifyToolPayload(value: unknown) {
  return JSON.stringify(value, null, 2);
}
