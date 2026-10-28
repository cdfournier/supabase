-- Data API hardening after Supabase's October 2026 default-privilege change.
--
-- The runtime uses Supabase's Data API through a server-only service-role key.
-- It has no direct browser Supabase client. Existing RLS is enabled on every
-- public runtime table and no public policies are defined.
--
-- This migration is safe to re-run. It removes the old broad Data API grants
-- from anon/authenticated, preserves only runtime CRUD access for service_role,
-- and makes new tables/sequences created by the SQL Editor's postgres role
-- require an explicit grant.
--
-- Rollback is intentionally table-specific: add a reviewed RLS policy and the
-- smallest required grant for the browser-facing table. Do not bulk re-enable
-- Data API access for anon or authenticated roles.

begin;

revoke all privileges on all tables in schema public
  from anon, authenticated, service_role;

grant select, insert, update, delete on all tables in schema public
  to service_role;

revoke all privileges on all sequences in schema public
  from anon, authenticated, service_role;

grant usage, select on all sequences in schema public
  to service_role;

alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated, service_role;

alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated, service_role;

commit;
