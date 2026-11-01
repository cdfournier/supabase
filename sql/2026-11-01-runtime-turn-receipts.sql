-- Durable receipts for cancellable, non-Free-Moment runtime turns.
--
-- Rollback before production use:
--   drop table if exists public.runtime_turn_events;
--   drop table if exists public.runtime_turn_runs;
--
-- After live use, preserve/export the rows first: these are Operator-visible
-- audit receipts, not disposable telemetry.

create table if not exists public.runtime_turn_runs (
  id uuid primary key,
  agent text not null references public.agents(name),
  source text not null,
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
  constraint runtime_turn_runs_status_check check (
    status in ('running', 'cancellation_requested', 'force_stopping', 'completed', 'cancelled', 'forced_stop', 'failed', 'interrupted')
  ),
  constraint runtime_turn_runs_phase_check check (
    phase in ('preparing', 'model', 'tool', 'wrap_up', 'finished')
  ),
  constraint runtime_turn_runs_cancellation_mode_check check (
    cancellation_mode is null or cancellation_mode in ('graceful', 'force')
  )
);

create index if not exists runtime_turn_runs_by_agent_started
  on public.runtime_turn_runs (agent, started_at desc);

create index if not exists runtime_turn_runs_by_status_started
  on public.runtime_turn_runs (status, started_at desc);

create table if not exists public.runtime_turn_events (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.runtime_turn_runs(id) on delete cascade,
  event_type text not null,
  message text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists runtime_turn_events_by_run
  on public.runtime_turn_events (run_id, created_at asc);

alter table public.runtime_turn_runs enable row level security;
alter table public.runtime_turn_events enable row level security;

-- Server-only runtime tables: browser roles receive no direct Data API access.
revoke all on table public.runtime_turn_runs from anon, authenticated, service_role;
revoke all on table public.runtime_turn_events from anon, authenticated, service_role;
grant select, insert, update, delete on table public.runtime_turn_runs to service_role;
grant select, insert, update, delete on table public.runtime_turn_events to service_role;
