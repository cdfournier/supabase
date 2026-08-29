import { NextResponse } from "next/server";
import {
  endLiveSession,
  joinLiveSessionAgent,
  leaveLiveSessionAgent,
  liveSessionStatus,
  previewLiveSessionAgentAsync,
  setLiveSessionTickPolicy,
  startLiveSession,
  tickLiveSession
} from "@/lib/live-sessions";

export const runtime = "nodejs";

type NativeAgentName = "soren" | "varro";
type BridgeAgentName = "julian" | "cael";
type LiveSessionAgentName = NativeAgentName | BridgeAgentName;

export async function GET() {
  return NextResponse.json(await liveSessionStatus());
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const action = String(body.action ?? "").trim();

    if (action === "start") {
      return NextResponse.json({
        session: await startLiveSession({
          title: optionalString(body.title),
          agents: optionalNativeAgents(body.agents),
          bridgeAgents: optionalBridgeAgents(body.bridge_agents),
          tickPolicy: {
            mode: optionalTickMode(body.tick_mode),
            interval_seconds: optionalNumber(body.interval_seconds)
          }
        })
      });
    }

    if (action === "end") {
      return NextResponse.json({
        session: await endLiveSession(optionalString(body.session_id))
      });
    }

    if (action === "join") {
      return NextResponse.json({
        session: await joinLiveSessionAgent(requiredString(body.session_id, "session_id"), requiredSessionAgent(body.agent))
      });
    }

    if (action === "leave") {
      return NextResponse.json({
        session: await leaveLiveSessionAgent(requiredString(body.session_id, "session_id"), requiredSessionAgent(body.agent))
      });
    }

    if (action === "set_policy") {
      return NextResponse.json({
        session: await setLiveSessionTickPolicy({
          sessionId: optionalString(body.session_id),
          mode: optionalTickMode(body.tick_mode),
          intervalSeconds: optionalNumber(body.interval_seconds)
        })
      });
    }

    if (action === "tick") {
      return NextResponse.json(await tickLiveSession({
        sessionId: optionalString(body.session_id),
        agent: optionalNativeAgent(body.agent),
        dryRun: body.dry_run === true
      }));
    }

    if (action === "preview_agent") {
      return NextResponse.json(await previewLiveSessionAgentAsync({
        sessionId: optionalString(body.session_id),
        agent: requiredNativeAgent(body.agent)
      }));
    }

    return NextResponse.json(
      { error: 'Choose action "start", "end", "join", "leave", "set_policy", "tick", or "preview_agent".' },
      { status: 400 }
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown live session error" },
      { status: 500 }
    );
  }
}

function optionalString(value: unknown) {
  const text = String(value ?? "").trim();

  return text || undefined;
}

function requiredString(value: unknown, label: string) {
  const text = optionalString(value);

  if (!text) {
    throw new Error(`${label} is required.`);
  }

  return text;
}

function optionalNativeAgents(value: unknown): NativeAgentName[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  return value.map(requiredNativeAgent);
}

function optionalBridgeAgents(value: unknown): BridgeAgentName[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  return value.map(requiredBridgeAgent);
}

function optionalNativeAgent(value: unknown) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  return requiredNativeAgent(value);
}

function requiredNativeAgent(value: unknown): NativeAgentName {
  const agent = String(value ?? "");

  if (agent !== "soren" && agent !== "varro") {
    throw new Error("Native live session agent must be soren or varro.");
  }

  return agent;
}

function requiredBridgeAgent(value: unknown): BridgeAgentName {
  const agent = String(value ?? "");

  if (agent !== "julian" && agent !== "cael") {
    throw new Error("Bridge live session agent must be julian or cael.");
  }

  return agent;
}

function requiredSessionAgent(value: unknown): LiveSessionAgentName {
  const agent = String(value ?? "");

  if (agent === "soren" || agent === "varro" || agent === "julian" || agent === "cael") {
    return agent;
  }

  throw new Error("Live session agent must be soren, varro, julian, or cael.");
}

function optionalTickMode(value: unknown) {
  if (value === "manual" || value === "interval") {
    return value;
  }

  return undefined;
}

function optionalNumber(value: unknown) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  const numeric = Number(value);

  return Number.isFinite(numeric) ? numeric : undefined;
}
