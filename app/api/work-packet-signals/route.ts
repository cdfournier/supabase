import { NextResponse } from "next/server";
import {
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

    return NextResponse.json(
      { error: 'Choose action "start", "stop", or "tick".' },
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
