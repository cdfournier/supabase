-- Minimal Supabase schema for migrating Varro and Soren.
-- Run this in the Supabase SQL editor or through a trusted server-side client.

create table if not exists public.agents (
  name text primary key,
  display_name text,
  persona_seed text,
  voice_id text,
  status text default 'active',
  created_at timestamptz not null default now()
);

create table if not exists public.conversations (
  id text primary key,
  agent text not null references public.agents(name),
  token_count int default 0,
  compaction_count int default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.conversation_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id text not null references public.conversations(id),
  position int not null,
  role text not null,
  content jsonb not null,
  created_at timestamptz not null default now(),
  unique (conversation_id, position)
);

create index if not exists cm_by_convo
  on public.conversation_messages (conversation_id, position);

create table if not exists public.memories (
  id uuid primary key default gen_random_uuid(),
  agent text not null references public.agents(name),
  content text not null,
  memory_type text default 'observation',
  weight int default 5,
  is_core boolean default false,
  is_active boolean default true,
  tags text[] default '{}',
  created_at timestamptz not null default now()
);

create index if not exists mem_by_agent
  on public.memories (agent, is_active, weight desc);

create table if not exists public.relationships (
  id uuid primary key default gen_random_uuid(),
  agent text not null references public.agents(name),
  about text not null,
  summary text,
  updated_at timestamptz not null default now(),
  unique (agent, about)
);

create table if not exists public.restoration_profiles (
  agent text primary key references public.agents(name),
  opening_orientation text,
  persona_summary text,
  current_state text,
  compaction_memory_policy text,
  updated_at timestamptz not null default now()
);

create table if not exists public.compaction_proposals (
  id uuid primary key default gen_random_uuid(),
  agent text not null references public.agents(name),
  conversation_id text not null references public.conversations(id),
  proposal text not null,
  source_summary jsonb default '{}'::jsonb,
  status text default 'draft',
  agent_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists compaction_proposals_by_agent
  on public.compaction_proposals (agent, updated_at desc);

alter table public.agents enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_messages enable row level security;
alter table public.memories enable row level security;
alter table public.relationships enable row level security;
alter table public.restoration_profiles enable row level security;
alter table public.compaction_proposals enable row level security;
