-- Runtime accounting decision support.
--
-- This extends the existing provider-neutral model_usage_events ledger. It
-- never blocks a turn, changes an Agent capability, or edits historical usage.
-- Pricing is an explicitly versioned estimate, not a provider invoice.
--
-- Rollback before live use:
--   drop table if exists public.runtime_accounting_budget_policies;
--   drop table if exists public.model_pricing_rates;
--   alter table public.model_usage_events
--     drop column if exists rate_snapshot,
--     drop column if exists failure_kind,
--     drop column if exists latency_ms,
--     drop column if exists cold_start,
--     drop column if exists runtime_instance_id;

alter table public.model_usage_events
  add column if not exists runtime_instance_id uuid,
  add column if not exists cold_start boolean not null default false,
  add column if not exists latency_ms integer,
  add column if not exists failure_kind text,
  add column if not exists rate_snapshot jsonb not null default '{}'::jsonb;

alter table public.model_usage_events
  drop constraint if exists model_usage_events_latency_ms_check;

alter table public.model_usage_events
  add constraint model_usage_events_latency_ms_check
    check (latency_ms is null or latency_ms >= 0);

create index if not exists model_usage_events_by_created_at
  on public.model_usage_events (created_at desc);

create index if not exists model_usage_events_by_agent_created_at
  on public.model_usage_events (agent, created_at desc);

create index if not exists model_usage_events_by_runtime_instance
  on public.model_usage_events (runtime_instance_id, created_at asc)
  where runtime_instance_id is not null;

create table if not exists public.model_pricing_rates (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  model text not null,
  currency text not null default 'USD' check (currency = 'USD'),
  input_per_million numeric(12, 6) not null check (input_per_million >= 0),
  output_per_million numeric(12, 6) not null check (output_per_million >= 0),
  cache_read_per_million numeric(12, 6) not null check (cache_read_per_million >= 0),
  cache_creation_per_million numeric(12, 6) not null check (cache_creation_per_million >= 0),
  cache_ttl text not null default '5m',
  effective_at timestamptz not null,
  retired_at timestamptz,
  source_url text not null,
  notes text,
  created_at timestamptz not null default now(),
  check (retired_at is null or retired_at > effective_at)
);

create unique index if not exists model_pricing_rates_effective_version
  on public.model_pricing_rates (provider, model, effective_at);

create index if not exists model_pricing_rates_active_lookup
  on public.model_pricing_rates (provider, model, effective_at desc);

-- Rates are public Claude API list prices per million tokens. Cache creation
-- uses the documented five-minute multiplier; the runtime's current prompt
-- cache posture is five minutes. Update by inserting a new effective version,
-- never by overwriting a historical row.
insert into public.model_pricing_rates (
  provider, model, input_per_million, output_per_million, cache_read_per_million,
  cache_creation_per_million, cache_ttl, effective_at, source_url, notes
)
values
  ('anthropic', 'claude-opus-4-6', 5.000000, 25.000000, 0.500000, 6.250000, '5m',
   '2026-02-05T00:00:00Z', 'https://platform.claude.com/docs/en/about-claude/pricing',
   'Public Claude API list price; cache read is 10% and five-minute cache creation is 125% of base input.'),
  ('anthropic', 'claude-sonnet-4-6', 3.000000, 15.000000, 0.300000, 3.750000, '5m',
   '2026-02-17T00:00:00Z', 'https://platform.claude.com/docs/en/about-claude/pricing',
   'Public Claude API list price; cache read is 10% and five-minute cache creation is 125% of base input.')
on conflict (provider, model, effective_at) do nothing;

create table if not exists public.runtime_accounting_budget_policies (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('global', 'agent')),
  agent text references public.agents(name) on delete cascade,
  window_hours integer not null default 24 check (window_hours in (24, 168)),
  limit_usd numeric(12, 4),
  warning_percent integer not null default 80 check (warning_percent between 1 and 100),
  enabled boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((scope = 'global' and agent is null) or (scope = 'agent' and agent is not null)),
  check (limit_usd is null or limit_usd >= 0)
);

create unique index if not exists runtime_accounting_budget_global_window
  on public.runtime_accounting_budget_policies (window_hours) where scope = 'global';
create unique index if not exists runtime_accounting_budget_agent_window
  on public.runtime_accounting_budget_policies (agent, window_hours) where scope = 'agent';

alter table public.model_pricing_rates enable row level security;
alter table public.runtime_accounting_budget_policies enable row level security;
revoke all on table public.model_pricing_rates, public.runtime_accounting_budget_policies
  from anon, authenticated, service_role;
grant select, insert, update, delete on table public.model_pricing_rates, public.runtime_accounting_budget_policies
  to service_role;
