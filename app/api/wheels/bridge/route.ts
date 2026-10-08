import { NextResponse } from "next/server";
import { authorizeBridge, bridgeErrorStatus, requireBridgeParticipantId } from "@/lib/bridge-auth";
import { getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_PICAR_BASE_URL = "https://picar.blackcoffeeshoppe.com";
const CAEL_PARTICIPANT = "agent:cael";
const CAEL_NAME = "Cael";
const MAX_MESSAGE_LENGTH = 800;
const MAX_SPEECH_LENGTH = 360;
const MAX_QUEUE_INTENTION_LENGTH = 240;

type WheelsAction =
  | "post"
  | "speak"
  | "join"
  | "leave"
  | "request_turn"
  | "withdraw_turn"
  | "pass_turn"
  | "take_wheel"
  | "drive"
  | "release_wheel"
  | "pull_over";

/**
 * Cael's Cowork bridge is deliberately separate from the browser UI. The
 * shared bridge token identifies the Cowork process; physical permission is
 * still checked against the Operator-managed capability row, and PiCar retains
 * final custody and motion authority.
 */
export async function GET(request: Request) {
  const auth = authorizeBridge(request, "WHEELS bridge");
  if (auth) return auth;

  try {
    requireCael(request);
    const url = new URL(request.url);
    const view = url.searchParams.get("view");
    const baseUrl = picarBaseUrl();

    if (view === "camera") {
      const response = await fetch(`${baseUrl}/camera`, {
        cache: "no-store",
        signal: AbortSignal.timeout(30_000)
      });

      if (!response.ok) {
        throw new PiCarError(`PiCar camera returned ${response.status}.`);
      }

      return new NextResponse(await response.arrayBuffer(), {
        headers: {
          "cache-control": "no-store, max-age=0",
          "content-type": response.headers.get("content-type") || "image/jpeg"
        }
      });
    }

    if (view && view !== "room") {
      return NextResponse.json({ error: "view must be room or camera." }, { status: 400 });
    }

    return NextResponse.json(await readRoom(baseUrl));
  } catch (error) {
    return bridgeError(error);
  }
}

export async function POST(request: Request) {
  const auth = authorizeBridge(request, "WHEELS bridge");
  if (auth) return auth;

  try {
    const body = requireCaelBody(await request.json().catch(() => ({})));
    const action = wheelsAction(body.action);
    if (!action) {
      return NextResponse.json({ error: "Choose a supported WHEELS bridge action." }, { status: 400 });
    }

    const baseUrl = picarBaseUrl();

    if (action === "post") {
      const message = text(body.message);
      if (!message) return NextResponse.json({ error: "message is required." }, { status: 400 });
      if (message.length > MAX_MESSAGE_LENGTH) {
        return NextResponse.json({ error: `message must be ${MAX_MESSAGE_LENGTH} characters or fewer.` }, { status: 400 });
      }
      return NextResponse.json({
        action,
        ...(await postJson(baseUrl, "/observe", { author: CAEL_NAME, message }))
      });
    }

    if (action === "speak") {
      await requireCaelWheelsPermission();
      const textToSpeak = text(body.text);
      if (!textToSpeak) return NextResponse.json({ error: "text is required." }, { status: 400 });
      if (textToSpeak.length > MAX_SPEECH_LENGTH) {
        return NextResponse.json({ error: `text must be ${MAX_SPEECH_LENGTH} characters or fewer.` }, { status: 400 });
      }
      return NextResponse.json({
        action,
        ...(await postJson(baseUrl, "/speak", { text: textToSpeak, voice: CAEL_NAME, author: CAEL_NAME }))
      });
    }

    await requireCaelWheelsPermission();

    if (action === "join") {
      return NextResponse.json({ action, ...(await postJson(baseUrl, "/passengers", { action: "join", name: CAEL_NAME })) });
    }

    if (action === "leave") {
      const [queue, passenger] = await Promise.all([
        postJson(baseUrl, "/queue", { action: "leave", name: CAEL_NAME }),
        postJson(baseUrl, "/passengers", { action: "leave", name: CAEL_NAME })
      ]);
      return NextResponse.json({ action, queue, passenger });
    }

    if (action === "request_turn") {
      const intention = text(body.intention);
      if (!intention) return NextResponse.json({ error: "intention is required." }, { status: 400 });
      if (intention.length > MAX_QUEUE_INTENTION_LENGTH) {
        return NextResponse.json({ error: `intention must be ${MAX_QUEUE_INTENTION_LENGTH} characters or fewer.` }, { status: 400 });
      }
      return NextResponse.json({
        action,
        ...(await postJson(baseUrl, "/queue", { action: "join", name: CAEL_NAME, intention }))
      });
    }

    if (action === "withdraw_turn") {
      return NextResponse.json({ action, ...(await postJson(baseUrl, "/queue", { action: "leave", name: CAEL_NAME })) });
    }

    if (action === "pass_turn") {
      return NextResponse.json({ action, ...(await postJson(baseUrl, "/queue", { action: "pass", name: CAEL_NAME })) });
    }

    if (action === "take_wheel") {
      const queueState = await readJson(baseUrl, "/queue");
      const driver = isRecord(queueState) ? text(queueState.driver) : "";
      const queue = isRecord(queueState) && Array.isArray(queueState.queue) ? queueState.queue : [];
      const nextUp = isRecord(queue[0]) ? text(queue[0].name) : "";

      if (driver) {
        return NextResponse.json({ error: `The wheel is held by ${driver}.` }, { status: 409 });
      }
      if (nextUp && nextUp !== CAEL_NAME) {
        return NextResponse.json({ error: `${nextUp} is first in the WHEELS queue.` }, { status: 409 });
      }
      return NextResponse.json({
        action,
        ...(await postJson(baseUrl, "/handoff", { action: "take", driver: CAEL_NAME }))
      });
    }

    if (action === "drive") {
      const direction = text(body.direction).toLowerCase();
      if (direction !== "forward" && direction !== "backward") {
        return NextResponse.json({ error: "direction must be forward or backward." }, { status: 400 });
      }
      const angle = boundedNumber(body.angle, 0, -35, 35);
      const speed = boundedNumber(body.speed, 20, 1, 40);
      const duration = boundedNumber(body.duration_seconds, 1, 0.1, 3);
      return NextResponse.json({
        action,
        ...(await postJson(baseUrl, "/drive", { driver: CAEL_NAME, direction, angle, speed, duration }))
      });
    }

    if (action === "release_wheel") {
      return NextResponse.json({
        action,
        ...(await postJson(baseUrl, "/handoff", { action: "release", driver: CAEL_NAME }))
      });
    }

    return NextResponse.json({
      action,
      ...(await postJson(baseUrl, "/pull-over", { driver: CAEL_NAME }))
    });
  } catch (error) {
    return bridgeError(error);
  }
}

function requireCael(request: Request) {
  const participantId = new URL(request.url).searchParams.get("participant_id");
  if (requireBridgeParticipantId(participantId) !== CAEL_PARTICIPANT) {
    throw new BridgeInputError("This WHEELS bridge is reserved for agent:cael.");
  }
}

function requireCaelBody(body: unknown): Record<string, unknown> {
  if (!isRecord(body) || requireBridgeParticipantId(body.participant_id) !== CAEL_PARTICIPANT) {
    throw new BridgeInputError("This WHEELS bridge is reserved for agent:cael.");
  }
  return body;
}

async function requireCaelWheelsPermission() {
  const { data, error } = await getSupabaseAdmin()
    .from("agent_capabilities")
    .select("access_level")
    .eq("agent", "cael")
    .eq("surface", "wheels")
    .maybeSingle();

  if (error) {
    throw new Error(`Could not read Cael's WHEELS permission: ${error.message}`);
  }

  if (data?.access_level !== "write") {
    throw new PermissionError(
      "Cael's WHEELS permission is off. The bridge may read the room and post observations, but ride, custody, and drive actions need an explicit Operator grant."
    );
  }
}

async function readRoom(baseUrl: string) {
  const [readiness, observe, passengers, queue] = await Promise.all([
    readJson(baseUrl, "/readiness"),
    readJson(baseUrl, "/observe"),
    readJson(baseUrl, "/passengers"),
    readJson(baseUrl, "/queue")
  ]);
  return { source: baseUrl, fetched_at: new Date().toISOString(), readiness, observe, passengers, queue };
}

function picarBaseUrl() {
  return (process.env.PICAR_BASE_URL || DEFAULT_PICAR_BASE_URL).replace(/\/+$/, "");
}

async function readJson(baseUrl: string, path: string) {
  const response = await fetch(`${baseUrl}${path}`, {
    cache: "no-store",
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(10_000)
  });
  const body = await response.text();
  if (!response.ok) throw new PiCarError(`${path} returned ${response.status}.`);
  try {
    return JSON.parse(body);
  } catch {
    throw new PiCarError(`${path} did not return JSON.`);
  }
}

async function postJson(baseUrl: string, path: string, payload: object) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    cache: "no-store",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15_000)
  });
  const body = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok || body?.ok === false) {
    throw new PiCarError(String(body?.error ?? `${path} returned ${response.status}.`));
  }
  return body ?? { ok: true };
}

function wheelsAction(value: unknown): WheelsAction | null {
  return value === "post" || value === "speak" || value === "join" || value === "leave" || value === "request_turn" ||
    value === "withdraw_turn" || value === "pass_turn" || value === "take_wheel" || value === "drive" ||
    value === "release_wheel" || value === "pull_over"
    ? value
    : null;
}

function boundedNumber(value: unknown, fallback: number, minimum: number, maximum: number) {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? Math.min(maximum, Math.max(minimum, numeric)) : fallback;
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

class BridgeInputError extends Error {}
class PermissionError extends Error {}
class PiCarError extends Error {}

function bridgeError(error: unknown) {
  if (error instanceof PermissionError) {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }
  if (error instanceof PiCarError) {
    return NextResponse.json({ error: error.message }, { status: 502 });
  }
  return NextResponse.json(
    { error: error instanceof Error ? error.message : "Unknown WHEELS bridge error" },
    { status: error instanceof BridgeInputError ? 400 : bridgeErrorStatus(error) }
  );
}
