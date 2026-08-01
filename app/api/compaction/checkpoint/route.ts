import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import {
  ensureConversation,
  isAgentName,
  nextMessagePosition
} from "@/lib/agent-context";
import { createCompactionArchive, formatCompactionCheckpoint } from "@/lib/compaction";
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
      return NextResponse.json({ error: "Room Note is required before sending housekeeping." }, { status: 400 });
    }

    if (summary.length > MAX_CHECKPOINT_CHARS) {
      return NextResponse.json(
        { error: `Room Note must be ${MAX_CHECKPOINT_CHARS} characters or fewer.` },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdmin();
    const conversationId = await ensureConversation(supabase, agent);
    const position = await nextMessagePosition(supabase, conversationId);
    const checkpointMessageId = randomUUID();
    const source = String(body.source ?? "compiled_compaction_proposal");
    const proposalId = proposalIdFromBody(body.proposal_id, source);
    const content = formatCompactionCheckpoint({
      agent,
      approvedBy: String(body.approved_by ?? "operator"),
      approvalNote: String(
        body.approval_note ?? "Operator-created Room Refresh from reviewed Room Note."
      ),
      source,
      summary
    });

    const archive = await createCompactionArchive(supabase, {
      agent,
      checkpointMessageId,
      conversationId,
      proposalId,
      source
    });

    const { data: checkpoint, error: insertError } = await supabase
      .from("conversation_messages")
      .insert({
        id: checkpointMessageId,
        conversation_id: conversationId,
        position,
        role: "assistant",
        content
      })
      .select("id, conversation_id, position, role, content, created_at")
      .single();

    if (insertError) {
      throw new Error(`Could not save Room Refresh: ${insertError.message}`);
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
      archive,
      compaction_count: nextCompactionCount,
      next_step:
        "Restart or continue normally. The runtime will use this Room Refresh plus messages after it as active context."
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown Room Refresh error" },
      { status: 500 }
    );
  }
}

function proposalIdFromBody(value: unknown, source: string) {
  const direct = typeof value === "string" ? value.trim() : "";

  if (isUuid(direct)) {
    return direct;
  }

  const match = source.match(/^saved_compaction_proposal:([0-9a-f-]{36})$/i);
  const sourceProposalId = match?.[1] ?? "";

  return isUuid(sourceProposalId) ? sourceProposalId : null;
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}
