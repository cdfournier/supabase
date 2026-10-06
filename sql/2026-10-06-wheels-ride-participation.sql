-- Enable the first embodied WHEELS layer for local runtime agents.
--
-- This grants only explicit passenger entry/exit and visible wheel-queue
-- requests. It does not grant custody, handoff, /drive, renewal, or any
-- physical motion command. Those remain behind a later Operator-grant path.

insert into public.agent_capabilities
  (agent, surface, access_level, default_bias, requires_operator_approval, notify_operator, max_actions_per_moment, quiet_mode, notes)
select agent.name,
       'wheels',
       'write',
       'explicit ride participation only',
       false,
       'audit_only',
       null::int,
       false,
       'May explicitly join or leave the PiCar and request or withdraw a future turn. No wheel custody or motion authority.'
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
