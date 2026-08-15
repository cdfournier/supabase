-- Durable packet-signal WAKE delivery receipts.
-- Rollback before relying on the table: drop table if exists public.work_packet_wake_receipts;
-- After live use, preserve/export rows before dropping because they are audit receipts.

create table if not exists public.work_packet_wake_receipts (
  id uuid primary key default gen_random_uuid(),
  signal_key text not null,
  packet_id uuid references public.work_packets(id) on delete cascade,
  packet_event_id uuid references public.work_packet_events(id) on delete cascade,
  participant_id text not null,
  delivery_method text not null default 'runtime_native',
  source text not null default 'work_packet_signal',
  wake_priority text not null default 'digest_only',
  wake_tone text not null default 'directed',
  status text not null default 'completed',
  prompt_excerpt text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  attempted_at timestamptz not null default now(),
  completed_at timestamptz,
  failed_at timestamptz,
  error text
);

create unique index if not exists work_packet_wake_receipts_unique_delivery
  on public.work_packet_wake_receipts (signal_key, participant_id, delivery_method);

create index if not exists work_packet_wake_receipts_by_participant
  on public.work_packet_wake_receipts (participant_id, attempted_at desc);

create index if not exists work_packet_wake_receipts_by_packet
  on public.work_packet_wake_receipts (packet_id, attempted_at desc);

alter table public.work_packet_wake_receipts enable row level security;
