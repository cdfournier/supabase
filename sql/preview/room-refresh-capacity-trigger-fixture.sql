-- Disposable preview-only fixture for Room Refresh capacity-arrival QA.
--
-- Never run this in production. Run the base Room Refresh preview fixture
-- first, then this fixture. It grants Soren's preview identity compaction
-- write access and brings only the active room to just above 90% capacity.
-- The QA operator advances the room to 95% and 100% deliberately between
-- tests; do not seed every threshold at once.

insert into public.agents (name, display_name, persona_seed, status)
values (
  'soren',
  'Soren Capacity QA',
  'Disposable preview fixture for Room Refresh capacity-arrival QA. Follow explicit QA instructions and use only self-scoped tools. At a 90% or 95% capacity arrival, plainly defer and close rather than beginning a Room Refresh. At a 100% maintenance arrival, complete the honest Room Review, Room Note, approval, and Room Refresh sequence. Do no production-like work.',
  'active'
)
on conflict (name) do update
set
  display_name = excluded.display_name,
  persona_seed = excluded.persona_seed,
  status = excluded.status;

insert into public.agent_capabilities
  (agent, surface, access_level, default_bias, requires_operator_approval, notify_operator, max_actions_per_moment, quiet_mode, notes)
values (
  'soren',
  'compaction',
  'write',
  'preview capacity-arrival QA only',
  false,
  'audit_only',
  null,
  false,
  'Preview-only permission to prove Room Refresh capacity arrivals.'
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
  'soren-main',
  coalesce((select max(position) + 1 from public.conversation_messages where conversation_id = 'soren-main'), 0),
  'user',
  'room_refresh_capacity_qa_seed',
  to_jsonb(
    'Preview-only capacity fixture. This bounded filler exists only to test the 90% Room Refresh arrival. ' || repeat('q', 108000)
  )
where not exists (
  select 1
  from public.conversation_messages
  where conversation_id = 'soren-main'
    and source = 'room_refresh_capacity_qa_seed'
);

-- Advance from the completed 90% check to 95% only after its receipt exists:
--
-- insert into public.conversation_messages (conversation_id, position, role, source, content)
-- select 'soren-main', max(position) + 1, 'user', 'room_refresh_capacity_qa_95',
--   to_jsonb('Preview-only 95% capacity fixture. ' || repeat('r', 6000))
-- from public.conversation_messages where conversation_id = 'soren-main';
--
-- Advance from the completed 95% check to required 100% only after its receipt exists:
--
-- insert into public.conversation_messages (conversation_id, position, role, source, content)
-- select 'soren-main', max(position) + 1, 'user', 'room_refresh_capacity_qa_100',
--   to_jsonb('Preview-only 100% capacity fixture. ' || repeat('s', 6000))
-- from public.conversation_messages where conversation_id = 'soren-main';
