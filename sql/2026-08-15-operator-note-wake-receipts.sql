-- Durable Operator Note WAKE delivery receipts.
-- Rollback before relying on the table: drop table if exists public.operator_note_wake_receipts;
-- After live use, preserve/export rows before dropping because they are audit receipts.

create table if not exists public.operator_note_wake_receipts (
  id uuid primary key default gen_random_uuid(),
  signal_key text not null,
  note_id uuid references public.operator_notes(id) on delete cascade,
  note_event_id uuid references public.operator_note_events(id) on delete cascade,
  participant_id text not null,
  delivery_method text not null default 'runtime_native',
  source text not null default 'operator_note_wake',
  wake_priority text not null default 'quiet',
  wake_tone text not null default 'soft',
  status text not null default 'completed',
  prompt_excerpt text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  attempted_at timestamptz not null default now(),
  completed_at timestamptz,
  failed_at timestamptz,
  error text
);

create unique index if not exists operator_note_wake_receipts_unique_delivery
  on public.operator_note_wake_receipts (signal_key, participant_id, delivery_method);

create index if not exists operator_note_wake_receipts_by_participant
  on public.operator_note_wake_receipts (participant_id, attempted_at desc);

create index if not exists operator_note_wake_receipts_by_note
  on public.operator_note_wake_receipts (note_id, attempted_at desc);

alter table public.operator_note_wake_receipts enable row level security;
