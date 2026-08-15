import { NextResponse } from "next/server";
import {
  archiveOperatorNote,
  createOperatorNote,
  getOperatorNote,
  listOperatorNotes,
  markOperatorNoteRead,
  operatorNoteOperatorActor,
  replyToOperatorNote
} from "@/lib/operator-notes";
import { dispatchOperatorNoteWakeForNote } from "@/lib/operator-note-wakes";
import { getSupabaseAdmin } from "@/lib/supabase";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    const supabase = getSupabaseAdmin();
    const actor = operatorNoteOperatorActor();

    if (id) {
      return NextResponse.json(await getOperatorNote(supabase, { id }, actor));
    }

    return NextResponse.json({
      notes: await listOperatorNotes(supabase, {
        side: "operator",
        agent: url.searchParams.get("agent"),
        status: url.searchParams.get("status"),
        operator_status: url.searchParams.get("operator_status"),
        limit: url.searchParams.get("limit")
      })
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown Operator note error" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const action = String(body.action ?? "create").trim();
    const supabase = getSupabaseAdmin();
    const actor = operatorNoteOperatorActor();

    if (action === "create") {
      const result = await createOperatorNote(supabase, body, actor);
      return NextResponse.json({
        ...result,
        operator_note_wake: await dispatchOperatorNoteWakeForNote(result.note.id)
      });
    }

    if (action === "reply") {
      const result = await replyToOperatorNote(supabase, body, actor);
      return NextResponse.json({
        ...result,
        operator_note_wake: await dispatchOperatorNoteWakeForNote(result.note.id)
      });
    }

    if (action === "mark_read") {
      return NextResponse.json({ note: await markOperatorNoteRead(supabase, body, actor) });
    }

    if (action === "archive") {
      return NextResponse.json({ note: await archiveOperatorNote(supabase, body, actor) });
    }

    return NextResponse.json(
      { error: 'Choose action "create", "reply", "mark_read", or "archive".' },
      { status: 400 }
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown Operator note error" },
      { status: 500 }
    );
  }
}
