import { NextResponse } from "next/server";
import { countUnreadOperatorNotesForAgent } from "@/lib/operator-notes";
import { getSupabaseAdmin } from "@/lib/supabase";
import {
  refreshSignalsForParticipant,
  start as startWorkPacketSignals,
  statusWithSettings as workPacketSignalsStatus,
  stop as stopWorkPacketSignals,
  tick as tickWorkPacketSignals
} from "@/lib/work-packet-signals";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(await workPacketSignalsStatus());
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const action = String(body.action ?? "");

    if (action === "start") {
      return NextResponse.json(await startWorkPacketSignals(optionalNumber(body.intervalSeconds)));
    }

    if (action === "stop") {
      return NextResponse.json(await stopWorkPacketSignals());
    }

    if (action === "tick") {
      return NextResponse.json(await tickWorkPacketSignals());
    }

    if (action === "preview_agent") {
      const agent = requiredAgent(body.agent);
      const participantId = `agent:${agent}`;
      const inbox = await refreshSignalsForParticipant(participantId);
      const pendingSignals = inbox.pending_signals ?? [];
      const visibleSignals = pendingSignals.filter((signal) => signal.wake_priority !== "silent");
      const operatorNotes = await previewOperatorNotes(agent);

      return NextResponse.json({
        agent,
        participant_id: participantId,
        pending_count: pendingSignals.length,
        visible_count: visibleSignals.length,
        visible_signals: visibleSignals,
        pending_signals: pendingSignals,
        recent_signals: inbox.recent_signals ?? [],
        operator_notes: operatorNotes
      });
    }

    return NextResponse.json(
      { error: 'Choose action "start", "stop", "tick", or "preview_agent".' },
      { status: 400 }
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown Work Packet Signals error" },
      { status: 500 }
    );
  }
}

function optionalNumber(value: unknown) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  return Number(value);
}

async function previewOperatorNotes(agent: "soren" | "varro") {
  try {
    return {
      allowed: true,
      error: null,
      unread_count: await countUnreadOperatorNotesForAgent(getSupabaseAdmin(), agent)
    };
  } catch (error) {
    return {
      allowed: true,
      error: error instanceof Error ? error.message : "Could not check Operator Notes.",
      unread_count: 0
    };
  }
}

function requiredAgent(value: unknown) {
  const agent = String(value ?? "");

  if (agent !== "soren" && agent !== "varro") {
    throw new Error("Packet Signals preview_agent requires agent soren or varro.");
  }

  return agent;
}
