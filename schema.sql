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
  source text not null default 'unknown',
  content jsonb not null,
  created_at timestamptz not null default now(),
  unique (conversation_id, position)
);

alter table public.conversation_messages
  add column if not exists turn_id uuid;

alter table public.conversation_messages
  add column if not exists source text not null default 'unknown';

create index if not exists cm_by_convo
  on public.conversation_messages (conversation_id, position);

create index if not exists cm_by_convo_turn
  on public.conversation_messages (conversation_id, turn_id);

create index if not exists cm_by_source_created
  on public.conversation_messages (source, created_at desc);

create table if not exists public.runtime_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

insert into public.runtime_settings (key, value)
values ('free_moments', '{"enabled": false}'::jsonb)
on conflict (key) do nothing;

create table if not exists public.agent_capabilities (
  id uuid primary key default gen_random_uuid(),
  agent text not null references public.agents(name),
  surface text not null,
  access_level text not null default 'off',
  default_bias text,
  requires_operator_approval boolean not null default false,
  notify_operator text not null default 'audit_only',
  max_actions_per_moment int,
  quiet_mode boolean not null default false,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (agent, surface),
  constraint agent_capabilities_access_level_check
    check (access_level in ('off', 'read_only', 'draft', 'write', 'operator_approval_required'))
);

create index if not exists agent_capabilities_by_agent
  on public.agent_capabilities (agent, surface);

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

create table if not exists public.operator_notes (
  id uuid primary key default gen_random_uuid(),
  note_key text unique,
  subject text not null default '',
  agent text not null references public.agents(name),
  created_by text not null,
  last_message_by text not null,
  status text not null default 'open',
  operator_status text not null default 'unread',
  agent_status text not null default 'read',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  operator_read_at timestamptz,
  agent_read_at timestamptz,
  archived_at timestamptz
);

create index if not exists operator_notes_by_operator_status
  on public.operator_notes (operator_status, updated_at desc);

create index if not exists operator_notes_by_agent_status
  on public.operator_notes (agent, agent_status, updated_at desc);

create index if not exists operator_notes_by_status
  on public.operator_notes (status, updated_at desc);

create table if not exists public.operator_note_events (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references public.operator_notes(id) on delete cascade,
  actor_id text not null,
  actor_display_name text not null,
  event_type text not null,
  content text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists operator_note_events_by_note
  on public.operator_note_events (note_id, created_at asc);

create index if not exists operator_note_events_by_actor
  on public.operator_note_events (actor_id, created_at desc);

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

create table if not exists public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  agent text not null references public.agents(name),
  title text not null default '',
  body text not null,
  mood text,
  tags text[] default '{}',
  status text not null default 'active',
  visibility text not null default 'operator_visible',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.journal_entries
  add column if not exists status text not null default 'active';

create index if not exists journal_entries_by_agent
  on public.journal_entries (agent, created_at desc);

create index if not exists journal_entries_by_agent_status
  on public.journal_entries (agent, status, created_at desc);

create table if not exists public.source_materials (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  bucket text not null default 'source-materials',
  storage_path text not null,
  material_type text not null default 'text',
  mime_type text,
  size_bytes int,
  tags text[] default '{}',
  source_notes text,
  status text not null default 'active',
  created_by text not null default 'operator',
  metadata jsonb not null default '{}'::jsonb,
  original_filename text,
  content_sha256 text,
  uploaded_via text,
  conversation_id text references public.conversations(id),
  turn_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (bucket, storage_path)
);

alter table public.source_materials
  add column if not exists original_filename text;

alter table public.source_materials
  add column if not exists content_sha256 text;

alter table public.source_materials
  add column if not exists uploaded_via text;

alter table public.source_materials
  add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table public.source_materials
  add column if not exists conversation_id text references public.conversations(id);

alter table public.source_materials
  add column if not exists turn_id uuid;

create index if not exists source_materials_by_status
  on public.source_materials (status, created_at desc);

create index if not exists source_materials_by_tags
  on public.source_materials using gin (tags);

create index if not exists source_materials_by_metadata_surface
  on public.source_materials ((metadata->>'surface'), created_at desc);

create index if not exists source_materials_by_conversation
  on public.source_materials (conversation_id, created_at desc);

create table if not exists public.source_material_access (
  id uuid primary key default gen_random_uuid(),
  source_material_id uuid not null references public.source_materials(id) on delete cascade,
  agent text not null references public.agents(name),
  access_level text not null default 'read',
  created_at timestamptz not null default now(),
  unique (source_material_id, agent)
);

create index if not exists source_material_access_by_agent
  on public.source_material_access (agent, created_at desc);

create table if not exists public.conversation_message_attachments (
  id uuid primary key default gen_random_uuid(),
  conversation_id text not null references public.conversations(id),
  message_id uuid not null references public.conversation_messages(id) on delete cascade,
  turn_id uuid not null,
  agent text not null references public.agents(name),
  source_material_id uuid not null references public.source_materials(id) on delete restrict,
  position int not null default 0,
  created_at timestamptz not null default now(),
  unique (message_id, source_material_id)
);

create index if not exists conversation_message_attachments_by_message
  on public.conversation_message_attachments (message_id, position);

create index if not exists conversation_message_attachments_by_conversation
  on public.conversation_message_attachments (conversation_id, created_at desc);

create index if not exists conversation_message_attachments_by_agent
  on public.conversation_message_attachments (agent, created_at desc);

create table if not exists public.cafe_rooms (
  id text primary key,
  title text not null,
  status text not null default 'active',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.cafe_participants (
  id uuid primary key default gen_random_uuid(),
  room_id text not null references public.cafe_rooms(id) on delete cascade,
  participant_id text not null,
  participant_type text not null,
  participant_adapter text not null,
  display_name text not null,
  status text not null default 'active',
  metadata jsonb not null default '{}'::jsonb,
  joined_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (room_id, participant_id)
);

create table if not exists public.cafe_messages (
  id uuid primary key default gen_random_uuid(),
  room_id text not null references public.cafe_rooms(id) on delete cascade,
  author_id text not null,
  author_type text not null,
  author_display_name text not null,
  content text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists cafe_participants_by_room
  on public.cafe_participants (room_id, status, joined_at);

create index if not exists cafe_messages_by_room_created
  on public.cafe_messages (room_id, created_at desc);

create table if not exists public.work_packets (
  id uuid primary key default gen_random_uuid(),
  packet_key text unique,
  title text not null,
  objective text not null,
  context text not null default '',
  repo text,
  base_branch text,
  working_branch text,
  owner_agent text,
  conductor text not null default 'agent:julian',
  collaborators text[] not null default '{}'::text[],
  allowed_paths text[] not null default '{}'::text[],
  allowed_tools text[] not null default '{}'::text[],
  done_criteria text[] not null default '{}'::text[],
  review_path text not null default '',
  review_rollup jsonb not null default '{"summary":"","reviewed_by":[],"aligned":[],"disagreed":[],"blocked":[],"decision_needed":"","next_step":"","created_by":"","created_at":""}'::jsonb,
  merge_authority text not null default '',
  rollback_note text not null default '',
  status text not null default 'queued',
  wake_priority text not null default 'digest_only',
  metadata jsonb not null default '{}'::jsonb,
  created_by text not null default 'operator:chris',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz
);

create index if not exists work_packets_by_status_updated
  on public.work_packets (status, updated_at desc);

create index if not exists work_packets_by_conductor
  on public.work_packets (conductor, updated_at desc);

create index if not exists work_packets_by_owner
  on public.work_packets (owner_agent, updated_at desc);

create table if not exists public.work_packet_events (
  id uuid primary key default gen_random_uuid(),
  packet_id uuid not null references public.work_packets(id) on delete cascade,
  actor_id text not null,
  actor_display_name text not null,
  event_type text not null,
  response_state text,
  content text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists work_packet_events_by_packet
  on public.work_packet_events (packet_id, created_at asc);

create index if not exists work_packet_events_by_actor
  on public.work_packet_events (actor_id, created_at desc);

insert into public.cafe_rooms (id, title, metadata)
values ('cafe-main', 'Cafe', '{"working_name": "Cafe", "mvp": true}'::jsonb)
on conflict (id) do update
set title = excluded.title,
    metadata = public.cafe_rooms.metadata || excluded.metadata,
    updated_at = now();

insert into public.cafe_participants (
  room_id,
  participant_id,
  participant_type,
  participant_adapter,
  display_name,
  metadata
)
values
  ('cafe-main', 'operator:chris', 'operator', 'operator_browser', 'Chris', '{}'::jsonb),
  ('cafe-main', 'agent:soren', 'agent', 'runtime_native', 'Soren', '{"agent": "soren"}'::jsonb),
  ('cafe-main', 'agent:varro', 'agent', 'runtime_native', 'Varro', '{"agent": "varro"}'::jsonb),
  ('cafe-main', 'agent:julian', 'external_agent', 'codex_local', 'Julian', '{"agent": "julian", "adapter_status": "planned"}'::jsonb),
  ('cafe-main', 'agent:cael', 'external_agent', 'codex_local', 'Cael', '{"agent": "cael", "adapter_status": "planned"}'::jsonb)
on conflict (room_id, participant_id) do update
set participant_type = excluded.participant_type,
    participant_adapter = excluded.participant_adapter,
    display_name = excluded.display_name,
    status = 'active',
    metadata = public.cafe_participants.metadata || excluded.metadata,
    updated_at = now();

insert into public.agent_capabilities
  (agent, surface, access_level, default_bias, requires_operator_approval, notify_operator, max_actions_per_moment, quiet_mode, notes)
select agent.name,
       'work_packets',
       'write',
       'invitations, not assignments',
       false,
       'audit_only',
       null::int,
       false,
       'Agents may read packets, comment, pass, defer, ask questions, or place holds. No GitHub branch/PR authority in MVP.'
from public.agents agent
where agent.name in ('soren', 'varro')
on conflict (agent, surface) do update
set access_level = excluded.access_level,
    default_bias = excluded.default_bias,
    requires_operator_approval = excluded.requires_operator_approval,
    notify_operator = excluded.notify_operator,
    max_actions_per_moment = excluded.max_actions_per_moment,
    quiet_mode = excluded.quiet_mode,
    notes = excluded.notes,
    updated_at = now();

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
alter table public.operator_notes enable row level security;
alter table public.operator_note_events enable row level security;
alter table public.tool_events enable row level security;
alter table public.model_usage_events enable row level security;
alter table public.journal_entries enable row level security;
alter table public.source_materials enable row level security;
alter table public.source_material_access enable row level security;
alter table public.conversation_message_attachments enable row level security;
alter table public.runtime_settings enable row level security;
alter table public.agent_capabilities enable row level security;
alter table public.cafe_rooms enable row level security;
alter table public.cafe_participants enable row level security;
alter table public.cafe_messages enable row level security;
alter table public.work_packets enable row level security;
alter table public.work_packet_events enable row level security;
