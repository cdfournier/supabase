create table if not exists public.operator_notes (
  id uuid primary key default gen_random_uuid(),
  note_key text unique,
  subject text not null default '',
  agent text not null references public.agents(name),
  created_by text not null,
  last_message_by text not null,
  status text not null default 'open',
  operator_status text not null default 'unread',
  agent_status text not null default 'read',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  operator_read_at timestamptz,
  agent_read_at timestamptz,
  archived_at timestamptz
);

create index if not exists operator_notes_by_operator_status
  on public.operator_notes (operator_status, updated_at desc);

create index if not exists operator_notes_by_agent_status
  on public.operator_notes (agent, agent_status, updated_at desc);

create index if not exists operator_notes_by_status
  on public.operator_notes (status, updated_at desc);

create table if not exists public.operator_note_events (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references public.operator_notes(id) on delete cascade,
  actor_id text not null,
  actor_display_name text not null,
  event_type text not null,
  content text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists operator_note_events_by_note
  on public.operator_note_events (note_id, created_at asc);

create index if not exists operator_note_events_by_actor
  on public.operator_note_events (actor_id, created_at desc);

alter table public.operator_notes enable row level security;
alter table public.operator_note_events enable row level security;

insert into public.agent_capabilities
  (agent, surface, access_level, default_bias, requires_operator_approval, notify_operator, max_actions_per_moment, quiet_mode, notes)
select agent.name,
       'operator_notes',
       'write',
       'asynchronous notes to and from the Operator',
       false,
       'notify',
       null::int,
       false,
       'Operator Notes are an asynchronous inbox, not live chat or assignments. Passing and deferring remain valid.'
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
