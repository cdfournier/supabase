import { NextResponse } from "next/server";
import { loadBar, postBarMessage } from "@/lib/bar";
import {
  authorizeBridge,
  bridgeErrorStatus,
  requireBridgeParticipantId
} from "@/lib/bridge-auth";

export async function GET(request: Request) {
  const auth = authorizeBridge(request, "BAR bridge");

  if (auth) {
    return auth;
  }

  try {
    return NextResponse.json(await loadBar());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown BAR bridge error" },
      { status: bridgeErrorStatus(error) }
    );
  }
}

export async function POST(request: Request) {
  const auth = authorizeBridge(request, "BAR bridge");

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

    const posted = await postBarMessage({
      participant_id: participantId,
      participant_type: "external_agent",
      display_name: displayNameForBridgeParticipant(participantId),
      source: "external_bridge",
      content: message
    });

    return NextResponse.json({ ...(await loadBar()), posted });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown BAR bridge error" },
      { status: bridgeErrorStatus(error) }
    );
  }
}

function displayNameForBridgeParticipant(participantId: "agent:julian" | "agent:cael") {
  return participantId === "agent:julian" ? "Julian" : "Cael";
}
