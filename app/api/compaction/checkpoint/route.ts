import { NextResponse } from "next/server";
import {
  ensureConversation,
  isAgentName,
  nextMessagePosition
} from "@/lib/agent-context";
import { formatCompactionCheckpoint } from "@/lib/compaction";
import { getSupabaseAdmin } from "@/lib/supabase";

const MAX_CHECKPOINT_CHARS = 30_000;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const agent = String(body.agent ?? "");
    const summary = String(body.summary ?? "").trim();

    if (!isAgentName(agent)) {
      return NextResponse.json({ error: "Choose soren or varro." }, { status: 400 });
    }

    if (!summary) {
      return NextResponse.json({ error: "Checkpoint summary is required." }, { status: 400 });
    }

    if (summary.length > MAX_CHECKPOINT_CHARS) {
      return NextResponse.json(
        { error: `Checkpoint summary must be ${MAX_CHECKPOINT_CHARS} characters or fewer.` },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdmin();
    const conversationId = await ensureConversation(supabase, agent);
    const position = await nextMessagePosition(supabase, conversationId);
    const content = formatCompactionCheckpoint({
      agent,
      approvedBy: String(body.approved_by ?? "operator"),
      approvalNote: String(
        body.approval_note ?? "Operator-created checkpoint from reviewed compile proposal."
      ),
      source: String(body.source ?? "compiled_compaction_proposal"),
      summary
    });

    const { data: checkpoint, error: insertError } = await supabase
      .from("conversation_messages")
      .insert({
        conversation_id: conversationId,
        position,
        role: "assistant",
        content
      })
      .select("id, conversation_id, position, role, content, created_at")
      .single();

    if (insertError) {
      throw new Error(`Could not save compaction checkpoint: ${insertError.message}`);
    }

    const { data: conversation, error: conversationError } = await supabase
      .from("conversations")
      .select("compaction_count")
      .eq("id", conversationId)
      .single();

    if (conversationError) {
      throw new Error(`Could not read conversation counter: ${conversationError.message}`);
    }

    const nextCompactionCount = Number(conversation?.compaction_count ?? 0) + 1;
    const { error: updateError } = await supabase
      .from("conversations")
      .update({
        compaction_count: nextCompactionCount,
        updated_at: new Date().toISOString()
      })
      .eq("id", conversationId);

    if (updateError) {
      throw new Error(`Could not update compaction counter: ${updateError.message}`);
    }

    return NextResponse.json({
      agent,
      conversation_id: conversationId,
      destructive: false,
      status: "checkpoint_saved",
      checkpoint,
      compaction_count: nextCompactionCount,
      next_step:
        "Restart or continue normally. The runtime will use this checkpoint plus messages after it as active context."
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown checkpoint error" },
      { status: 500 }
    );
  }
}
