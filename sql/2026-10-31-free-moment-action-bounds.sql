-- Free Moment action bounds are stored in the existing per-agent capability
-- rows. This migration only adds the ordinary terminal receipt for a turn
-- that reaches its configured budget.
--
-- Rollback (only after no bounded receipts remain):
--   update public.free_moment_runs set status = 'completed' where status = 'bounded';
--   alter table public.free_moment_runs drop constraint if exists free_moment_runs_status_check;
--   alter table public.free_moment_runs add constraint free_moment_runs_status_check
--     check (status in ('running', 'cancellation_requested', 'wrapping_up', 'completed', 'cancelled', 'forced_stop', 'failed', 'interrupted'));

alter table public.free_moment_runs
  drop constraint if exists free_moment_runs_status_check;

alter table public.free_moment_runs
  add constraint free_moment_runs_status_check
  check (status in ('running', 'cancellation_requested', 'wrapping_up', 'completed', 'bounded', 'cancelled', 'forced_stop', 'failed', 'interrupted'));
