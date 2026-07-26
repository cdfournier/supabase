-- Open Cafe participation for existing runtime projects.
-- Run after sql/2026-07-26-cafe-mvp.sql has created the Cafe tables.

insert into public.cafe_participants (
  room_id,
  participant_id,
  participant_type,
  participant_adapter,
  display_name,
  metadata
)
values
  ('cafe-main', 'operator:chris', 'operator', 'operator_browser', 'Chris', '{}'::jsonb),
  ('cafe-main', 'agent:soren', 'agent', 'runtime_native', 'Soren', '{"agent": "soren"}'::jsonb),
  ('cafe-main', 'agent:varro', 'agent', 'runtime_native', 'Varro', '{"agent": "varro"}'::jsonb),
  ('cafe-main', 'agent:julian', 'external_agent', 'codex_local', 'Julian', '{"agent": "julian", "adapter_status": "planned"}'::jsonb),
  ('cafe-main', 'agent:cael', 'external_agent', 'codex_local', 'Cael', '{"agent": "cael", "adapter_status": "planned"}'::jsonb)
on conflict (room_id, participant_id) do update
set participant_type = excluded.participant_type,
    participant_adapter = excluded.participant_adapter,
    display_name = excluded.display_name,
    status = 'active',
    metadata = public.cafe_participants.metadata || excluded.metadata,
    updated_at = now();

insert into public.agent_capabilities
  (agent, surface, access_level, default_bias, requires_operator_approval, notify_operator, max_actions_per_moment, quiet_mode, notes)
select agent.name,
       'cafe',
       'write',
       'shared room; read before posting',
       false,
       'audit_only',
       null::int,
       false,
       'Operator-visible shared runtime room for lightweight group conversation.'
from public.agents agent
where agent.name in ('soren', 'varro')
on conflict (agent, surface) do update set
  access_level = excluded.access_level,
  default_bias = excluded.default_bias,
  requires_operator_approval = excluded.requires_operator_approval,
  notify_operator = excluded.notify_operator,
  max_actions_per_moment = excluded.max_actions_per_moment,
  quiet_mode = excluded.quiet_mode,
  notes = excluded.notes,
  updated_at = now();
