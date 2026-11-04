-- Durable, Agent-owned Room Refresh capacity triggers.
--
-- This migration does not enable automated Room Refreshes by itself. A native
-- agent becomes eligible only when the existing `compaction` capability is
-- deliberately granted `write` access. The trigger receipts make every 90%,
-- 95%, and required 100% arrival observable and restart-safe.
--
-- Rollback before live use:
--   drop table if exists public.room_refresh_trigger_events;
--   drop table if exists public.room_refresh_trigger_receipts;

create table if not exists public.room_refresh_trigger_receipts (
  id uuid primary key default gen_random_uuid(),
  agent text not null references public.agents(name) on delete cascade,
  conversation_id text not null references public.conversations(id) on delete cascade,
  cycle_checkpoint_position integer not null default -1,
  stage text not null check (stage in ('nudge_90', 'invitation_95', 'maintenance_100')),
  status text not null default 'queued'
    check (status in ('queued', 'delivering', 'delivered', 'maintenance_pending', 'completed', 'failed')),
  saved_characters integer not null check (saved_characters >= 0),
  pressure_percent integer not null check (pressure_percent >= 0),
  attempts integer not null default 0 check (attempts >= 0),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (agent, conversation_id, cycle_checkpoint_position, stage)
);

create index if not exists room_refresh_trigger_receipts_by_cycle
  on public.room_refresh_trigger_receipts (agent, conversation_id, cycle_checkpoint_position, created_at desc);

create index if not exists room_refresh_trigger_receipts_by_status
  on public.room_refresh_trigger_receipts (status, updated_at asc);

create table if not exists public.room_refresh_trigger_events (
  id uuid primary key default gen_random_uuid(),
  trigger_id uuid not null references public.room_refresh_trigger_receipts(id) on delete cascade,
  event_type text not null,
  message text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists room_refresh_trigger_events_by_trigger
  on public.room_refresh_trigger_events (trigger_id, created_at asc);

alter table public.room_refresh_trigger_receipts enable row level security;
alter table public.room_refresh_trigger_events enable row level security;

revoke all on table public.room_refresh_trigger_receipts, public.room_refresh_trigger_events
  from anon, authenticated, service_role;
grant select, insert, update, delete on table public.room_refresh_trigger_receipts, public.room_refresh_trigger_events
  to service_role;
