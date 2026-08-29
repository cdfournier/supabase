import { NextResponse } from "next/server";
import {
  type PresenceSurface,
  listPresence,
  listPresenceAdapters
} from "@/lib/presence";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const surface = normalizeSurface(searchParams.get("surface"));

    return NextResponse.json({
      generated_at: new Date().toISOString(),
      adapters: listPresenceAdapters(),
      presence: listPresence(surface ? { surface } : {})
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown presence error" },
      { status: 500 }
    );
  }
}

function normalizeSurface(value: string | null): PresenceSurface | null {
  if (
    value === "bar" ||
    value === "cafe" ||
    value === "eyes" ||
    value === "wheels" ||
    value === "world" ||
    value === "work_packets" ||
    value === "housekeeping"
  ) {
    return value;
  }

  return null;
}
