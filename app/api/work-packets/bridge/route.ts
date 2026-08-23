import { NextResponse } from "next/server";
import {
  authorizeBridge,
  bridgeErrorStatus,
  requireBridgeParticipantId
} from "@/lib/bridge-auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { acknowledgeSignals } from "@/lib/work-packet-signals";
import {
  actorFromId,
  commentOnWorkPacket,
  createWorkPacket,
  getWorkPacket,
  listWorkPackets,
  resolveWorkPacketEvidence,
  respondToWorkPacket,
  rollupWorkPacket
} from "@/lib/work-packets";

export async function GET(request: Request) {
  const auth = authorizeBridge(request, "work packet bridge");

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
  const auth = authorizeBridge(request, "work packet bridge");

  if (auth) {
    return auth;
  }

  try {
    const body = await request.json();
    const participantId = requireBridgeParticipantId(body.participant_id);
    const action = String(body.action ?? "").trim();

    const supabase = getSupabaseAdmin();
    const actor = actorFromId(participantId);

    if (action === "create") {
      return NextResponse.json(await createWorkPacket(supabase, body, actor));
    }

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

    if (action === "resolve_evidence") {
      return NextResponse.json(await resolveWorkPacketEvidence(supabase, body, actor));
    }

    return NextResponse.json(
      { error: 'Choose action "create", "respond", "comment", "rollup", or "resolve_evidence".' },
      { status: 400 }
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown work packet bridge error" },
      { status: bridgeErrorStatus(error) }
    );
  }
}
