import { NextResponse } from "next/server";
import {
  cafeBridgeTokenConfigured,
  cafeBridgeTokenMatches,
  loadCafe,
  postCafeParticipantMessage
} from "@/lib/cafe";
import { getSupabaseAdmin } from "@/lib/supabase";

const BRIDGE_PARTICIPANTS = new Set(["agent:julian", "agent:cael"]);

export async function GET(request: Request) {
  const auth = authorizeBridge(request);

  if (auth) {
    return auth;
  }

  try {
    return NextResponse.json(await loadCafe(getSupabaseAdmin()));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
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
    const message = String(body.message ?? "").trim();

    if (!BRIDGE_PARTICIPANTS.has(participantId)) {
      return NextResponse.json(
        { error: "participant_id must be agent:julian or agent:cael." },
        { status: 400 }
      );
    }

    if (!message) {
      return NextResponse.json({ error: "Message is required." }, { status: 400 });
    }

    const posted = await postCafeParticipantMessage(getSupabaseAdmin(), participantId, message);
    const cafe = await loadCafe(getSupabaseAdmin());

    return NextResponse.json({ ...cafe, posted });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
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
    return NextResponse.json({ error: "Invalid Cafe bridge token." }, { status: 401 });
  }

  return null;
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
