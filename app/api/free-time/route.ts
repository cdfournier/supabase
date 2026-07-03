import { NextResponse } from "next/server";
import {
  start as startFreeTime,
  statusWithSettings as freeTimeStatus,
  stop as stopFreeTime,
  tick as tickFreeTime
} from "@/lib/free-time";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(await freeTimeStatus());
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const action = String(body.action ?? "");

    if (action === "start") {
      const intervalMinutes = optionalNumber(body.intervalMinutes);

      return NextResponse.json(await startFreeTime(intervalMinutes));
    }

    if (action === "stop") {
      return NextResponse.json(await stopFreeTime());
    }

    if (action === "tick") {
      return NextResponse.json(await tickFreeTime(optionalAgent(body.agent)));
    }

    return NextResponse.json(
      { error: 'Choose action "start", "stop", or "tick".' },
      { status: 400 }
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown Free Moments error" },
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

function optionalAgent(value: unknown) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  const agent = String(value);

  if (agent !== "soren" && agent !== "varro") {
    throw new Error("Free Moments agent must be soren or varro.");
  }

  return agent;
}
