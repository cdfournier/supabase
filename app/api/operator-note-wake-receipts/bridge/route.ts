import { NextResponse } from "next/server";
import {
  authorizeBridge,
  bridgeErrorStatus,
  requireBridgeParticipantId
} from "@/lib/bridge-auth";
import { recordExternalOperatorNoteWakeReceipt } from "@/lib/operator-note-wakes";

export async function POST(request: Request) {
  const auth = authorizeBridge(request, "Operator Note WAKE receipt bridge");

  if (auth) {
    return auth;
  }

  try {
    const body = await request.json();
    const participantId = requireBridgeParticipantId(body.participant_id);

    return NextResponse.json(await recordExternalOperatorNoteWakeReceipt({
      ...body,
      participant_id: participantId
    }));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown Operator Note WAKE receipt bridge error" },
      { status: receiptBridgeErrorStatus(error) }
    );
  }
}

function receiptBridgeErrorStatus(error: unknown) {
  if (!(error instanceof Error)) {
    return 500;
  }

  if (
    bridgeErrorStatus(error) === 400 ||
    error.message.includes(" is required.") ||
    error.message.includes(" must be ") ||
    error.message.includes(" only supports ") ||
    error.message.includes(" requires ")
  ) {
    return 400;
  }

  return 500;
}
