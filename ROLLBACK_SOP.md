# Rollback and Stabilization SOP

Use this when an agent seems disoriented, reports impossible tool behavior, wakes with stale context, writes bad durable state, or the runtime starts returning unexpected errors.

The goal is not to rewind casually. The goal is to freeze motion, preserve evidence, repair only what is wrong, and resume from a known-good state.

## Severity Levels

**Yellow: orientation wobble**

- Agent misdates the session, forgets a recent feature, or relies on stale `current_state`.
- No bad durable writes are confirmed.
- No wrong-agent identity or token issue is present.

**Orange: durable-state issue**

- Bad memory, journal, relationship, proposal, or `current_state` row was written.
- Agent reports tool use that is not supported by the UI tool strip or `tool_events`.
- Compaction proposal/checkpoint framing looks stale or incomplete.

**Red: runtime integrity issue**

- Wrong agent identity appears.
- Unexpected external calls continue while no chat or Free Moment is in progress.
- Anthropic responses repeatedly fail or return no usable text.
- A checkpoint was created from bad or stale framing.

## Immediate Freeze

1. Stop Free Moments if they are running:

```bash
curl -s -X POST http://localhost:3001/api/free-time \
  -H "Content-Type: application/json" \
  -d '{"action":"stop"}'
```

2. Do not run a checkpoint or compaction.

3. Do not delete rows. Prefer archive or repair.

4. Record the health snapshot:

```bash
curl http://localhost:3001/api/health
```

5. Check code state:

```bash
git status --short
git log --oneline -5
```

If there are uncommitted changes, do not use `git reset --hard` or broad checkout commands. Preserve the evidence first.

## Code Rollback

Known-good code is a Git commit. Current database state is not automatically rolled back by code rollback.

To inspect or run a known-good commit without disturbing the active working tree, create a separate worktree:

```bash
git worktree add ../supabase-known-good <commit-sha>
cd ../supabase-known-good
npm install
npm run build
npm run start -- -p 3002
```

Use this when you need to compare behavior against a previous commit.

If a single recent patch is suspected, prefer a precise manual revert with `apply_patch` after reviewing `git diff`. Do not discard unrelated local changes.

## Database Repair

The database is mostly append-only. That is intentional. Rollback usually means repair or archive, not deletion.

Common repairs:

- Stale `current_state`: ask the agent to inspect recent transcript and update `current_state`.
- Bad journal row: use `journal_archive_entry`, not delete.
- Bad memory row: use `supabase_archive_memory`, not delete.
- Duplicate relationship row: normalize with the relationship upsert or a focused SQL repair.
- Bad compaction proposal: leave it as a rejected/replaced proposal; create a new reviewed proposal.

Before major repair, export or screenshot the affected row when possible.

## Agent Orientation Recovery

For a Yellow or Orange orientation issue, do not narrate a whole day back to the agent unless necessary. Use staged retrieval.

Ask the agent:

```text
Pause. Do not checkpoint yet.

Use runtime_get_time, runtime_read_recent_messages with limit 12, and supabase_get_restoration_profile.
Then report the mismatch between your current_state and the recent transcript.
Do not write anything yet.
```

If the mismatch is clear, ask:

```text
Now update current_state with a concise handoff that reflects the recent transcript, the real date/time, and the next intended step.
Do not over-explain. Make it useful for your next wake-up.
```

After that, ask the agent to read back the updated `current_state` before any checkpoint.

## Tool-Use Verification

When an agent claims to have used tools:

- Look for the UI **Tools** strip under the assistant message.
- Check the health panel `tool_events` count if needed.
- Treat reports without tool evidence as narration, not verified execution.

If a tool result is missing, the agent should say so plainly. It should not fill the gap with plausible output.

## Checkpoint Safety

Before creating a checkpoint:

1. Agent confirms `current_state` is accurate.
2. Agent compiles or reviews a proposal.
3. Agent marks the proposal reviewed or approved.
4. Operator reads the proposal enough to catch stale framing.
5. Checkpoint is created only after the above.

If a checkpoint is created from bad framing, do not delete raw messages. Create a corrected current_state and a new checkpoint proposal. Treat the bad checkpoint as historical evidence unless a focused database repair is explicitly chosen.

## Future Improvements

These are not required for manual recovery, but should be built before the runtime is considered product-safe:

- One-click Supabase export for critical tables.
- Operator UI rollback panel.
- Current-state staleness warning.
- Per-turn tool-result integrity warning.
- Checkpoint preview that highlights stale dates and stale open loops.
- Known-good runtime tag before risky feature batches.
