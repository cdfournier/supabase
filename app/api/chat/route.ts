import { NextResponse } from "next/server";
import { isAgentName } from "@/lib/agent-context";
import { EmptyAssistantResponseError, sendAgentMessage } from "@/lib/chat-runtime";

type AttachmentInput = {
  id: string;
};

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const agent = String(body.agent ?? "");
    const message = String(body.message ?? "").trim();
    const attachments = normalizeAttachments(body.attachments);

    if (!isAgentName(agent)) {
      return NextResponse.json({ error: "Choose soren or varro." }, { status: 400 });
    }

    if (!message && !attachments.length) {
      return NextResponse.json({ error: "Message is required." }, { status: 400 });
    }

    return NextResponse.json(await sendAgentMessage(agent, message, { attachments }));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: error instanceof EmptyAssistantResponseError ? 502 : 500 }
    );
  }
}

function normalizeAttachments(value: unknown): AttachmentInput[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (!item || typeof item !== "object" || !("id" in item)) {
        return null;
      }

      const id = String(item.id ?? "").trim();

      return id ? { id } : null;
    })
    .filter((item): item is AttachmentInput => Boolean(item));
}
