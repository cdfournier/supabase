import { NextResponse } from "next/server";
import {
  createLaunchpadInvitation,
  endLaunchpadInvitation,
  launchpadStatus,
  previewLaunchpadInvitation,
  type LaunchpadAgentName,
  type LaunchpadIntent,
  type LaunchpadSurface,
  type LaunchpadTone
} from "@/lib/launchpad";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(await launchpadStatus());
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const action = String(body.action ?? "").trim();

    if (action === "preview") {
      return NextResponse.json({
        invitation: await previewLaunchpadInvitation(invitationInput(body))
      });
    }

    if (action === "create") {
      return NextResponse.json({
        invitation: await createLaunchpadInvitation(invitationInput(body))
      });
    }

    if (action === "end") {
      return NextResponse.json(await endLaunchpadInvitation({
        sessionId: optionalString(body.session_id)
      }));
    }

    return NextResponse.json(
      { error: 'Choose action "preview", "create", or "end".' },
      { status: 400 }
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown Launchpad error" },
      { status: 500 }
    );
  }
}

function invitationInput(body: Record<string, unknown>) {
  return {
    surface: optionalSurface(body.surface),
    title: optionalString(body.title),
    agents: requiredAgents(body.agents),
    intent: optionalIntent(body.intent),
    tone: optionalTone(body.tone),
    context: optionalString(body.context),
    tickPolicy: {
      mode: body.tick_mode === "interval" ? "interval" as const : "manual" as const,
      interval_seconds: optionalNumber(body.interval_seconds)
    }
  };
}

function optionalSurface(value: unknown): LaunchpadSurface | undefined {
  if (value === "bar" || value === "eyes") {
    return value;
  }

  return undefined;
}

function requiredAgents(value: unknown): LaunchpadAgentName[] {
  if (!Array.isArray(value) || !value.length) {
    throw new Error("agents must include at least one agent.");
  }

  return value.map((item) => {
    const agent = String(item ?? "");

    if (agent === "soren" || agent === "varro" || agent === "julian" || agent === "cael") {
      return agent;
    }

    throw new Error("agents may only include soren, varro, julian, or cael.");
  });
}

function optionalIntent(value: unknown): LaunchpadIntent | undefined {
  if (
    value === "gather" ||
    value === "live_session" ||
    value === "work_session" ||
    value === "celebration" ||
    value === "quiet_check"
  ) {
    return value;
  }

  return undefined;
}

function optionalTone(value: unknown): LaunchpadTone | undefined {
  if (
    value === "quiet" ||
    value === "soft" ||
    value === "directed" ||
    value === "high_signal" ||
    value === "celebratory"
  ) {
    return value;
  }

  return undefined;
}

function optionalString(value: unknown) {
  const text = String(value ?? "").trim();

  return text || undefined;
}

function optionalNumber(value: unknown) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  const numeric = Number(value);

  return Number.isFinite(numeric) ? numeric : undefined;
}
