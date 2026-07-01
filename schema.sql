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
  turn_id uuid,
  position int not null,
  role text not null,
  content jsonb not null,
  created_at timestamptz not null default now(),
  unique (conversation_id, position)
);

alter table public.conversation_messages
  add column if not exists turn_id uuid;

create index if not exists cm_by_convo
  on public.conversation_messages (conversation_id, position);

create index if not exists cm_by_convo_turn
  on public.conversation_messages (conversation_id, turn_id);

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

create table if not exists public.compaction_archives (
  id uuid primary key default gen_random_uuid(),
  agent text not null references public.agents(name),
  conversation_id text not null references public.conversations(id),
  proposal_id uuid references public.compaction_proposals(id),
  checkpoint_message_id uuid,
  source text not null default 'manual_compaction_checkpoint',
  message_count int not null default 0,
  latest_checkpoint_position int,
  source_started_at timestamptz,
  source_ended_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists compaction_archives_by_conversation
  on public.compaction_archives (conversation_id, created_at desc);

create index if not exists compaction_archives_by_agent
  on public.compaction_archives (agent, created_at desc);

create table if not exists public.compaction_archive_messages (
  id uuid primary key default gen_random_uuid(),
  archive_id uuid not null references public.compaction_archives(id) on delete restrict,
  original_message_id uuid,
  conversation_id text not null references public.conversations(id),
  position int not null,
  role text not null,
  content jsonb not null,
  message_created_at timestamptz,
  created_at timestamptz not null default now(),
  unique (archive_id, position)
);

create index if not exists compaction_archive_messages_by_archive
  on public.compaction_archive_messages (archive_id, position);

create table if not exists public.peer_notes (
  id uuid primary key default gen_random_uuid(),
  from_agent text not null references public.agents(name),
  to_agent text not null references public.agents(name),
  subject text not null default '',
  body text not null,
  status text not null default 'unread',
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index if not exists peer_notes_by_recipient_status
  on public.peer_notes (to_agent, status, created_at desc);

create index if not exists peer_notes_by_sender
  on public.peer_notes (from_agent, created_at desc);

create table if not exists public.tool_events (
  id uuid primary key default gen_random_uuid(),
  agent text not null references public.agents(name),
  conversation_id text not null references public.conversations(id),
  turn_id uuid not null,
  round int not null default 0,
  tool_use_id text,
  tool_name text not null,
  tool_input jsonb default '{}'::jsonb,
  ok boolean not null default false,
  result_preview text,
  result_chars int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists tool_events_by_turn
  on public.tool_events (conversation_id, turn_id, created_at);

create index if not exists tool_events_by_agent
  on public.tool_events (agent, created_at desc);

create table if not exists public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  agent text not null references public.agents(name),
  title text not null default '',
  body text not null,
  mood text,
  tags text[] default '{}',
  visibility text not null default 'operator_visible',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists journal_entries_by_agent
  on public.journal_entries (agent, created_at desc);

alter table public.agents enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_messages enable row level security;
alter table public.memories enable row level security;
alter table public.relationships enable row level security;
alter table public.restoration_profiles enable row level security;
alter table public.compaction_proposals enable row level security;
alter table public.compaction_archives enable row level security;
alter table public.compaction_archive_messages enable row level security;
alter table public.peer_notes enable row level security;
alter table public.tool_events enable row level security;
alter table public.journal_entries enable row level security;
