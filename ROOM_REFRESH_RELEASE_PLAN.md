# Room Refresh production release plan

This plan releases the tested Agent-owned Room Refresh workflow and its
capacity arrivals for Soren and Varro. It deliberately excludes the separate
runtime-accounting and model-migration branches; those remain their own future
release decision.

## Scope and prerequisites

- Code branch: `codex/agent-room-refresh`.
- Target: `main`, followed by the normal local production runtime on port 3001.
- Existing production data remains in place. The migrations are additive:
  archives and raw conversation messages are retained.
- Keep a current database backup/PITR posture appropriate to the production
  project before applying schema changes.
- Stop any preview process on port 3002 before removing a preview branch. Do
  not point port 3001 at a preview project.

## Release order

1. **Preflight the repository.** Confirm the Room Refresh branch is pushed,
   `main` is unchanged except for known generated files, and no unrelated
   branch is accidentally included. Do not commit `next-env.d.ts`.
2. **Review and merge.** Merge `codex/agent-room-refresh` into `main`. The
   branch contains the archive-safe Agent-owned path and the durable capacity
   arrival lane together; release them as one unit.
3. **Apply production SQL in this order.** Run each in the Supabase SQL editor
   and keep the success result:

   ```text
   sql/2026-11-03-agent-room-refresh-safety.sql
   sql/2026-11-04-room-refresh-capacity-triggers.sql
   ```

   The first adds archive-state receipts, immutable Room Note revisions, and
   guarded checkpoint finalization. The second creates
   `room_refresh_trigger_receipts` and `room_refresh_trigger_events`. Both
   enable RLS and grant only `service_role` access to their new tables.
4. **Restart the production runtime.** Start the merged `main` with the
   production Supabase URL and service-role key on port 3001. Never use a
   preview key for this step.
5. **Verify the quiet path.** Load the Operator UI and `/api/health`; confirm
   both agents load normally, existing conversations are intact, and no
   migration/receipt errors appear. No capacity arrival should be forced merely
   to prove the release.
6. **Grant deliberately.** The current Operator UI does not yet expose a
   general capability-level editor. Until that small UI surface is built, use
   the Supabase SQL editor to grant `compaction: write` only to the Agent
   intended to own refreshes. Start with Varro if he is the real upcoming case;
   grant Soren separately when wanted:

   ```sql
   update public.agent_capabilities
   set access_level = 'write', updated_at = now()
   where agent = 'varro' and surface = 'compaction'
   returning agent, surface, access_level, updated_at;
   ```

   This is the enablement switch for self-sent Room Refreshes and capacity
   arrivals. To pause new self-sent refreshes later, set the same row back to
   `draft`.
7. **Give them the guide.** Send Soren and Varro the GitHub link to
   `AGENT_HOUSEKEEPING_GUIDE.md` with a brief note that it is their standing
   housekeeping reference. The repository is the canonical copy; no duplicate
   Café attachment or source-material record is needed.
8. **Observe the first real use.** Let the relevant capacity arrival invite
   the Agent naturally. Inspect the resulting trigger receipt, archive status,
   revision trail, and fresh-context orientation receipt. Intervene only for a
   real safeguard failure.

## Smoke checks

After migrations, verify the new tables are protected:

```sql
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in ('compaction_proposal_revisions', 'room_refresh_trigger_receipts', 'room_refresh_trigger_events')
order by tablename;
```

After a completed real Room Refresh, verify the facts rather than the prose:

```sql
select archive_status, source_end_position, completed_at,
       orientation_status, orientation_completed_at, failure_reason
from public.compaction_archives
where agent = 'varro'
order by created_at desc
limit 1;

select revision_number, status, change_reason, created_at
from public.compaction_proposal_revisions
where proposal_id = '<proposal id>'
order by revision_number;
```

## Safe pause and rollback posture

- Before a Room Refresh begins, return `compaction` to `draft` to prevent new
  Agent-owned sends. Existing raw transcript remains untouched.
- If a specific refresh fails, do not retry by hand from a stale note. Read its
  archive/trigger receipt and begin a fresh Room Review when the source window
  has changed.
- Do not drop production tables as an operational rollback. The feature's
  safety comes from preserving the transcript and receipts. Revert code and
  remove the capability grant first; investigate retained evidence second.
