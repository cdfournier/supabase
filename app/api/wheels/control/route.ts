import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_PICAR_BASE_URL = "https://picar.blackcoffeeshoppe.com";
const OPERATOR_DRIVER = "Chris";

type ControlAction = "take_wheel" | "release_wheel" | "stop" | "pull_over" | "drive";

/**
 * A narrow, operator-only control proxy. This is not a general vehicle API:
 * The Pi remains the final motion gate and wheel-custody authority. The
 * Operator may use continuous motion while holding the wheel; /stop and
 * /pull-over remain explicit, immediate exits.
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

    if (action === "pull_over") {
      return NextResponse.json({
        action,
        ...(await postJson(baseUrl, "/pull-over", { driver: OPERATOR_DRIVER }))
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

    if (action !== "drive") {
      return NextResponse.json(
        { error: "Choose a supported WHEELS control action." },
        { status: 400 }
      );
    }

    const direction = body.direction === "backward" ? "backward" : "forward";
    const angle = numberInRange(body.angle, -35, 35, 0);
    const speed = numberInRange(body.speed, 1, 50, 20);
    const continuous = body.continuous === true;
    const duration = numberInRange(body.duration, 0, 20, 0);

    if (!continuous && duration <= 0) {
      return NextResponse.json(
        { error: "Choose a duration for a non-continuous drive." },
        { status: 400 }
      );
    }

    const result = await postJson(baseUrl, "/drive", {
      driver: OPERATOR_DRIVER,
      angle,
      direction,
      speed,
      duration,
      continuous
    });

    return NextResponse.json({
      action,
      result,
      motion: continuous ? "continuous until stopped" : `${duration}s drive`
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
    value === "pull_over" ||
    value === "drive"
    ? value
    : null;
}

function numberInRange(value: unknown, min: number, max: number, fallback: number) {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? Math.min(max, Math.max(min, numeric)) : fallback;
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
