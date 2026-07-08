import { NextResponse } from "next/server";
import {
  ensureConversation,
  isAgentName,
  loadAgentList,
  loadConversationMessages
} from "@/lib/agent-context";
import { getSupabaseAdmin } from "@/lib/supabase";

const TOOL_EVENT_PAGE_SIZE = 1000;

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
      tool_events[agent.name] = await loadToolEvents(supabase, conversationId);
    }

    return NextResponse.json({ agents, transcripts, tool_events });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

async function loadToolEvents(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  conversationId: string
) {
  const events = [];

  for (let from = 0; ; from += TOOL_EVENT_PAGE_SIZE) {
    const to = from + TOOL_EVENT_PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from("tool_events")
      .select("id, agent, conversation_id, turn_id, round, tool_name, ok, result_preview, result_chars, created_at")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true })
      .range(from, to);

    if (error) {
      console.warn(`Could not load tool events for ${conversationId}: ${error.message}`);
      return [];
    }

    const page = data ?? [];
    events.push(...page);

    if (page.length < TOOL_EVENT_PAGE_SIZE) {
      break;
    }
  }

  return events;
}
