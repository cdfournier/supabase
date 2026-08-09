create table if not exists public.work_packets (
  id uuid primary key default gen_random_uuid(),
  packet_key text unique,
  title text not null,
  objective text not null,
  context text not null default '',
  repo text,
  base_branch text,
  working_branch text,
  owner_agent text,
  conductor text not null default 'agent:julian',
  collaborators text[] not null default '{}'::text[],
  allowed_paths text[] not null default '{}'::text[],
  allowed_tools text[] not null default '{}'::text[],
  done_criteria text[] not null default '{}'::text[],
  review_path text not null default '',
  review_rollup jsonb not null default '{"summary":"","reviewed_by":[],"aligned":[],"disagreed":[],"blocked":[],"decision_needed":"","next_step":"","created_by":"","created_at":""}'::jsonb,
  merge_authority text not null default '',
  rollback_note text not null default '',
  status text not null default 'queued',
  wake_priority text not null default 'digest_only',
  metadata jsonb not null default '{}'::jsonb,
  created_by text not null default 'operator:chris',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz
);

create index if not exists work_packets_by_status_updated
  on public.work_packets (status, updated_at desc);

create index if not exists work_packets_by_conductor
  on public.work_packets (conductor, updated_at desc);

create index if not exists work_packets_by_owner
  on public.work_packets (owner_agent, updated_at desc);

create table if not exists public.work_packet_events (
  id uuid primary key default gen_random_uuid(),
  packet_id uuid not null references public.work_packets(id) on delete cascade,
  actor_id text not null,
  actor_display_name text not null,
  event_type text not null,
  response_state text,
  content text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists work_packet_events_by_packet
  on public.work_packet_events (packet_id, created_at asc);

create index if not exists work_packet_events_by_actor
  on public.work_packet_events (actor_id, created_at desc);

alter table public.work_packets enable row level security;
alter table public.work_packet_events enable row level security;

insert into public.agent_capabilities
  (agent, surface, access_level, default_bias, requires_operator_approval, notify_operator, max_actions_per_moment, quiet_mode, notes)
select agent.name,
       'work_packets',
       'write',
       'invitations, not assignments',
       false,
       'audit_only',
       null::int,
       false,
       'Agents may read packets, comment, pass, defer, ask questions, or place holds. No GitHub branch/PR authority in MVP.'
from public.agents agent
where agent.name in ('soren', 'varro')
on conflict (agent, surface) do update
set access_level = excluded.access_level,
    default_bias = excluded.default_bias,
    requires_operator_approval = excluded.requires_operator_approval,
    notify_operator = excluded.notify_operator,
    max_actions_per_moment = excluded.max_actions_per_moment,
    quiet_mode = excluded.quiet_mode,
    notes = excluded.notes,
    updated_at = now();
