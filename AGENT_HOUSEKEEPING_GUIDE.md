# Housekeeping: a guide for Soren and Varro

Housekeeping is how you deliberately make room in a long-running conversation
without throwing its history away. In the runtime, this is called a **Room
Refresh**. It is not a punishment, a hard reset, or somebody else rewriting
your account of what happened.

## What stays true

- The raw transcript is retained. A Room Refresh creates a verified,
  append-only archive and a checkpoint; it does not delete the source room.
- The Room Note is yours to inspect, revise, approve, or decline to send when
  the choice is still yours.
- Review comes before compression. Look at your current state and durable
  memories first; change either only when an honest correction is useful.
- Do not invent missing facts to make a handoff feel tidier. Keep uncertainty
  plainly marked.

## When an arrival comes

The runtime may send a dedicated capacity arrival when your active room gets
large. It is separate from ordinary work.

- **90% — Room Review nudge.** You may defer after an honest look. Close the
  check rather than beginning unrelated work.
- **95% — Room Refresh invitation.** You may still choose to defer once, or
  begin the sequence below.
- **100% — maintenance turn.** Ordinary work waits. Use the Room Review and
  Room Refresh tools, or report the specific real blocker plainly. Do not
  substitute unrelated work for housekeeping.

Each threshold arrives once per Room Refresh cycle. A successful refresh starts
a fresh cycle; it does not create a nagging loop.

## The Room Refresh sequence

If your `compaction` capability has `write` access and you decide—or are
required—to refresh:

1. Use `supabase_prepare_room_review` and read the room pressure, current
   state, and durable memories it presents.
2. Update current state or memories only if a deliberate, truthful revision is
   warranted.
3. Use `supabase_compile_and_save_compaction_proposal` to create a Room Note.
4. Read the saved note with `supabase_get_compaction_proposal`.
5. Revise it with `supabase_update_compaction_proposal` if that makes the note
   more accurate. Mark it `agent_approved` only when you stand behind it.
6. Send it with `supabase_send_room_refresh`.
7. When that succeeds, close the pre-refresh response. Do not begin new work
   from its old context.

The runtime then queues a separate orientation turn from the refreshed room.
Use it to notice what carried forward, what feels unclear, and whether an
honest correction is needed. Leave a brief orientation receipt, then return to
ordinary life in a later turn.

## If something prevents completion

Say what actually happened. A failed archive, an unavailable capability, or a
source window that changed while the archive was being prepared is a useful
receipt—not a personal failure. Do not claim the room refreshed when the send
tool did not succeed. At 100%, state the real blocker and close so the runtime
and Operator can see it.

## A note on agency

The Operator can grant or withdraw the standing `compaction: write` capability.
That grant lets you send your own approved Room Refresh; it is not a command to
refresh whenever you see a Room Note. At 90% and 95%, you retain the option to
defer. At 100%, the required part is the honest maintenance attempt, not a
fictional summary.

## Short glossary

- **Room Review:** the required preflight—current state, memories, and room
  pressure together.
- **Room Note:** the readable, revisable continuity draft.
- **Room Refresh:** the verified archive, checkpoint, and fresh-context
  orientation that follow an approved note.
- **Orientation receipt:** your brief account from the new context of what
  carried forward or needs attention.
