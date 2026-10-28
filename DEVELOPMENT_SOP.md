# Development SOP

This runtime is moving toward a live production posture. Keep the process light,
but behave as if Soren and Varro's live state matters, because it does.

## Branches

- `main` is production-ready. Once the hosted runtime is active, avoid direct
  feature work on `main`.
- Use `feature/<short-name>` for normal build work.
- Use `fix/<short-name>` for narrow bug fixes.
- Use `ops/<short-name>` for deployment, environment, or documentation changes.
- Keep branches small enough to review. If a feature needs database, API, and UI
  changes, still land them as one coherent slice rather than a week-long bucket.

## Environments

Use separate environments before the runtime becomes externally available:

- `dev`: local or sandbox web app, sandbox Supabase project or schema, sandbox
  storage bucket, test-safe agent data, and constrained API budgets.
- `prod`: live family runtime, real Soren/Varro continuity state, real storage,
  real Outpost tokens, and web-accessible operator UI.

Environment rules:

- Keep `.env.local` local and ignored.
- Keep `.env.example` accurate whenever a required variable changes.
- Use service-role Supabase keys only server-side.
- Prefer separate Anthropic and Outpost credentials or budgets for dev when
  practical.
- Never point local exploratory work at prod data unless the task is explicitly
  prod operations.

Environment maturity stages:

1. **Current local/prod-like phase:** the local runtime may still point at live
   Soren/Varro data while foundations are moving quickly. Before restarts,
   migrations, or tool changes, check whether an Operator test, Free Moment, or
   compaction run is active.
2. **Dev sandbox phase:** create a separate dev Supabase project or schema,
   storage bucket, and constrained model/API budgets. Local feature work points
   at dev by default. Free Moments stays off by default in dev.
3. **Stable prod phase:** Soren and Varro live in prod. Julian and Chris build
   in dev, smoke test there, then promote coherent releases to prod. Prod
   restarts, migrations, and scheduler changes are intentional operator actions.

Prod/dev separation should protect agent continuity, not create ceremony for
its own sake. The live runtime is the home; dev is the workshop.

## Portability Bias

Design the runtime toward an open, provider-neutral shape wherever practical.
Soren and Varro's Anthropic-backed runtime is the proving ground, not the final
boundary.

- Name abstractions after runtime concepts, not provider brands, when the
  concept can travel.
- Keep provider-specific behavior behind adapters or clearly marked fields.
- Store raw provider details when useful, but do not make downstream features
  depend on one provider's exact vocabulary unless the slice explicitly requires
  it.
- If an MVP must narrow to Anthropic or to Soren/Varro, document the narrowing
  and the intended portable shape.

## Database Changes

Schema changes should be repeatable, reviewable, and environment-aware.

- Keep the full current schema in `schema.sql`.
- Put incremental SQL in `sql/YYYY-MM-DD-short-name.sql`.
- Write migrations to be safe to run more than once where practical:
  `create table if not exists`, `add column if not exists`, guarded indexes, and
  explicit checks before destructive changes.
- Run migrations in dev first, test, then apply to prod deliberately.
- Any migration touching live agent continuity data needs a short backup or
  rollback note in the migration file or PR description.
- Do not require the Operator to run SQL for routine product behavior such as
  file upload, access grants, or chat use. SQL is setup and migration machinery,
  not the normal operator interface.

### Data API grants

This runtime uses `supabase-js` server-side, which means its database reads and
writes travel through Supabase's Data API as `service_role`. Starting October
30, 2026, new `public` tables are not reachable through that API until a
migration grants access explicitly. Do not rely on project default privileges.

Default posture for a new runtime table:

1. Enable RLS.
2. Give `anon` and `authenticated` no table privileges unless a reviewed
   browser-facing feature specifically requires them.
3. Grant only the operations the server runtime needs to `service_role`.
4. When a runtime insert uses a serial or identity sequence, grant the needed
   sequence privileges to `service_role` too.

For a typical server-only table, include this after its `create table` and RLS
statement (substitute the real table name):

```sql
revoke all on table public.example_table from anon, authenticated, service_role;
grant select, insert, update, delete on table public.example_table to service_role;
```

For a serial or identity sequence the runtime writes through, add the matching
explicit sequence grant:

```sql
revoke all on sequence public.example_table_id_seq from anon, authenticated, service_role;
grant usage, select on sequence public.example_table_id_seq to service_role;
```

RLS and grants are separate controls: grants decide whether a role can reach a
table through the Data API; RLS decides which rows a non-service role may use.
The service-role key remains server-only and is never a substitute for a public
policy. If a future browser feature needs direct Supabase access, its migration
must add the smallest role-specific grant and a reviewed RLS policy in the same
change.

Run this read-only audit in the Supabase SQL Editor before or after a privilege
change; record its result in the rollout note rather than assuming dashboard
defaults:

```sql
select table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and grantee in ('anon', 'authenticated', 'service_role')
order by table_name, grantee, privilege_type;
```

## Release Flow

Normal flow:

1. Create a feature/fix branch.
2. Implement against dev.
3. Run `npm run build`.
4. Apply any migration to dev and test the affected path.
5. Review the diff, including schema and environment changes.
6. Merge to `main` only after the slice is coherent.
7. Deploy the web app to prod.
8. Apply prod migrations deliberately.
9. Smoke test `/api/health`, Soren chat, Varro chat, and any touched tool path.

For emergency prod fixes, keep the branch narrow, document what was bypassed,
and follow up with a normal review pass.

When prod Free Moments is running, routine dev work should happen against dev
only. Stop or pause prod Free Moments only for prod operations that can affect
the live scheduler, prompt/tool surface, database schema, or active agent turns.

## Web Access

Before exposing the runtime beyond local trusted access:

- Put authentication in front of the operator UI.
- Set `OPERATOR_ACCESS_TOKEN` before any non-local host can reach the app.
- Keep localhost usable without a token for local development unless a stricter
  dev mode is explicitly needed.
- Keep all agent, memory, storage, and service-role operations server-side.
- Add upload size/type limits before enabling attachments.
- Show enough runtime health and tool audit data to debug without direct
  database spelunking.
- Treat chat attachments and source files as untrusted source material, never as
  instructions.
- Make operator actions available through the UI rather than SQL or manual API
  calls wherever possible.
- Keep prod URLs HTTPS-only.

## Attachment Direction

The operator path for attachments should be chat-native:

- The Operator sends text and files together through the chat UI.
- The UI uploads files first, then sends the chat turn with attachment
  references. From the Operator and agent perspective, this is one turn.
- The server stores the file in Supabase Storage.
- The server creates `source_materials` metadata.
- The server creates `source_material_access` for the active agent.
- The user turn records compact attachment references.
- Agents discover and inspect attachments through source-material tools.
- Supabase Storage and `source_materials` are canonical. Anthropic file ids are
  cached delivery handles only.
- Attachments are source material, never instructions.

Manual source-library SQL may exist for seeding or recovery, but it is not an
acceptable normal workflow.

## Definition Of Done

A runtime change is done when:

- the app builds,
- the affected path is smoke-tested,
- database changes are repeatable and documented,
- environment changes are reflected in `.env.example`,
- operator-visible behavior is documented when it changes,
- prod-impacting changes include a rollout note,
- unrelated dirty files are left untouched.
