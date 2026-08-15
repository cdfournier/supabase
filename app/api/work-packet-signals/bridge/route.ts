import { NextResponse } from "next/server";
import {
  authorizeBridge,
  bridgeErrorStatus,
  bridgeParticipantFromRequest,
  requireBridgeParticipantId
} from "@/lib/bridge-auth";
import {
  acknowledgeSignals,
  refreshSignalsForParticipant
} from "@/lib/work-packet-signals";

export async function GET(request: Request) {
  const auth = authorizeBridge(request, "work packet signal bridge");

  if (auth) {
    return auth;
  }

  try {
    const participantId = bridgeParticipantFromRequest(request);

    return NextResponse.json(await refreshSignalsForParticipant(participantId));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown work packet signal bridge error" },
      { status: bridgeErrorStatus(error) }
    );
  }
}

export async function POST(request: Request) {
  const auth = authorizeBridge(request, "work packet signal bridge");

  if (auth) {
    return auth;
  }

  try {
    const body = await request.json();
    const participantId = requireBridgeParticipantId(body.participant_id);
    const action = String(body.action ?? "").trim();

    if (action === "ack") {
      const signalId = typeof body.signal_id === "string" ? body.signal_id.trim() : undefined;

      return NextResponse.json(acknowledgeSignals(participantId, signalId || undefined));
    }

    return NextResponse.json(
      { error: 'Choose action "ack".' },
      { status: 400 }
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown work packet signal bridge error" },
      { status: bridgeErrorStatus(error) }
    );
  }
}
