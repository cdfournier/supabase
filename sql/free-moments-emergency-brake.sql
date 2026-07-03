alter table public.conversation_messages
  add column if not exists source text not null default 'unknown';

create index if not exists cm_by_source_created
  on public.conversation_messages (source, created_at desc);

create table if not exists public.runtime_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

insert into public.runtime_settings (key, value)
values ('free_moments', '{"enabled": false}'::jsonb)
on conflict (key) do update
set value = '{"enabled": false}'::jsonb,
    updated_at = now();

alter table public.runtime_settings enable row level security;
