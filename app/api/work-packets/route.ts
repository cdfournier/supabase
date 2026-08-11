import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import {
  actorFromId,
  commentOnWorkPacket,
  createWorkPacket,
  getWorkPacket,
  listWorkPackets,
  reviewWorkPacketRollup,
  respondToWorkPacket,
  rollupWorkPacket
} from "@/lib/work-packets";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    const supabase = getSupabaseAdmin();

    if (id) {
      return NextResponse.json(await getWorkPacket(supabase, { id }));
    }

    return NextResponse.json({
      packets: await listWorkPackets(supabase, {
        status: url.searchParams.get("status"),
        participant: url.searchParams.get("participant"),
        limit: url.searchParams.get("limit")
      })
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown work packet error" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const action = String(body.action ?? "create").trim();
    const supabase = getSupabaseAdmin();
    const actor = actorFromId("operator:chris");

    if (action === "create") {
      return NextResponse.json(await createWorkPacket(supabase, body, actor));
    }

    if (action === "respond") {
      return NextResponse.json(await respondToWorkPacket(supabase, body, actor));
    }

    if (action === "comment") {
      return NextResponse.json(await commentOnWorkPacket(supabase, body, actor));
    }

    if (action === "rollup") {
      return NextResponse.json(await rollupWorkPacket(supabase, body, actor));
    }

    if (action === "review_rollup") {
      return NextResponse.json(await reviewWorkPacketRollup(supabase, body, actor));
    }

    return NextResponse.json(
      { error: 'Choose action "create", "respond", "comment", "rollup", or "review_rollup".' },
      { status: 400 }
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown work packet error" },
      { status: 500 }
    );
  }
}
