import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_PICAR_BASE_URL = "https://picar.blackcoffeeshoppe.com";
const OPERATOR_AUTHOR = "Chris";
const MAX_MESSAGE_LENGTH = 800;

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const message = String(body.message ?? "").trim();

  if (!message) {
    return NextResponse.json({ error: "A ride-log message is required." }, { status: 400 });
  }

  if (message.length > MAX_MESSAGE_LENGTH) {
    return NextResponse.json(
      { error: `Ride-log messages must be ${MAX_MESSAGE_LENGTH} characters or fewer.` },
      { status: 400 }
    );
  }

  const baseUrl = (process.env.PICAR_BASE_URL || DEFAULT_PICAR_BASE_URL).replace(/\/+$/, "");

  try {
    const response = await fetch(`${baseUrl}/observe`, {
      method: "POST",
      cache: "no-store",
      headers: {
        accept: "application/json",
        "content-type": "application/json"
      },
      body: JSON.stringify({ author: OPERATOR_AUTHOR, message }),
      signal: AbortSignal.timeout(10_000)
    });
    const responseBody = await response.text();

    if (!response.ok) {
      return NextResponse.json(
        { error: `PiCar ride log returned ${response.status}.`, source: baseUrl },
        { status: 502 }
      );
    }

    try {
      const result = JSON.parse(responseBody) as { ok?: boolean };
      if (!result.ok) {
        return NextResponse.json(
          { error: "PiCar did not accept the ride-log message.", source: baseUrl },
          { status: 502 }
        );
      }
    } catch {
      return NextResponse.json(
        { error: "PiCar ride log did not return JSON.", source: baseUrl },
        { status: 502 }
      );
    }

    return NextResponse.json({ ok: true, author: OPERATOR_AUTHOR });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? `PiCar ride log unavailable: ${error.message}` : "PiCar ride log unavailable.",
        source: baseUrl
      },
      { status: 502 }
    );
  }
}
