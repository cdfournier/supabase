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

    for (const agent of agents) {
      if (!isAgentName(agent.name)) {
        continue;
      }

      const conversationId = await ensureConversation(supabase, agent.name);
      transcripts[agent.name] = await loadConversationMessages(supabase, conversationId);
    }

    return NextResponse.json({ agents, transcripts });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
