import { NextResponse } from "next/server";
import {
  authorizeBridge,
  bridgeErrorStatus,
  bridgeParticipantFromRequest
} from "@/lib/bridge-auth";
import { wakeArrivalsStatus } from "@/lib/wake-arrivals";
import { refreshSignalsForParticipant } from "@/lib/work-packet-signals";
import { shouldShowPacketSignalInDigest } from "@/lib/wake-policy";

export const runtime = "nodejs";

type BridgePacketSignal = {
  wake_priority?: unknown;
};

export async function GET(request: Request) {
  const auth = authorizeBridge(request, "WAKE arrivals bridge");

  if (auth) {
    return auth;
  }

  try {
    const participantId = bridgeParticipantFromRequest(request);
    const [arrivalStatus, signalInbox] = await Promise.all([
      wakeArrivalsStatus(),
      refreshSignalsForParticipant(participantId)
    ]);
    const pendingSignals = signalInbox.pending_signals as BridgePacketSignal[];
    const visibleSignals = pendingSignals.filter((signal) => shouldShowPacketSignalInDigest(signal.wake_priority));

    return NextResponse.json({
      participant_id: participantId,
      generated_at: new Date().toISOString(),
      arrivals: arrivalStatus,
      packet_signals: {
        participant_id: signalInbox.participant_id,
        running: signalInbox.running,
        check_in_progress: signalInbox.check_in_progress,
        last_check_at: signalInbox.last_check_at,
        next_check_at: signalInbox.next_check_at,
        pending_count: pendingSignals.length,
        visible_count: visibleSignals.length,
        visible_signals: visibleSignals,
        pending_signals: pendingSignals,
        recent_signals: signalInbox.recent_signals
      }
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown WAKE arrivals bridge error" },
      { status: bridgeErrorStatus(error) }
    );
  }
}
