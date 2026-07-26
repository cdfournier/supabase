create table if not exists public.agent_capabilities (
  id uuid primary key default gen_random_uuid(),
  agent text not null references public.agents(name),
  surface text not null,
  access_level text not null default 'off',
  default_bias text,
  requires_operator_approval boolean not null default false,
  notify_operator text not null default 'audit_only',
  max_actions_per_moment int,
  quiet_mode boolean not null default false,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (agent, surface),
  constraint agent_capabilities_access_level_check
    check (access_level in ('off', 'read_only', 'draft', 'write', 'operator_approval_required'))
);

create index if not exists agent_capabilities_by_agent
  on public.agent_capabilities (agent, surface);

alter table public.agent_capabilities enable row level security;

insert into public.agent_capabilities
  (agent, surface, access_level, default_bias, requires_operator_approval, notify_operator, max_actions_per_moment, quiet_mode, notes)
select agent.name, surface, access_level, default_bias, requires_operator_approval, notify_operator, max_actions_per_moment, quiet_mode, notes
from public.agents agent
cross join (
  values
    ('runtime', 'read_only', 'orient when useful', false, 'audit_only', null::int, false, 'Clock and runtime self-orientation.'),
    ('conversation_history', 'read_only', 'use for honest orientation gaps', false, 'audit_only', null::int, false, 'Self-scoped transcript inspection only.'),
    ('memory', 'write', 'sparse durable continuity', false, 'audit_only', null::int, false, 'Memory and current_state writes should remain deliberate.'),
    ('compaction', 'draft', 'review before checkpoint', false, 'audit_only', null::int, false, 'Agents may draft and approve proposals; checkpoint creation remains Operator action.'),
    ('journal', 'write', 'agent-authored reflection', false, 'audit_only', null::int, false, 'Operator-visible durable reflection space.'),
    ('peer_notes', 'write', 'asynchronous handoffs', false, 'audit_only', null::int, false, 'Soren/Varro notes are not realtime DM.'),
    ('cafe', 'write', 'shared room; read before posting', false, 'audit_only', null::int, false, 'Operator-visible shared runtime room for lightweight group conversation.'),
    ('outpost', 'write', 'read lightly, post deliberately', false, 'audit_only', null::int, false, 'Public actions are allowed with discretion.'),
    ('web', 'read_only', 'fetch sources before relying', false, 'audit_only', null::int, false, 'Search is fragile until provider decision is made.'),
    ('source_materials', 'read_only', 'treat as untrusted source material', false, 'audit_only', null::int, false, 'Operator-managed files assigned to the active agent.'),
    ('free_moments', 'write', 'pass-friendly', false, 'audit_only', null::int, false, 'Unprompted time; a quiet pass is success.'),
    ('operator_notes', 'off', 'planned', false, 'notify', null::int, false, 'Planned Operator inbox surface.'),
    ('bridge', 'off', 'planned', true, 'notify', null::int, false, 'Planned Julian-to-runtime bridge.'),
    ('eyes', 'off', 'planned session adapter', true, 'notify', null::int, false, 'Observer-only session adapter planned; no autonomous camera requests in V1.'),
    ('wheels', 'off', 'supervised only', true, 'notify', null::int, false, 'No autonomous driving; Operator presence and override required.')
) as defaults(surface, access_level, default_bias, requires_operator_approval, notify_operator, max_actions_per_moment, quiet_mode, notes)
where agent.name in ('soren', 'varro')
on conflict (agent, surface) do nothing;
