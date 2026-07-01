import { NextResponse } from "next/server";
import {
  ensureConversation,
  isAgentName,
  loadAgentList,
  loadConversationMessages
} from "@/lib/agent-context";
import { getSupabaseAdmin } from "@/lib/supabase";

export async function GET() {
  try {
    const supabase = getSupabaseAdmin();
    const agents = await loadAgentList(supabase);
    const transcripts: Record<string, unknown[]> = {};
    const tool_events: Record<string, unknown[]> = {};

    for (const agent of agents) {
      if (!isAgentName(agent.name)) {
        continue;
      }

      const conversationId = await ensureConversation(supabase, agent.name);
      transcripts[agent.name] = await loadConversationMessages(supabase, conversationId);
      const { data: events, error: eventsError } = await supabase
        .from("tool_events")
        .select("id, agent, conversation_id, turn_id, round, tool_name, ok, result_preview, result_chars, created_at")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true })
        .limit(500);

      tool_events[agent.name] = eventsError ? [] : events ?? [];
    }

    return NextResponse.json({ agents, transcripts, tool_events });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
