import { NextResponse } from "next/server";
import { isAgentName } from "@/lib/agent-context";
import { getChatTurn, startChatTurn } from "@/lib/chat-turns";

type AttachmentInput = {
  id: string;
};

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache"
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

    const { turn, started } = startChatTurn({ agent, message, attachments });

    if (!started) {
      return NextResponse.json(
        {
          error: `${agent} already has a turn in progress.`,
          turn_id: turn.turn_id,
          status: turn.status
        },
        { status: 409 }
      );
    }

    return NextResponse.json(turn, { status: 202 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

export async function GET(request: Request) {
  const turnId = new URL(request.url).searchParams.get("turn_id")?.trim();

  if (!turnId) {
    return NextResponse.json({ error: "turn_id is required." }, { status: 400 });
  }

  const turn = getChatTurn(turnId);

  if (!turn) {
    return NextResponse.json(
      {
        error: "That turn is no longer in the active runtime. Refresh the conversation to check whether it completed."
      },
      { status: 404 }
    );
  }

  // A turn changes from running to completed asynchronously. Never let a
  // browser or intermediary reuse an earlier running snapshot.
  return NextResponse.json(turn, { headers: NO_STORE_HEADERS });
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
