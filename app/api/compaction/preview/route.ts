import { NextResponse } from "next/server";
import { isAgentName } from "@/lib/agent-context";
import { buildCompactionPreview } from "@/lib/compaction";
import { getSupabaseAdmin } from "@/lib/supabase";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const agent = String(body.agent ?? "");

    if (!isAgentName(agent)) {
      return NextResponse.json({ error: "Choose soren or varro." }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    return NextResponse.json(await buildCompactionPreview(supabase, agent));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown Room Review error" },
      { status: 500 }
    );
  }
}
