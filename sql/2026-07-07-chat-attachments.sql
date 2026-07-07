-- Chat-native attachment support.
-- Safe to run more than once. Supabase Storage remains canonical; Anthropic
-- file ids, when added later, are delivery cache only.

insert into storage.buckets (id, name, public, file_size_limit)
values ('source-materials', 'source-materials', false, 26214400)
on conflict (id) do update
set
  public = false,
  file_size_limit = 26214400;

alter table public.source_materials
  add column if not exists original_filename text;

alter table public.source_materials
  add column if not exists content_sha256 text;

alter table public.source_materials
  add column if not exists uploaded_via text;

alter table public.source_materials
  add column if not exists conversation_id text references public.conversations(id);

alter table public.source_materials
  add column if not exists turn_id uuid;

create index if not exists source_materials_by_conversation
  on public.source_materials (conversation_id, created_at desc);

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

alter table public.conversation_message_attachments enable row level security;
