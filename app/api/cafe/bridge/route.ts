import { NextResponse } from "next/server";
import {
  loadCafe,
  loadCafeForExternalParticipant,
  postCafeParticipantMessage
} from "@/lib/cafe";
import {
  authorizeBridge,
  bridgeErrorStatus,
  bridgeParticipantFromRequest,
  requireBridgeParticipantId
} from "@/lib/bridge-auth";
import { getSupabaseAdmin } from "@/lib/supabase";

export async function GET(request: Request) {
  const auth = authorizeBridge(request, "Cafe bridge");

  if (auth) {
    return auth;
  }

  try {
    const participantId = bridgeParticipantFromRequest(request);
    return NextResponse.json(await loadCafeForExternalParticipant(getSupabaseAdmin(), participantId));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: bridgeErrorStatus(error) }
    );
  }
}

export async function POST(request: Request) {
  const auth = authorizeBridge(request, "Cafe bridge");

  if (auth) {
    return auth;
  }

  try {
    const body = await request.json();
    const participantId = requireBridgeParticipantId(body.participant_id);
    const message = String(body.message ?? "").trim();

    if (!message) {
      return NextResponse.json({ error: "Message is required." }, { status: 400 });
    }

    const posted = await postCafeParticipantMessage(getSupabaseAdmin(), participantId, message);
    const cafe = await loadCafe(getSupabaseAdmin());

    return NextResponse.json({ ...cafe, posted });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: bridgeErrorStatus(error) }
    );
  }
}
