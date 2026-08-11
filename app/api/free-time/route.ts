import { NextResponse } from "next/server";
import {
  start as startFreeTime,
  previewPrompt as previewFreeTimePrompt,
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
      const scheduleMode = optionalScheduleMode(body.scheduleMode);

      return NextResponse.json(await startFreeTime(intervalMinutes, scheduleMode));
    }

    if (action === "stop") {
      return NextResponse.json(await stopFreeTime());
    }

    if (action === "tick") {
      return NextResponse.json(await tickFreeTime(optionalAgent(body.agent)));
    }

    if (action === "preview_prompt") {
      return NextResponse.json(await previewFreeTimePrompt(requiredAgent(body.agent)));
    }

    return NextResponse.json(
      { error: 'Choose action "start", "stop", "tick", or "preview_prompt".' },
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

function requiredAgent(value: unknown) {
  const agent = optionalAgent(value);

  if (!agent) {
    throw new Error("Free Moments preview_prompt requires agent soren or varro.");
  }

  return agent;
}

function optionalScheduleMode(value: unknown) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  const scheduleMode = String(value);

  if (scheduleMode !== "round_robin" && scheduleMode !== "paired") {
    throw new Error("Free Moments scheduleMode must be round_robin or paired.");
  }

  return scheduleMode;
}
