-- Durable Room Transition lifecycle receipts.
--
-- Capacity triggers remain the reason a transition is considered. These rows
-- record the independent lifecycle: queueing, safe-boundary staging, active
-- work, cancellation, and settlement. They are server-only Operator audit
-- data and deliberately retain their append-only timeline.

create table if not exists public.room_transition_runs (
  id uuid primary key,
  agent text not null references public.agents(name) on delete cascade,
  conversation_id text not null references public.conversations(id) on delete cascade,
  trigger_receipt_id uuid unique references public.room_refresh_trigger_receipts(id) on delete cascade,
  trigger text not null,
  status text not null default 'queued'
    check (status in ('queued', 'waiting_for_active_turn', 'in_progress', 'cancel_requested', 'completed', 'deferred', 'cancelled', 'failed', 'interrupted')),
  stage text not null default 'queued'
    check (stage in ('queued', 'waiting', 'model', 'tool', 'wrap_up', 'finished')),
  started_at timestamptz,
  cancellation_requested_at timestamptz,
  cancellation_reason text,
  last_activity jsonb not null default '{}'::jsonb,
  completed_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists room_transition_runs_by_agent_status
  on public.room_transition_runs (agent, conversation_id, status, updated_at desc);

create table if not exists public.room_transition_events (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.room_transition_runs(id) on delete cascade,
  event_type text not null,
  message text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists room_transition_events_by_run
  on public.room_transition_events (run_id, created_at asc);

alter table public.room_transition_runs enable row level security;
alter table public.room_transition_events enable row level security;
revoke all on table public.room_transition_runs, public.room_transition_events from anon, authenticated, service_role;
grant select, insert, update, delete on table public.room_transition_runs, public.room_transition_events to service_role;
