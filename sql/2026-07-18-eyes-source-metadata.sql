-- Generic source-material metadata support.
-- Safe to run more than once. This keeps the existing source-material upload
-- path canonical while adding an explicit provenance/posture envelope.

alter table public.source_materials
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create index if not exists source_materials_by_metadata_surface
  on public.source_materials ((metadata->>'surface'), created_at desc);
