-- Enable the first embodied WHEELS layer for local runtime agents.
--
-- This grants explicit passenger entry/exit, visible wheel-queue requests,
-- self-claim of an unassigned wheel, and bounded drive segments. Persistent
-- permission replaces per-drive approval; the Pi still permits only one named
-- active driver, stops before custody changes, and owns watchdog expiry.

insert into public.agent_capabilities
  (agent, surface, access_level, default_bias, requires_operator_approval, notify_operator, max_actions_per_moment, quiet_mode, notes)
select agent.name,
       'wheels',
       'write',
       'persistent supervised self-drive',
       false,
       'audit_only',
       null::int,
       false,
       'May explicitly ride, queue, take an unassigned wheel, and drive bounded segments. Cannot replace another driver; Pi watchdog, stop, and Pull Over remain final.'
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
