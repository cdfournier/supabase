import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_PICAR_BASE_URL = "https://picar.blackcoffeeshoppe.com";

export async function GET() {
  const baseUrl = (process.env.PICAR_BASE_URL || DEFAULT_PICAR_BASE_URL).replace(/\/+$/, "");

  try {
    const response = await fetch(`${baseUrl}/readiness`, {
      cache: "no-store",
      headers: {
        accept: "application/json"
      },
      signal: AbortSignal.timeout(10_000)
    });
    const body = await response.text();

    if (!response.ok) {
      return NextResponse.json(
        {
          error: `PiCar readiness returned ${response.status}.`,
          source: baseUrl
        },
        { status: 502 }
      );
    }

    try {
      return NextResponse.json({
        source: baseUrl,
        fetched_at: new Date().toISOString(),
        readiness: JSON.parse(body)
      });
    } catch {
      return NextResponse.json(
        {
          error: "PiCar readiness did not return JSON.",
          source: baseUrl
        },
        { status: 502 }
      );
    }
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? `PiCar readiness unavailable: ${error.message}` : "PiCar readiness unavailable.",
        source: baseUrl
      },
      { status: 502 }
    );
  }
}
