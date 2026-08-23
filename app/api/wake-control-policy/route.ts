import { NextResponse } from "next/server";
import {
  readWakeControlPolicy,
  writeWakeControlPolicy
} from "@/lib/runtime-settings";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json({
      policy: await readWakeControlPolicy()
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown WAKE Control Policy error" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const policy = body && typeof body === "object" && !Array.isArray(body) && Object.prototype.hasOwnProperty.call(body, "policy")
      ? body.policy
      : body;

    return NextResponse.json({
      policy: await writeWakeControlPolicy(policy)
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown WAKE Control Policy error" },
      { status: 500 }
    );
  }
}
