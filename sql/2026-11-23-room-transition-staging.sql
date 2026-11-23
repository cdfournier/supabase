-- Room-transition staging: an automated Room Refresh waits rather than
-- entering a room owned by an active chat turn or Free Moment.
--
-- This extends the existing capacity-trigger receipt state; it does not
-- enable automatic refreshes or change an Agent's approval requirements.

alter table public.room_refresh_trigger_receipts
  drop constraint if exists room_refresh_trigger_receipts_status_check;

alter table public.room_refresh_trigger_receipts
  add constraint room_refresh_trigger_receipts_status_check
  check (
    status in (
      'queued',
      'waiting_for_active_turn',
      'delivering',
      'delivered',
      'maintenance_pending',
      'completed',
      'cancelled',
      'failed'
    )
  );
