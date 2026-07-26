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

alter table public.cafe_rooms enable row level security;
alter table public.cafe_participants enable row level security;
alter table public.cafe_messages enable row level security;

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
