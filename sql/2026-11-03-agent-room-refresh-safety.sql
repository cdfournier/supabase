-- Agent-owned Room Refresh safety.
--
-- This migration makes compaction archive state explicit, preserves every
-- Room Note revision, and adds an atomic checkpoint-finalization function.
-- It never deletes source messages; a failed archive or checkpoint leaves the
-- transcript intact and an auditable failure state behind.

alter table public.compaction_archives
  add column if not exists archive_status text not null default 'legacy_completed',
  add column if not exists source_end_position int,
  add column if not exists source_digest text,
  add column if not exists ready_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists failure_reason text,
  add column if not exists orientation_status text not null default 'not_requested',
  add column if not exists orientation_message_id uuid,
  add column if not exists orientation_completed_at timestamptz,
  add column if not exists orientation_error text;

update public.compaction_archives
set
  archive_status = case
    when checkpoint_message_id is not null then 'completed'
    else 'legacy_completed'
  end,
  completed_at = coalesce(completed_at, created_at)
where archive_status = 'legacy_completed';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'compaction_archives_status_check'
  ) then
    alter table public.compaction_archives
      add constraint compaction_archives_status_check
      check (archive_status in ('archiving', 'ready', 'completed', 'checkpoint_failed', 'failed', 'legacy_completed'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'compaction_archives_orientation_status_check'
  ) then
    alter table public.compaction_archives
      add constraint compaction_archives_orientation_status_check
      check (orientation_status in ('not_requested', 'pending', 'delivering', 'completed', 'failed'));
  end if;
end $$;

create index if not exists compaction_archives_by_status
  on public.compaction_archives (agent, archive_status, created_at desc);

create table if not exists public.compaction_proposal_revisions (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references public.compaction_proposals(id) on delete cascade,
  agent text not null references public.agents(name),
  revision_number int not null,
  proposal text not null,
  agent_notes text,
  status text not null,
  change_reason text,
  created_at timestamptz not null default now(),
  unique (proposal_id, revision_number)
);

create index if not exists compaction_proposal_revisions_by_proposal
  on public.compaction_proposal_revisions (proposal_id, revision_number asc);

alter table public.compaction_proposal_revisions enable row level security;
revoke all on table public.compaction_proposal_revisions from anon, authenticated, service_role;
grant select, insert, update, delete on table public.compaction_proposal_revisions to service_role;

-- Backfill each existing mutable proposal as revision one. The historical
-- source cannot be reconstructed if it was overwritten before this migration,
-- so the receipt names it honestly as a migration baseline.
insert into public.compaction_proposal_revisions
  (proposal_id, agent, revision_number, proposal, agent_notes, status, change_reason, created_at)
select
  proposal.id,
  proposal.agent,
  1,
  proposal.proposal,
  proposal.agent_notes,
  proposal.status,
  'Migration baseline: prior revisions were not retained.',
  proposal.created_at
from public.compaction_proposals proposal
where not exists (
  select 1
  from public.compaction_proposal_revisions revision
  where revision.proposal_id = proposal.id
);

-- Revision writes must advance the live draft and append its immutable snapshot
-- together. A failed revision transaction leaves the last usable draft intact.
create or replace function public.revise_compaction_proposal(
  p_proposal_id uuid,
  p_agent text,
  p_proposal text default null,
  p_agent_notes text default null,
  p_status text default null,
  p_change_reason text default null
)
returns table (
  id uuid,
  agent text,
  conversation_id text,
  proposal text,
  source_summary jsonb,
  status text,
  agent_notes text,
  created_at timestamptz,
  updated_at timestamptz,
  revision_number int
)
language plpgsql
as $$
declare
  v_existing public.compaction_proposals%rowtype;
  v_revision_number int;
begin
  select * into v_existing
  from public.compaction_proposals as proposal_row
  where proposal_row.id = p_proposal_id and proposal_row.agent = p_agent
  for update;

  if not found then
    raise exception 'No matching active-Agent Room Note found.';
  end if;

  update public.compaction_proposals as proposal_row
  set
    proposal = coalesce(p_proposal, v_existing.proposal),
    agent_notes = coalesce(p_agent_notes, v_existing.agent_notes),
    status = coalesce(p_status, v_existing.status),
    updated_at = now()
  where proposal_row.id = p_proposal_id
  returning * into v_existing;

  select coalesce(max(revision_row.revision_number), 0) + 1
    into v_revision_number
  from public.compaction_proposal_revisions as revision_row
  where revision_row.proposal_id = p_proposal_id;

  insert into public.compaction_proposal_revisions
    (proposal_id, agent, revision_number, proposal, agent_notes, status, change_reason)
  values
    (
      v_existing.id,
      v_existing.agent,
      v_revision_number,
      v_existing.proposal,
      v_existing.agent_notes,
      v_existing.status,
      coalesce(p_change_reason, 'Agent revised the Room Note.')
    );

  return query
  select
    v_existing.id,
    v_existing.agent,
    v_existing.conversation_id,
    v_existing.proposal,
    v_existing.source_summary,
    v_existing.status,
    v_existing.agent_notes,
    v_existing.created_at,
    v_existing.updated_at,
    v_revision_number;
end;
$$;

revoke all on function public.revise_compaction_proposal(uuid, text, text, text, text, text) from public;
grant execute on function public.revise_compaction_proposal(uuid, text, text, text, text, text) to service_role;

-- Finalization is one transaction: it locks the conversation, verifies the
-- complete ready archive still matches the active source window, appends the
-- checkpoint, and updates every linked receipt together. If it raises, the
-- caller marks the already-preserved archive checkpoint_failed.
create or replace function public.finalize_compaction_archive(
  p_archive_id uuid,
  p_agent text,
  p_conversation_id text,
  p_proposal_id uuid,
  p_checkpoint_id uuid,
  p_checkpoint_content text,
  p_require_agent_approval boolean default false
)
returns table (
  checkpoint_message_id uuid,
  checkpoint_position int,
  compaction_count int,
  archive_status text
)
language plpgsql
as $$
declare
  v_archive public.compaction_archives%rowtype;
  v_proposal public.compaction_proposals%rowtype;
  v_current_max_position int;
  v_archived_count int;
  v_archived_end_position int;
  v_next_compaction_count int;
  v_next_proposal_revision int;
begin
  perform 1
  from public.conversations as conversation_row
  where conversation_row.id = p_conversation_id and conversation_row.agent = p_agent
  for update;

  if not found then
    raise exception 'Room Refresh conversation is unavailable.';
  end if;

  select * into v_archive
  from public.compaction_archives as archive_row
  where archive_row.id = p_archive_id
    and archive_row.agent = p_agent
    and archive_row.conversation_id = p_conversation_id
  for update;

  if not found then
    raise exception 'Room Refresh archive is unavailable.';
  end if;

  if v_archive.archive_status <> 'ready' then
    raise exception 'Room Refresh archive is not ready (status: %).', v_archive.archive_status;
  end if;

  select count(*), coalesce(max(position), -1)
    into v_archived_count, v_archived_end_position
  from public.compaction_archive_messages as archived_message
  where archived_message.archive_id = p_archive_id;

  if v_archived_count <> v_archive.message_count
     or v_archived_end_position is distinct from coalesce(v_archive.source_end_position, -1) then
    raise exception 'Room Refresh archive integrity check failed.';
  end if;

  if p_proposal_id is not null then
    select * into v_proposal
    from public.compaction_proposals as proposal_row
    where proposal_row.id = p_proposal_id
      and proposal_row.agent = p_agent
      and proposal_row.conversation_id = p_conversation_id
    for update;

    if not found then
      raise exception 'Room Refresh proposal is unavailable.';
    end if;

    if p_require_agent_approval and v_proposal.status <> 'agent_approved' then
      raise exception 'Room Refresh requires an agent-approved Room Note.';
    end if;
  end if;

  select coalesce(max(position), -1)
    into v_current_max_position
  from public.conversation_messages as message_row
  where message_row.conversation_id = p_conversation_id;

  if v_current_max_position is distinct from coalesce(v_archive.source_end_position, -1) then
    raise exception 'Room Refresh source window changed after archive; create a fresh Room Review.';
  end if;

  insert into public.conversation_messages
    (id, conversation_id, position, role, content)
  values
    (p_checkpoint_id, p_conversation_id, v_current_max_position + 1, 'assistant', to_jsonb(p_checkpoint_content));

  update public.compaction_archives as archive_row
  set
    checkpoint_message_id = p_checkpoint_id,
    archive_status = 'completed',
    completed_at = now(),
    failure_reason = null,
    orientation_status = case when p_require_agent_approval then 'pending' else 'not_requested' end
  where archive_row.id = p_archive_id;

  if p_proposal_id is not null then
    update public.compaction_proposals as proposal_row
    set status = 'room_refreshed', updated_at = now()
    where proposal_row.id = p_proposal_id;

    select coalesce(max(revision_row.revision_number), 0) + 1
      into v_next_proposal_revision
    from public.compaction_proposal_revisions as revision_row
    where revision_row.proposal_id = p_proposal_id;

    insert into public.compaction_proposal_revisions
      (proposal_id, agent, revision_number, proposal, agent_notes, status, change_reason)
    values
      (
        v_proposal.id,
        v_proposal.agent,
        v_next_proposal_revision,
        v_proposal.proposal,
        v_proposal.agent_notes,
        'room_refreshed',
        case
          when p_require_agent_approval then 'Agent sent the approved Room Refresh.'
          else 'Operator sent the reviewed Room Refresh.'
        end
      );
  end if;

  update public.conversations as conversation_row
  set
    compaction_count = coalesce(conversation_row.compaction_count, 0) + 1,
    updated_at = now()
  where conversation_row.id = p_conversation_id
  returning conversation_row.compaction_count into v_next_compaction_count;

  return query
  select p_checkpoint_id, v_current_max_position + 1, v_next_compaction_count, 'completed'::text;
end;
$$;

revoke all on function public.finalize_compaction_archive(uuid, text, text, uuid, uuid, text, boolean) from public;
grant execute on function public.finalize_compaction_archive(uuid, text, text, uuid, uuid, text, boolean) to service_role;
