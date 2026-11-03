-- Durable, per-recipient receipts for shared Cafe attachments.
--
-- Cafe attachments are addressed to the whole family table.  This ledger is
-- deliberately separate from source_material_access: Soren and Varro receive
-- native-runtime source access, while Julian and Cael receive media through
-- the authenticated Cafe bridge.
--
-- Rollback before live use:
--   drop table if exists public.cafe_attachment_deliveries;

-- Supabase preview branches carry the relational schema but do not reliably
-- inherit Storage buckets. Cafe image delivery cannot be meaningfully tested
-- without the same private bucket used in production, so provision it
-- idempotently here. Runtime uploads use the service role; the bucket remains
-- private and receives no browser/public policy from this migration.
insert into storage.buckets (id, name, public, file_size_limit)
values ('source-materials', 'source-materials', false, 26214400)
on conflict (id) do update
set
  public = false,
  file_size_limit = 26214400;

create table if not exists public.cafe_attachment_deliveries (
  id uuid primary key default gen_random_uuid(),
  cafe_message_id uuid not null references public.cafe_messages(id) on delete cascade,
  source_material_id uuid not null references public.source_materials(id) on delete cascade,
  recipient_id text not null,
  delivery_method text not null,
  status text not null default 'available',
  available_at timestamptz not null default now(),
  delivered_at timestamptz,
  last_error text,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint cafe_attachment_deliveries_method_check check (
    delivery_method in ('runtime_native', 'external_bridge')
  ),
  constraint cafe_attachment_deliveries_status_check check (
    status in ('available', 'delivered', 'failed')
  ),
  unique (cafe_message_id, source_material_id, recipient_id)
);

create index if not exists cafe_attachment_deliveries_by_recipient
  on public.cafe_attachment_deliveries (recipient_id, status, available_at desc);

create index if not exists cafe_attachment_deliveries_by_message
  on public.cafe_attachment_deliveries (cafe_message_id, available_at desc);

alter table public.cafe_attachment_deliveries enable row level security;

revoke all on table public.cafe_attachment_deliveries from anon, authenticated, service_role;
grant select, insert, update, delete on table public.cafe_attachment_deliveries to service_role;
