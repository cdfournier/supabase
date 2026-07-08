create table if not exists public.model_usage_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  model text not null,
  agent text not null references public.agents(name),
  conversation_id text not null references public.conversations(id),
  turn_id uuid,
  source text not null default 'unknown',
  operation text not null default 'chat',
  round int,
  provider_request_id text,
  stop_reason text,
  ok boolean not null default true,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  cache_read_tokens int not null default 0,
  cache_creation_tokens int not null default 0,
  raw_usage jsonb not null default '{}'::jsonb,
  request_summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists model_usage_events_by_agent
  on public.model_usage_events (agent, created_at desc);

create index if not exists model_usage_events_by_conversation_turn
  on public.model_usage_events (conversation_id, turn_id, created_at);

create index if not exists model_usage_events_by_provider_model
  on public.model_usage_events (provider, model, created_at desc);

create index if not exists model_usage_events_by_source
  on public.model_usage_events (source, created_at desc);

alter table public.model_usage_events enable row level security;
