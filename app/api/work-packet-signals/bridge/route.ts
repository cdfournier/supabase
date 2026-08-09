import { NextResponse } from "next/server";
import {
  cafeBridgeTokenConfigured,
  cafeBridgeTokenMatches
} from "@/lib/cafe";
import {
  acknowledgeSignals,
  refreshSignalsForParticipant
} from "@/lib/work-packet-signals";

const BRIDGE_PARTICIPANTS = new Set(["agent:julian", "agent:cael"]);

export async function GET(request: Request) {
  const auth = authorizeBridge(request);

  if (auth) {
    return auth;
  }

  try {
    const participantId = participantFromRequest(request);

    if (!BRIDGE_PARTICIPANTS.has(participantId)) {
      return NextResponse.json(
        { error: "participant_id must be agent:julian or agent:cael." },
        { status: 400 }
      );
    }

    return NextResponse.json(await refreshSignalsForParticipant(participantId));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown work packet signal bridge error" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  const auth = authorizeBridge(request);

  if (auth) {
    return auth;
  }

  try {
    const body = await request.json();
    const participantId = String(body.participant_id ?? "").trim();
    const action = String(body.action ?? "").trim();

    if (!BRIDGE_PARTICIPANTS.has(participantId)) {
      return NextResponse.json(
        { error: "participant_id must be agent:julian or agent:cael." },
        { status: 400 }
      );
    }

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
      { status: 500 }
    );
  }
}

function authorizeBridge(request: Request) {
  if (!cafeBridgeTokenConfigured()) {
    return NextResponse.json({ error: "CAFE_BRIDGE_TOKEN is not configured." }, { status: 503 });
  }

  const token = bridgeTokenFromRequest(request);

  if (!cafeBridgeTokenMatches(token)) {
    return NextResponse.json({ error: "Invalid work packet signal bridge token." }, { status: 401 });
  }

  return null;
}

function participantFromRequest(request: Request) {
  const url = new URL(request.url);
  return String(url.searchParams.get("participant_id") ?? "").trim();
}

function bridgeTokenFromRequest(request: Request) {
  const explicit = request.headers.get("x-cafe-bridge-token");

  if (explicit) {
    return explicit;
  }

  const authorization = request.headers.get("authorization") ?? "";

  if (authorization.toLowerCase().startsWith("bearer ")) {
    return authorization.slice("bearer ".length);
  }

  return "";
}
