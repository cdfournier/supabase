-- Disposable preview-only fixture for Room Refresh QA.
--
-- Never run this in production. It creates or refreshes a small Soren QA
-- identity and grants only the compaction write capability needed to prove the
-- agent-owned Room Refresh flow. It preserves any existing preview transcript;
-- the six seed messages are inserted only into an empty Soren QA room.

insert into public.agents (name, display_name, persona_seed, status)
values (
  'soren',
  'Soren QA',
  'Disposable preview fixture for Room Refresh QA. Follow explicit QA instructions, use only self-scoped tools, and do not treat this as production memory.',
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
  'This is a disposable preview QA environment with a seeded Room Refresh test room.',
  'Soren QA is verifying archive safety, deliberate revision, and a fresh-context orientation receipt.',
  'A bounded QA Room Refresh may be requested. Preserve uncertainty, make no production-like memories, and report only what this fixture actually proves.',
  'Before a Room Note, review current state and memories. Preserve uncertainty. A Room Refresh must be deliberate, archived first, and followed by a fresh orientation receipt.'
)
on conflict (agent) do update
set
  opening_orientation = excluded.opening_orientation,
  persona_summary = excluded.persona_summary,
  current_state = excluded.current_state,
  compaction_memory_policy = excluded.compaction_memory_policy,
  updated_at = now();

insert into public.conversations (id, agent, token_count, compaction_count)
values ('soren-main', 'soren', 0, 0)
on conflict (id) do nothing;

insert into public.agent_capabilities
  (agent, surface, access_level, default_bias, requires_operator_approval, notify_operator, max_actions_per_moment, quiet_mode, notes)
values (
  'soren',
  'compaction',
  'write',
  'preview QA only; agent-owned Room Refresh after review',
  false,
  'audit_only',
  null,
  false,
  'Preview-only permission to test archive safety, revision history, guarded refresh, and orientation delivery.'
)
on conflict (agent, surface) do update
set
  access_level = excluded.access_level,
  default_bias = excluded.default_bias,
  requires_operator_approval = excluded.requires_operator_approval,
  notify_operator = excluded.notify_operator,
  max_actions_per_moment = excluded.max_actions_per_moment,
  quiet_mode = excluded.quiet_mode,
  notes = excluded.notes,
  updated_at = now();

insert into public.conversation_messages
  (conversation_id, position, role, source, content)
select
  'soren-main', seed.position, seed.role, 'room_refresh_qa_seed', to_jsonb(seed.content)
from (
  values
    (0, 'user'::text, 'Chris: This is a disposable Room Refresh QA room. Keep the record honest and do not do outside work.'),
    (1, 'assistant'::text, 'Understood. I will treat this as a contained QA fixture.'),
    (2, 'user'::text, 'The important continuity facts are: this is preview-only; all changes must be self-scoped; a Room Note may preserve uncertainty rather than inventing it.'),
    (3, 'assistant'::text, 'I will preserve those boundaries if I later prepare a Room Note.'),
    (4, 'user'::text, 'Before refresh, review current state and memories. Updating them is optional, but the review is required.'),
    (5, 'assistant'::text, 'I will make that review before any deliberate Room Refresh.')
) as seed(position, role, content)
where not exists (
  select 1 from public.conversation_messages where conversation_id = 'soren-main'
);

