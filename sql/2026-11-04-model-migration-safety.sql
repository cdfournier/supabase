-- Model-migration safety lane.
--
-- This table records a deliberate, Operator-owned comparison. It cannot select
-- a model, change an Agent's continuity records, or promote a preview result.
-- Model selection remains process configuration and is reversible by removing
-- an environment override and restarting that preview runtime.
--
-- Rollback before live use:
--   drop table if exists public.model_migration_receipts;

create table if not exists public.model_migration_receipts (
  id uuid primary key default gen_random_uuid(),
  agent text not null references public.agents(name) on delete cascade,
  environment text not null check (environment in ('preview', 'production')),
  baseline_provider text not null default 'anthropic',
  baseline_model text not null,
  candidate_provider text not null default 'anthropic',
  candidate_model text not null,
  status text not null default 'planned'
    check (status in ('planned', 'running', 'passed', 'failed', 'rolled_back', 'skipped')),
  success_criteria jsonb not null default '[]'::jsonb,
  verification_summary text,
  evidence jsonb not null default '{}'::jsonb,
  candidate_usage_event_id uuid references public.model_usage_events(id) on delete set null,
  rollback_posture text not null,
  rollback_completed_at timestamptz,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_by text not null default 'operator',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (baseline_model <> candidate_model),
  check (status <> 'passed' or candidate_usage_event_id is not null),
  check ((status in ('passed', 'failed', 'rolled_back', 'skipped')) = (completed_at is not null))
);

create index if not exists model_migration_receipts_by_agent_created_at
  on public.model_migration_receipts (agent, created_at desc);

create index if not exists model_migration_receipts_open
  on public.model_migration_receipts (environment, status, created_at desc)
  where status in ('planned', 'running');

alter table public.model_migration_receipts enable row level security;
revoke all on table public.model_migration_receipts from anon, authenticated, service_role;
grant select, insert, update, delete on table public.model_migration_receipts to service_role;
