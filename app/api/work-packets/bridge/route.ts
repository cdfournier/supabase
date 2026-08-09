import { NextResponse } from "next/server";
import {
  cafeBridgeTokenConfigured,
  cafeBridgeTokenMatches
} from "@/lib/cafe";
import { getSupabaseAdmin } from "@/lib/supabase";
import { acknowledgeSignals } from "@/lib/work-packet-signals";
import {
  actorFromId,
  commentOnWorkPacket,
  getWorkPacket,
  listWorkPackets,
  respondToWorkPacket,
  rollupWorkPacket
} from "@/lib/work-packets";

const BRIDGE_PARTICIPANTS = new Set(["agent:julian", "agent:cael"]);

export async function GET(request: Request) {
  const auth = authorizeBridge(request);

  if (auth) {
    return auth;
  }

  try {
    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    const supabase = getSupabaseAdmin();

    if (id) {
      return NextResponse.json(await getWorkPacket(supabase, { id }));
    }

    return NextResponse.json({
      packets: await listWorkPackets(supabase, {
        status: url.searchParams.get("status"),
        participant: url.searchParams.get("participant"),
        limit: url.searchParams.get("limit")
      })
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown work packet bridge error" },
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

    const supabase = getSupabaseAdmin();
    const actor = actorFromId(participantId);

    if (action === "respond") {
      const packet = await respondToWorkPacket(supabase, body, actor);
      const signalAcknowledgement = acknowledgeSignals(participantId);

      return NextResponse.json({
        ...packet,
        signal_acknowledgement: signalAcknowledgement
      });
    }

    if (action === "comment") {
      return NextResponse.json(await commentOnWorkPacket(supabase, body, actor));
    }

    if (action === "rollup") {
      return NextResponse.json(await rollupWorkPacket(supabase, body, actor));
    }

    return NextResponse.json(
      { error: 'Choose action "respond", "comment", or "rollup".' },
      { status: 400 }
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown work packet bridge error" },
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
    return NextResponse.json({ error: "Invalid work packet bridge token." }, { status: 401 });
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
