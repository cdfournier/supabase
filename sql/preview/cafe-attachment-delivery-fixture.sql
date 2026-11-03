-- Disposable preview-only fixture for Cafe image delivery QA.
--
-- Supabase preview branches may contain schema without production identity
-- records. These rows allow the runtime to create a minimal Soren/Varro
-- conversation and maintain source-material foreign keys. Do not run this in
-- production; it deliberately carries no production memories or transcript.

insert into public.agents (name, display_name, persona_seed, status)
values
  (
    'soren',
    'Soren QA',
    'Disposable preview fixture for Cafe visual-delivery QA. Read Cafe carefully; inspect attachments only through the provided Cafe tool.',
    'active'
  ),
  (
    'varro',
    'Varro QA',
    'Disposable preview fixture for Cafe visual-delivery QA.',
    'active'
  )
on conflict (name) do update
set
  display_name = excluded.display_name,
  persona_seed = excluded.persona_seed,
  status = excluded.status;

insert into public.restoration_profiles
  (agent, opening_orientation, persona_summary, current_state, compaction_memory_policy)
values
  (
    'soren',
    'This is a disposable preview QA environment with no production history.',
    'Soren QA is testing whether Cafe images are delivered as actual visual input rather than metadata.',
    'A fresh Cafe visual-delivery test may be waiting. Follow the Operator instruction and report only what is actually visible.',
    'Do not create durable production-like memory in this fixture.'
  ),
  (
    'varro',
    'This is a disposable preview QA environment with no production history.',
    'Varro QA is an isolated fixture for Cafe visual-delivery testing.',
    'Await explicit QA instructions.',
    'Do not create durable production-like memory in this fixture.'
  )
on conflict (agent) do update
set
  opening_orientation = excluded.opening_orientation,
  persona_summary = excluded.persona_summary,
  current_state = excluded.current_state,
  compaction_memory_policy = excluded.compaction_memory_policy,
  updated_at = now();
