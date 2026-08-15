import { NextResponse } from "next/server";
import {
  dispatchPendingOperatorNoteWakes,
  start as startOperatorNoteWakes,
  statusWithSettings as operatorNoteWakeStatus,
  stop as stopOperatorNoteWakes
} from "@/lib/operator-note-wakes";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(await operatorNoteWakeStatus());
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const action = String(body.action ?? "").trim();

    if (action === "start") {
      return NextResponse.json(await startOperatorNoteWakes());
    }

    if (action === "stop") {
      return NextResponse.json(await stopOperatorNoteWakes());
    }

    if (action === "check") {
      await dispatchPendingOperatorNoteWakes();
      return NextResponse.json(await operatorNoteWakeStatus({ dispatchPending: false }));
    }

    return NextResponse.json(
      { error: 'Choose action "start", "stop", or "check".' },
      { status: 400 }
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown Operator Note WAKE error" },
      { status: 500 }
    );
  }
}
