# Model Migration Runbook

This is a safety runbook for a deliberate model comparison. It does **not**
authorize a production model change. A migration receipt is evidence of a test,
not an approval to promote its candidate.

The receipt and preview fixture are intentionally dormant in the current
Operator UI. They are retained as implementation scaffolding for a future,
purpose-built model-upgrade workflow; today, inspect a receipt through the SQL
editor rather than treating it as a Runtime-panel control.

## What changes — and what does not

A runtime model lane is resolved when the server starts:

1. `ANTHROPIC_MODEL_SOREN` / `ANTHROPIC_MODEL_VARRO`, when set.
2. Shared `ANTHROPIC_MODEL`, when set.
3. The built-in current defaults: Soren → `claude-opus-4-6`; Varro →
   `claude-sonnet-4-6`.

Changing a model override affects only requests from that server process after
restart. It does **not** edit the Agent row, conversation, messages, memories,
restoration profile, capability profile, source-material access, or prior usage
events. Removing the override and restarting is the normal rollback.

## Preview comparison lane

1. Create a disposable Supabase preview branch. Do not use production data as
   a migration fixture.
2. Run, in order, the prerequisite usage/accounting migrations if that preview
   was created before they reached production, then run:

   ```text
   sql/2026-11-04-model-migration-safety.sql
   sql/preview/model-migration-lane-fixture.sql
   ```

3. Start the preview runtime on a non-production port with the preview URL,
   its branch-specific service-role key, an Anthropic key, and an explicit
   candidate override. The standard Soren fixture compares the normal Opus lane
   with Sonnet:

   ```bash
   ANTHROPIC_MODEL_SOREN='claude-sonnet-4-6' npm run dev -- -p 3002
   ```

   Supply the normal preview Supabase and Anthropic environment values through
   the local ignored environment mechanism; never put keys in this document or
   a shell-history-friendly shared script.

4. Reload the Operator UI. The selected Agent's **Model** row should name the
   candidate. The preview receipt is deliberately hidden from the current
   Runtime panel; inspect it through the SQL editor if needed.
5. Send one narrow, self-scoped QA prompt. The fixture should not touch outside
   surfaces. Verify the reply, capability posture, and `model_usage_events`
   receipt all name the expected Agent/model.
6. Complete the receipt in the preview SQL editor only after the evidence is
   present. Keep the summary factual:

   ```sql
   update public.model_migration_receipts as receipt
   set
     status = 'passed',
     verification_summary = 'Candidate completed the narrow preview QA turn; identity, capability posture, and model usage receipt matched the test plan.',
     evidence = evidence || jsonb_build_object('operator_verified_at', now()),
     candidate_usage_event_id = (
       select id
       from public.model_usage_events
       where agent = 'soren'
         and model = 'claude-sonnet-4-6'
         and created_at >= receipt.started_at
       order by created_at desc
       limit 1
     ),
     completed_at = now(),
     updated_at = now()
   where agent = 'soren'
     and environment = 'preview'
     and status = 'running';
   ```

7. Stop the preview server and delete the preview branch once the comparison is
   reviewed. That deletion is the cleanest rollback for the fixture itself.

## Success criteria

Treat the comparison as passed only when all are true:

- the UI and `model_usage_events` agree on the candidate model;
- the Agent receives its intended restoration/profile context and remains
  self-scoped;
- capability filtering is unchanged unless that change was explicitly part of
  the test;
- the candidate responds without a provider/runtime failure;
- accounting records costs, latency, and cache fields honestly; and
- removing the override restores the baseline model after restart.

Do not turn a pleasant answer into a model-selection conclusion. Qualitative
work still needs deliberate human review across the actual tasks that matter.

## Failure and rollback

If a test fails, mark the receipt `failed`, write only observed evidence, stop
the preview server, remove the candidate override, and restart with the
baseline lane. Mark the receipt `rolled_back` only after that restart has been
verified. A failed preview test does not require a production data repair.

If a production comparison is ever explicitly approved, create a new receipt
with `environment = 'production'`; never relabel a preview receipt as proof of
production behavior.
