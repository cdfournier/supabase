import { NextResponse } from "next/server";
import { cancelChatTurn } from "@/lib/chat-turns";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache"
};

export async function POST(request: Request, context: { params: Promise<{ turnId: string }> }) {
  try {
    const { turnId } = await context.params;
    const body = await request.json().catch(() => ({}));
    const mode = body.mode === "force" ? "force" : body.mode === "graceful" ? "graceful" : null;
    const reason = typeof body.reason === "string" ? body.reason : undefined;

    if (!turnId) {
      return NextResponse.json({ error: "turnId is required." }, { status: 400 });
    }
    if (!mode) {
      return NextResponse.json({ error: 'Choose mode "graceful" or "force".' }, { status: 400 });
    }

    const outcome = await cancelChatTurn(turnId, mode, reason);
    if (!outcome.turn) {
      return NextResponse.json({ error: outcome.error }, { status: 404 });
    }
    if (!outcome.changed) {
      return NextResponse.json({ error: outcome.error, turn: outcome.turn }, { status: 409, headers: NO_STORE_HEADERS });
    }

    return NextResponse.json({ turn: outcome.turn }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not cancel runtime turn." },
      { status: 500 }
    );
  }
}
