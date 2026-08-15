import { NextResponse } from "next/server";
import { wakeArrivalsStatus } from "@/lib/wake-arrivals";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json(await wakeArrivalsStatus());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown WAKE arrivals error" },
      { status: 500 }
    );
  }
}
