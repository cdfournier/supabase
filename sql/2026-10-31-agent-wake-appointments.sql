-- One-time, agent-authored runtime wake appointments for Soren and Varro.
-- The appointment is durable; its receipt history tells the truth about quiet
-- time deferrals, delivery, cancellation, failure, and restart interruption.
--
-- Rollback (after disabling the capability for both agents):
--   drop table if exists public.agent_wake_appointment_events;
--   drop table if exists public.agent_wake_appointments;
--   drop table if exists public.agent_wake_appointment_policies;

create table if not exists public.agent_wake_appointment_policies (
  agent text primary key references public.agents(name) on delete cascade,
  enabled boolean not null default false,
  allow_quiet_time_interrupt boolean not null default false,
  quiet_start_minute smallint,
  quiet_end_minute smallint,
  timezone text not null default 'America/New_York',
  updated_at timestamptz not null default now(),
  constraint agent_wake_appointment_quiet_start_check
    check (quiet_start_minute is null or quiet_start_minute between 0 and 1439),
  constraint agent_wake_appointment_quiet_end_check
    check (quiet_end_minute is null or quiet_end_minute between 0 and 1439),
  constraint agent_wake_appointment_quiet_pair_check
    check ((quiet_start_minute is null) = (quiet_end_minute is null))
);

insert into public.agent_wake_appointment_policies (agent)
select name from public.agents where name in ('soren', 'varro')
on conflict (agent) do nothing;

create table if not exists public.agent_wake_appointments (
  id uuid primary key default gen_random_uuid(),
  agent text not null references public.agents(name) on delete cascade,
  note text not null,
  quiet_time_policy text not null default 'defer'
    check (quiet_time_policy in ('defer', 'interrupt')),
  due_at timestamptz not null,
  original_due_at timestamptz not null,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'deferred_quiet', 'delivering', 'completed', 'cancelled', 'failed', 'interrupted')),
  deferred_until timestamptz,
  claimed_at timestamptz,
  delivered_at timestamptz,
  cancelled_at timestamptz,
  completed_at timestamptz,
  error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists agent_wake_appointments_one_pending
  on public.agent_wake_appointments (agent)
  where status in ('scheduled', 'deferred_quiet', 'delivering');

create index if not exists agent_wake_appointments_by_due
  on public.agent_wake_appointments (status, due_at asc);

create table if not exists public.agent_wake_appointment_events (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.agent_wake_appointments(id) on delete cascade,
  event_type text not null,
  message text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists agent_wake_appointment_events_by_appointment
  on public.agent_wake_appointment_events (appointment_id, created_at asc);

insert into public.agent_capabilities
  (agent, surface, access_level, default_bias, requires_operator_approval, notify_operator, max_actions_per_moment, quiet_mode, notes)
select name, 'wake_appointments', 'off', 'one deliberate future wake', false, 'audit_only', null, false,
  'Agent-authored one-time wake appointments. Operator enables per agent.'
from public.agents
where name in ('soren', 'varro')
on conflict (agent, surface) do nothing;

alter table public.agent_wake_appointment_policies enable row level security;
alter table public.agent_wake_appointments enable row level security;
alter table public.agent_wake_appointment_events enable row level security;

revoke all privileges on table public.agent_wake_appointment_policies,
  public.agent_wake_appointments, public.agent_wake_appointment_events
  from anon, authenticated, service_role;

grant select, insert, update, delete on table public.agent_wake_appointment_policies,
  public.agent_wake_appointments, public.agent_wake_appointment_events
  to service_role;
