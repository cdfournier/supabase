-- Enable the EYES observer adapter for local runtime agents.
--
-- This opens join/read/observe/leave tools behind the existing Agent
-- Capability Profile. It does not add any camera-capture/request tool; capture
-- remains Operator-controlled in the EYES phone PWA.

insert into public.agent_capabilities
  (agent, surface, access_level, default_bias, requires_operator_approval, notify_operator, max_actions_per_moment, quiet_mode, notes)
select agent.name,
       'eyes',
       'write',
       'operator-started observer sessions only',
       false,
       'audit_only',
       null::int,
       false,
       'May join Operator-provided EYES sessions, read current frames/log, post observations, and leave. No autonomous camera requests in V1.'
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
