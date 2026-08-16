import { NextResponse } from "next/server";
import {
  authorizeBridge,
  bridgeErrorStatus,
  bridgeParticipantFromRequest,
  requireBridgeParticipantId
} from "@/lib/bridge-auth";
import {
  getOperatorNote,
  listOperatorNotes,
  markOperatorNoteRead,
  operatorNoteActorFromAgent,
  replyToOperatorNote
} from "@/lib/operator-notes";
import { getSupabaseAdmin } from "@/lib/supabase";

export async function GET(request: Request) {
  const auth = authorizeBridge(request, "Operator Notes bridge");

  if (auth) {
    return auth;
  }

  try {
    const url = new URL(request.url);
    const participantId = bridgeParticipantFromRequest(request);
    const agent = agentFromParticipantId(participantId);
    const actor = operatorNoteActorFromAgent(agent);
    const supabase = getSupabaseAdmin();
    const id = url.searchParams.get("id");

    if (id) {
      return NextResponse.json(await getOperatorNote(supabase, { id }, actor));
    }

    return NextResponse.json({
      participant_id: participantId,
      notes: await listOperatorNotes(supabase, {
        side: "agent",
        agent,
        status: url.searchParams.get("status"),
        agent_status: url.searchParams.get("agent_status"),
        limit: url.searchParams.get("limit")
      })
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown Operator Notes bridge error" },
      { status: bridgeErrorStatus(error) }
    );
  }
}

export async function POST(request: Request) {
  const auth = authorizeBridge(request, "Operator Notes bridge");

  if (auth) {
    return auth;
  }

  try {
    const body = await request.json();
    const participantId = requireBridgeParticipantId(body.participant_id);
    const agent = agentFromParticipantId(participantId);
    const actor = operatorNoteActorFromAgent(agent);
    const supabase = getSupabaseAdmin();
    const action = String(body.action ?? "").trim();

    if (action === "reply") {
      return NextResponse.json(await replyToOperatorNote(supabase, body, actor));
    }

    if (action === "mark_read") {
      return NextResponse.json({ note: await markOperatorNoteRead(supabase, body, actor) });
    }

    return NextResponse.json(
      { error: 'Choose action "reply" or "mark_read".' },
      { status: 400 }
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown Operator Notes bridge error" },
      { status: bridgeErrorStatus(error) }
    );
  }
}

function agentFromParticipantId(participantId: string) {
  return participantId.replace(/^agent:/, "");
}
