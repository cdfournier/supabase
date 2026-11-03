import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import {
  ensureConversation,
  isAgentName
} from "@/lib/agent-context";
import {
  createCompactionArchive,
  finalizeCompactionArchive,
  formatCompactionCheckpoint
} from "@/lib/compaction";
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
      conversationId,
      proposalId,
      source
    });

    const finalization = await finalizeCompactionArchive(supabase, {
      agent,
      archiveId: archive.id,
      checkpointContent: content,
      checkpointMessageId,
      conversationId,
      proposalId,
      requireAgentApproval: false
    });

    return NextResponse.json({
      agent,
      conversation_id: conversationId,
      destructive: false,
      status: "checkpoint_saved",
      checkpoint: {
        id: finalization.checkpoint_message_id,
        conversation_id: conversationId,
        position: finalization.checkpoint_position,
        role: "assistant",
        content
      },
      archive,
      compaction_count: finalization.compaction_count,
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
