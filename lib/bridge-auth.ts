import "server-only";

import { NextResponse } from "next/server";
import {
  cafeBridgeTokenConfigured,
  cafeBridgeTokenMatches
} from "@/lib/cafe";

export type BridgeParticipantId = "agent:julian" | "agent:cael";

const BRIDGE_PARTICIPANTS = new Set<BridgeParticipantId>(["agent:julian", "agent:cael"]);

export function authorizeBridge(request: Request, label = "bridge") {
  if (!cafeBridgeTokenConfigured()) {
    return NextResponse.json({ error: "CAFE_BRIDGE_TOKEN is not configured." }, { status: 503 });
  }

  const token = bridgeTokenFromRequest(request);

  if (!cafeBridgeTokenMatches(token)) {
    return NextResponse.json({ error: `Invalid ${label} token.` }, { status: 401 });
  }

  return null;
}

export function bridgeParticipantFromRequest(request: Request) {
  const url = new URL(request.url);
  return requireBridgeParticipantId(url.searchParams.get("participant_id"));
}

export function requireBridgeParticipantId(value: unknown): BridgeParticipantId {
  const participantId = String(value ?? "").trim();

  if (BRIDGE_PARTICIPANTS.has(participantId as BridgeParticipantId)) {
    return participantId as BridgeParticipantId;
  }

  throw new Error("participant_id must be agent:julian or agent:cael.");
}

export function bridgeErrorStatus(error: unknown) {
  if (error instanceof Error && error.message === "participant_id must be agent:julian or agent:cael.") {
    return 400;
  }

  return 500;
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
