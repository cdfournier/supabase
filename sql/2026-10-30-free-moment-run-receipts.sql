-- Durable Free Moment lifecycle receipts.
-- Rollback before live use: drop table if exists public.free_moment_run_events;
-- drop table if exists public.free_moment_runs;
-- After live use, preserve/export rows before dropping because they are
-- Operator-visible audit receipts.

create table if not exists public.free_moment_runs (
  id uuid primary key default gen_random_uuid(),
  agent text not null references public.agents(name),
  source text not null default 'free_time',
  status text not null default 'running',
  phase text not null default 'preparing',
  started_at timestamptz not null default now(),
  cancellation_requested_at timestamptz,
  cancellation_mode text,
  cancellation_reason text,
  last_activity jsonb not null default '{}'::jsonb,
  completed_at timestamptz,
  error text,
  metadata jsonb not null default '{}'::jsonb,
  constraint free_moment_runs_status_check
    check (status in ('running', 'cancellation_requested', 'wrapping_up', 'completed', 'cancelled', 'forced_stop', 'failed', 'interrupted')),
  constraint free_moment_runs_phase_check
    check (phase in ('preparing', 'model', 'tool', 'wrap_up', 'finished')),
  constraint free_moment_runs_cancellation_mode_check
    check (cancellation_mode is null or cancellation_mode in ('graceful', 'force'))
);

create index if not exists free_moment_runs_by_agent_started
  on public.free_moment_runs (agent, started_at desc);

create index if not exists free_moment_runs_by_status_started
  on public.free_moment_runs (status, started_at desc);

create table if not exists public.free_moment_run_events (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.free_moment_runs(id) on delete cascade,
  event_type text not null,
  message text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists free_moment_run_events_by_run
  on public.free_moment_run_events (run_id, created_at asc);

alter table public.free_moment_runs enable row level security;
alter table public.free_moment_run_events enable row level security;

-- New public tables require explicit Data API access. These are server-only
-- runtime tables; browser roles receive no table privileges.
revoke all on table public.free_moment_runs from anon, authenticated, service_role;
revoke all on table public.free_moment_run_events from anon, authenticated, service_role;
grant select, insert, update, delete on table public.free_moment_runs to service_role;
grant select, insert, update, delete on table public.free_moment_run_events to service_role;
