import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_PICAR_BASE_URL = "https://picar.blackcoffeeshoppe.com";

export async function GET() {
  const baseUrl = (process.env.PICAR_BASE_URL || DEFAULT_PICAR_BASE_URL).replace(/\/+$/, "");

  try {
    const response = await fetch(`${baseUrl}/camera`, {
      cache: "no-store",
      signal: AbortSignal.timeout(30_000)
    });

    if (!response.ok) {
      return NextResponse.json({ error: `PiCar camera returned ${response.status}.` }, { status: 502 });
    }

    return new NextResponse(await response.arrayBuffer(), {
      headers: {
        "cache-control": "no-store, max-age=0",
        "content-type": response.headers.get("content-type") || "image/jpeg"
      }
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? `PiCar camera unavailable: ${error.message}` : "PiCar camera unavailable." },
      { status: 502 }
    );
  }
}
