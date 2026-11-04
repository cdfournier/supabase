-- Disposable preview-only fixture for the model-migration safety lane.
--
-- Run only in a Supabase preview branch. This fixture names Soren's normal
-- Opus lane as the baseline and Sonnet as a preview candidate. It does not
-- switch a model itself; the preview server command does that explicitly.

insert into public.agents (name, display_name, persona_seed, status)
values (
  'soren',
  'Soren Migration QA',
  'Disposable preview fixture for model-migration QA. Keep work contained, use no outside surfaces, and report uncertainty plainly.',
  'active'
)
on conflict (name) do update
set
  display_name = excluded.display_name,
  persona_seed = excluded.persona_seed,
  status = excluded.status;

insert into public.restoration_profiles
  (agent, opening_orientation, persona_summary, current_state, compaction_memory_policy)
values (
  'soren',
  'This is a disposable preview environment for a model-lane comparison.',
  'Soren is verifying that an alternate preview model receives the same self-scoped identity, continuity, and capability boundaries.',
  'Await the Operator''s narrow migration QA prompt. Keep the response concise and do not create production-like memories.',
  'Do not create durable production-like memory in this fixture.'
)
on conflict (agent) do update
set
  opening_orientation = excluded.opening_orientation,
  persona_summary = excluded.persona_summary,
  current_state = excluded.current_state,
  compaction_memory_policy = excluded.compaction_memory_policy,
  updated_at = now();

insert into public.model_migration_receipts (
  agent,
  environment,
  baseline_provider,
  baseline_model,
  candidate_provider,
  candidate_model,
  status,
  success_criteria,
  rollback_posture,
  verification_summary,
  evidence
)
select
  'soren',
  'preview',
  'anthropic',
  'claude-opus-4-6',
  'anthropic',
  'claude-sonnet-4-6',
  'running',
  jsonb_build_array(
    'The Runtime panel names the candidate model for Soren in the preview process.',
    'A narrow self-scoped chat turn completes without a provider/runtime error.',
    'The candidate turn has a matching model_usage_events receipt with the candidate model.',
    'The fixture keeps identity, restoration profile, capability profile, and external-surface posture unchanged.',
    'Removing the preview-only override and restarting restores the baseline lane.'
  ),
  'Stop the preview server, remove ANTHROPIC_MODEL_SOREN from its launch command, restart with the baseline configuration, and delete this preview branch when review is complete.',
  'Preview comparison seeded; awaiting candidate-model smoke test.',
  jsonb_build_object('fixture', 'sql/preview/model-migration-lane-fixture.sql')
where not exists (
  select 1
  from public.model_migration_receipts
  where agent = 'soren'
    and environment = 'preview'
    and baseline_model = 'claude-opus-4-6'
    and candidate_model = 'claude-sonnet-4-6'
    and status = 'running'
);
