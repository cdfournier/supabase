import { NextResponse } from "next/server";
import {
  acknowledgeLiveSessionBridgeAgent,
  joinLiveSessionAgent,
  leaveLiveSessionAgent,
  liveSessionStatus,
  previewLiveSessionBridgeAgent,
  type BridgeAgentName
} from "@/lib/live-sessions";
import {
  authorizeBridge,
  bridgeErrorStatus,
  bridgeParticipantFromRequest,
  requireBridgeParticipantId
} from "@/lib/bridge-auth";

export async function GET(request: Request) {
  const auth = authorizeBridge(request, "Live Session bridge");

  if (auth) {
    return auth;
  }

  try {
    const participantId = bridgeParticipantFromRequest(request);

    return NextResponse.json(await previewLiveSessionBridgeAgent({
      agent: bridgeAgentFromParticipantId(participantId)
    }));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown Live Session bridge error" },
      { status: liveSessionBridgeErrorStatus(error) }
    );
  }
}

export async function POST(request: Request) {
  const auth = authorizeBridge(request, "Live Session bridge");

  if (auth) {
    return auth;
  }

  try {
    const body = await request.json();
    const participantId = requireBridgeParticipantId(body.participant_id);
    const agent = bridgeAgentFromParticipantId(participantId);
    const action = String(body.action ?? "").trim();
    const sessionId = typeof body.session_id === "string" ? body.session_id.trim() : undefined;

    if (action === "preview" || action === "poll") {
      return NextResponse.json(await previewLiveSessionBridgeAgent({ sessionId, agent }));
    }

    if (action === "ack") {
      return NextResponse.json(await acknowledgeLiveSessionBridgeAgent({
        sessionId,
        agent,
        eventCutoffAt: typeof body.event_cutoff_at === "string" ? body.event_cutoff_at : undefined
      }));
    }

    if (action === "join") {
      const targetSessionId = sessionId || (await liveSessionStatus()).active_session?.id;

      if (!targetSessionId) {
        return NextResponse.json({ error: "No active live session to join." }, { status: 400 });
      }

      return NextResponse.json(await joinLiveSessionAgent(targetSessionId, agent));
    }

    if (action === "leave") {
      const targetSessionId = sessionId || (await liveSessionStatus()).active_session?.id;

      if (!targetSessionId) {
        return NextResponse.json({ error: "No active live session to leave." }, { status: 400 });
      }

      return NextResponse.json(await leaveLiveSessionAgent(targetSessionId, agent));
    }

    return NextResponse.json(
      { error: 'Choose action "preview", "poll", "ack", "join", or "leave".' },
      { status: 400 }
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown Live Session bridge error" },
      { status: liveSessionBridgeErrorStatus(error) }
    );
  }
}

function bridgeAgentFromParticipantId(participantId: "agent:julian" | "agent:cael"): BridgeAgentName {
  return participantId === "agent:julian" ? "julian" : "cael";
}

function liveSessionBridgeErrorStatus(error: unknown) {
  const bridgeStatus = bridgeErrorStatus(error);

  if (bridgeStatus !== 500) {
    return bridgeStatus;
  }

  if (
    error instanceof Error &&
    (
      error.message === "No active live session." ||
      error.message === "Live session not found." ||
      error.message.endsWith(" is not joined to this live session.")
    )
  ) {
    return 400;
  }

  return 500;
}
