import { NextResponse } from "next/server";
import {
  type ChatMessage,
  countConversationMessages,
  ensureConversation,
  isAgentName,
  loadAgentList,
  loadRecentConversationMessages
} from "@/lib/agent-context";
import { getSupabaseAdmin } from "@/lib/supabase";

const LIVE_TRANSCRIPT_LIMIT = 120;

export async function GET() {
  try {
    const supabase = getSupabaseAdmin();
    const agents = await loadAgentList(supabase);
    const transcripts: Record<string, unknown[]> = {};
    const transcript_meta: Record<string, unknown> = {};
    const tool_events: Record<string, unknown[]> = {};

    for (const agent of agents) {
      if (!isAgentName(agent.name)) {
        continue;
      }

      const conversationId = await ensureConversation(supabase, agent.name);
      const [totalMessages, visibleMessages] = await Promise.all([
        countConversationMessages(supabase, conversationId),
        loadRecentConversationMessages(supabase, conversationId, LIVE_TRANSCRIPT_LIMIT)
      ]);

      transcripts[agent.name] = visibleMessages;
      transcript_meta[agent.name] = {
        total_messages: totalMessages,
        returned_messages: visibleMessages.length,
        oldest_returned_position: visibleMessages.at(0)?.position ?? null,
        newest_returned_position: visibleMessages.at(-1)?.position ?? null,
        live_limit: LIVE_TRANSCRIPT_LIMIT
      };
      tool_events[agent.name] = await loadToolEventsForMessages(supabase, conversationId, visibleMessages);
    }

    return NextResponse.json({ agents, transcripts, transcript_meta, tool_events });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

async function loadToolEventsForMessages(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  conversationId: string,
  messages: ChatMessage[]
) {
  const turnIds = Array.from(
    new Set(
      messages
        .map((message) => message.turn_id)
        .filter((turnId): turnId is string => Boolean(turnId))
    )
  );

  if (!turnIds.length) {
    return [];
  }

  const { data, error } = await supabase
    .from("tool_events")
    .select("id, agent, conversation_id, turn_id, round, tool_name, ok, result_preview, result_chars, created_at")
    .eq("conversation_id", conversationId)
    .in("turn_id", turnIds)
    .order("created_at", { ascending: true });

  if (error) {
    console.warn(`Could not load tool events for ${conversationId}: ${error.message}`);
    return [];
  }

  return data ?? [];
}
