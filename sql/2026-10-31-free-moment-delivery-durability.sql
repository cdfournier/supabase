-- Durable scheduler history for Free Moments. Individual run receipts remain
-- the canonical record of a turn; this table records scheduler decisions that
-- also matter after a runtime restart (scheduling, delayed wakes, retries,
-- and interrupted work).
--
-- Rollback:
--   drop table if exists public.free_moment_scheduler_events;

create table if not exists public.free_moment_scheduler_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  agent text references public.agents(name),
  message text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists free_moment_scheduler_events_by_created
  on public.free_moment_scheduler_events (created_at desc);

alter table public.free_moment_scheduler_events enable row level security;

revoke all privileges on table public.free_moment_scheduler_events
  from anon, authenticated, service_role;

grant select, insert, update, delete on table public.free_moment_scheduler_events
  to service_role;
