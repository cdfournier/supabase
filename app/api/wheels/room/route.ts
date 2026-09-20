import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_PICAR_BASE_URL = "https://picar.blackcoffeeshoppe.com";

export async function GET() {
  const baseUrl = (process.env.PICAR_BASE_URL || DEFAULT_PICAR_BASE_URL).replace(/\/+$/, "");

  try {
    const [readiness, observe, passengers, queue] = await Promise.all([
      readJson(baseUrl, "/readiness"),
      readJson(baseUrl, "/observe"),
      readJson(baseUrl, "/passengers"),
      readJson(baseUrl, "/queue")
    ]);

    return NextResponse.json({
      source: baseUrl,
      fetched_at: new Date().toISOString(),
      readiness,
      observe,
      passengers,
      queue
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? `PiCar room unavailable: ${error.message}` : "PiCar room unavailable.",
        source: baseUrl
      },
      { status: 502 }
    );
  }
}

async function readJson(baseUrl: string, path: string) {
  const response = await fetch(`${baseUrl}${path}`, {
    cache: "no-store",
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(10_000)
  });
  const body = await response.text();

  if (!response.ok) {
    throw new Error(`${path} returned ${response.status}.`);
  }

  try {
    return JSON.parse(body);
  } catch {
    throw new Error(`${path} did not return JSON.`);
  }
}
