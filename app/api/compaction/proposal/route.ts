import { NextResponse } from "next/server";
import { isAgentName } from "@/lib/agent-context";
import { getSupabaseAdmin } from "@/lib/supabase";

const allowedStatuses = new Set(["draft", "agent_reviewed", "agent_approved", "operator_review"]);

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const agent = String(body.agent ?? "");
    const status = String(body.status ?? "agent_approved");

    if (!isAgentName(agent)) {
      return NextResponse.json({ error: "Choose soren or varro." }, { status: 400 });
    }

    if (!allowedStatuses.has(status)) {
      return NextResponse.json({ error: "Unsupported proposal status." }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("compaction_proposals")
      .select("id, agent, conversation_id, proposal, source_summary, status, agent_notes, created_at, updated_at")
      .eq("agent", agent)
      .eq("status", status)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new Error(`Could not load saved compaction proposal: ${error.message}`);
    }

    if (!data) {
      return NextResponse.json(
        { error: `No ${status} compaction proposal found for ${agent}.` },
        { status: 404 }
      );
    }

    return NextResponse.json({
      agent,
      status: "proposal_loaded",
      proposal: data
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown proposal load error" },
      { status: 500 }
    );
  }
}
