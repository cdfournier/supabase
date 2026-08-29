import { NextResponse } from "next/server";
import {
  claimLiveSessionBridgeDelivery,
  completeLiveSessionBridgeDelivery,
  liveSessionStatus,
  type BridgeAgentName
} from "@/lib/live-sessions";
import {
  authorizeBridge,
  bridgeErrorStatus,
  bridgeParticipantFromRequest,
  requireBridgeParticipantId
} from "@/lib/bridge-auth";

export async function GET(request: Request) {
  const auth = authorizeBridge(request, "Live Session bridge delivery");

  if (auth) {
    return auth;
  }

  try {
    const participantId = bridgeParticipantFromRequest(request);
    const agent = bridgeAgentFromParticipantId(participantId);
    const status = await liveSessionStatus();
    const session = status.active_session;
    const deliveries = session?.bridge_deliveries
      .filter((delivery) => delivery.agent === agent)
      .slice(0, 20) ?? [];

    return NextResponse.json({
      session_id: session?.id ?? null,
      agent,
      participant: session?.participants[agent] ?? null,
      attendant: session?.bridge_attendants[agent] ?? null,
      deliveries
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown Live Session bridge delivery error" },
      { status: liveSessionBridgeDeliveryErrorStatus(error) }
    );
  }
}

export async function POST(request: Request) {
  const auth = authorizeBridge(request, "Live Session bridge delivery");

  if (auth) {
    return auth;
  }

  try {
    const body = await request.json();
    const participantId = requireBridgeParticipantId(body.participant_id);
    const agent = bridgeAgentFromParticipantId(participantId);
    const action = String(body.action ?? "").trim();
    const sessionId = typeof body.session_id === "string" ? body.session_id.trim() : undefined;

    if (action === "claim") {
      return NextResponse.json(await claimLiveSessionBridgeDelivery({
        sessionId,
        agent
      }));
    }

    if (action === "complete") {
      return NextResponse.json(await completeLiveSessionBridgeDelivery({
        sessionId,
        agent,
        deliveryId: requiredString(body.delivery_id, "delivery_id"),
        claimId: optionalString(body.claim_id),
        outcome: requiredOutcome(body.outcome),
        error: optionalString(body.error)
      }));
    }

    return NextResponse.json(
      { error: 'Choose action "claim" or "complete".' },
      { status: 400 }
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown Live Session bridge delivery error" },
      { status: liveSessionBridgeDeliveryErrorStatus(error) }
    );
  }
}

function bridgeAgentFromParticipantId(participantId: "agent:julian" | "agent:cael"): BridgeAgentName {
  return participantId === "agent:julian" ? "julian" : "cael";
}

function requiredString(value: unknown, label: string) {
  const text = optionalString(value);

  if (!text) {
    throw new Error(`${label} is required.`);
  }

  return text;
}

function optionalString(value: unknown) {
  const text = String(value ?? "").trim();

  return text || undefined;
}

function requiredOutcome(value: unknown) {
  if (value === "delivered" || value === "skipped" || value === "failed") {
    return value;
  }

  throw new Error('outcome must be "delivered", "skipped", or "failed".');
}

function liveSessionBridgeDeliveryErrorStatus(error: unknown) {
  const bridgeStatus = bridgeErrorStatus(error);

  if (bridgeStatus !== 500) {
    return bridgeStatus;
  }

  if (
    error instanceof Error &&
    (
      error.message === "No active live session." ||
      error.message === "Live session not found." ||
      error.message === "Bridge delivery not found." ||
      error.message === "Bridge delivery claim_id does not match." ||
      error.message.endsWith(" is not joined to this live session.") ||
      error.message.endsWith(" is required.") ||
      error.message === 'outcome must be "delivered", "skipped", or "failed".'
    )
  ) {
    return 400;
  }

  return 500;
}
