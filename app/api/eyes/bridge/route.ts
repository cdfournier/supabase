import { NextResponse } from "next/server";
import { loadEyes, postEyesMessage } from "@/lib/eyes";
import {
  authorizeBridge,
  bridgeErrorStatus,
  requireBridgeParticipantId
} from "@/lib/bridge-auth";

export async function GET(request: Request) {
  const auth = authorizeBridge(request, "EYES bridge");

  if (auth) {
    return auth;
  }

  try {
    return NextResponse.json(await loadEyes());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown EYES bridge error" },
      { status: bridgeErrorStatus(error) }
    );
  }
}

export async function POST(request: Request) {
  const auth = authorizeBridge(request, "EYES bridge");

  if (auth) {
    return auth;
  }

  try {
    const body = await request.json();
    const participantId = requireBridgeParticipantId(body.participant_id);
    const message = String(body.message ?? body.content ?? "").trim();

    if (!message) {
      return NextResponse.json({ error: "Message is required." }, { status: 400 });
    }

    const posted = await postEyesMessage({
      participant_id: participantId,
      participant_type: "external_agent",
      display_name: displayNameForBridgeParticipant(participantId),
      source: "external_bridge",
      kind: "observation",
      content: message
    });

    return NextResponse.json({ ...(await loadEyes()), posted });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown EYES bridge error" },
      { status: bridgeErrorStatus(error) }
    );
  }
}

function displayNameForBridgeParticipant(participantId: "agent:julian" | "agent:cael") {
  return participantId === "agent:julian" ? "Julian" : "Cael";
}
