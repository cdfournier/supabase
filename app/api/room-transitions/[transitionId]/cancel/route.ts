import { NextResponse } from "next/server";

import { cancelRoomTransition } from "@/lib/room-transition-runs";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache"
};

export async function POST(request: Request, context: { params: Promise<{ transitionId: string }> }) {
  try {
    const { transitionId } = await context.params;
    const body = await request.json().catch(() => ({}));
    const reason = typeof body.reason === "string" ? body.reason : undefined;

    if (!transitionId) {
      return NextResponse.json({ error: "transitionId is required." }, { status: 400, headers: NO_STORE_HEADERS });
    }

    const outcome = await cancelRoomTransition(transitionId, reason);
    if (!outcome.run) {
      return NextResponse.json({ error: outcome.error }, { status: 404, headers: NO_STORE_HEADERS });
    }
    if (!outcome.changed) {
      return NextResponse.json({ error: outcome.error, transition: outcome.run }, { status: 409, headers: NO_STORE_HEADERS });
    }
    return NextResponse.json({ transition: outcome.run }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not cancel Room Transition." },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
