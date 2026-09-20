import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_PICAR_BASE_URL = "https://picar.blackcoffeeshoppe.com";
const OPERATOR_DRIVER = "Chris";

type ControlAction = "take_wheel" | "release_wheel" | "stop" | "nudge_forward" | "nudge_backward" | "nudge_left" | "nudge_right";

const NUDGES: Record<Exclude<ControlAction, "take_wheel" | "release_wheel" | "stop">, {
  angle: number;
  direction: "forward" | "backward";
}> = {
  nudge_forward: { angle: 0, direction: "forward" },
  nudge_backward: { angle: 0, direction: "backward" },
  nudge_left: { angle: -12, direction: "forward" },
  nudge_right: { angle: 12, direction: "forward" }
};

/**
 * A narrow, operator-only control proxy. This is not a general vehicle API:
 * no continuous motion, arbitrary speed, arbitrary duration, or force handoff
 * is exposed here. The Pi remains the final motion gate.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const action = controlAction(body.action);

  if (!action) {
    return NextResponse.json({ error: "Choose a supported WHEELS control action." }, { status: 400 });
  }

  const baseUrl = (process.env.PICAR_BASE_URL || DEFAULT_PICAR_BASE_URL).replace(/\/+$/, "");

  try {
    if (action === "stop") {
      return NextResponse.json({
        action,
        ...(await postJson(baseUrl, "/stop", {}))
      });
    }

    if (action === "take_wheel") {
      return NextResponse.json({
        action,
        ...(await postJson(baseUrl, "/handoff", { action: "take", driver: OPERATOR_DRIVER }))
      });
    }

    if (action === "release_wheel") {
      return NextResponse.json({
        action,
        ...(await postJson(baseUrl, "/handoff", { action: "release", driver: OPERATOR_DRIVER }))
      });
    }

    if (body.supervision_confirmed !== true) {
      return NextResponse.json(
        { error: "Confirm direct supervision before issuing a motion nudge." },
        { status: 400 }
      );
    }

    const readiness = await readJson(baseUrl, "/readiness") as {
      preflight_ready?: boolean;
      wheel?: { driver?: string | null };
    };

    if (!readiness.preflight_ready) {
      return NextResponse.json(
        { error: "PiCar preflight is not ready; motion remains locked.", readiness },
        { status: 409 }
      );
    }

    if (readiness.wheel?.driver !== OPERATOR_DRIVER) {
      return NextResponse.json(
        { error: "Chris must hold the wheel before an Operator nudge.", readiness },
        { status: 409 }
      );
    }

    const nudge = NUDGES[action];
    const result = await postJson(baseUrl, "/drive", {
      driver: OPERATOR_DRIVER,
      ...nudge,
      speed: 20,
      duration: 0.2,
      continuous: false
    });

    return NextResponse.json({
      action,
      result,
      safety: "bounded 0.2-second nudge"
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? `PiCar control unavailable: ${error.message}` : "PiCar control unavailable." },
      { status: 502 }
    );
  }
}

function controlAction(value: unknown): ControlAction | null {
  return value === "take_wheel" ||
    value === "release_wheel" ||
    value === "stop" ||
    value === "nudge_forward" ||
    value === "nudge_backward" ||
    value === "nudge_left" ||
    value === "nudge_right"
    ? value
    : null;
}

async function readJson(baseUrl: string, path: string) {
  const response = await fetch(`${baseUrl}${path}`, {
    cache: "no-store",
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(10_000)
  });

  if (!response.ok) {
    throw new Error(`${path} returned ${response.status}.`);
  }

  return response.json();
}

async function postJson(baseUrl: string, path: string, payload: object) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    cache: "no-store",
    headers: {
      accept: "application/json",
      "content-type": "application/json"
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15_000)
  });
  const body = await response.json().catch(() => null) as Record<string, unknown> | null;

  if (!response.ok || body?.ok === false) {
    throw new Error(String(body?.error ?? `${path} returned ${response.status}.`));
  }

  return body ?? { ok: true };
}
