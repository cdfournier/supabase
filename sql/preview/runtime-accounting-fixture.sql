-- Disposable preview-only fixture for runtime accounting QA.
--
-- Supabase preview branches carry schema but may not include runtime identity
-- records. This creates only the minimum Soren fixture needed to issue one
-- ordinary chat turn and inspect its accounting receipt. Do not run this in
-- production.

insert into public.agents (name, display_name, persona_seed, status)
values (
  'soren',
  'Soren Accounting QA',
  'Disposable preview fixture for runtime-accounting QA. Reply concisely, use no tools unless the Operator explicitly asks.',
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
  'This is a disposable preview QA environment with no production history.',
  'Soren is verifying that a normal runtime turn produces an honest, additive accounting record.',
  'Await the Operator\'s narrow QA instruction. Keep the response concise and do not create durable production-like memories.',
  'Do not create durable production-like memory in this fixture.'
)
on conflict (agent) do update
set
  opening_orientation = excluded.opening_orientation,
  persona_summary = excluded.persona_summary,
  current_state = excluded.current_state,
  compaction_memory_policy = excluded.compaction_memory_policy,
  updated_at = now();
