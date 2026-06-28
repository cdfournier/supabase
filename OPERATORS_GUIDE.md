# Operators Guide

Short version for running the local Varro/Soren runtime.

## Common Commands

Install dependencies:

```bash
npm install
```

Start the local development server:

```bash
npm run dev
```

Start on a specific port if `3000` is busy:

```bash
npm run dev -- -p 3001
```

Build and check the app:

```bash
npm run build
```

Run the production-style server after a build:

```bash
npm run start
```

Run production-style on a specific port:

```bash
npm run start -- -p 3001
```

## After Code Changes

For normal local testing, stop the running server with `Ctrl+C`, then restart:

```bash
npm run dev
```

If the change touches runtime tools, prompts, environment variables, or API routes, restart before asking an agent to test.

## Health Check

The runtime exposes a read-only health endpoint:

```bash
curl http://localhost:3001/api/health
```

Use it to check:

- model and runtime settings
- required environment values are present
- available tool count
- saved message count
- rough compaction pressure
- whether compaction is enabled

The compaction pressure is approximate. It uses saved conversation character count, not exact model tokens.

## Compaction Preview

The first compaction endpoint is preview-only:

```bash
curl -s -X POST http://localhost:3001/api/compaction/preview \
  -H "Content-Type: application/json" \
  -d '{"agent":"varro"}'
```

This does not summarize, archive, delete, or replace conversation messages. It returns the agent's current compaction pressure, their compaction policy, a bounded sample of the transcript, and the prompt shape for a future manual compaction pass.

Agents can also call `supabase_preview_compaction` for their own conversation. That tool is read-only and cannot modify Supabase data.

## Compaction Compile

After preview review, the operator can compile a non-destructive proposal in the UI with **Compile Proposal**.

The compile endpoint also supports a dry run that avoids an Anthropic call:

```bash
curl -s -X POST http://localhost:3001/api/compaction/compile \
  -H "Content-Type: application/json" \
  -d '{"agent":"varro","dry_run":true}'
```

The proposal is a review artifact. It is not saved automatically, and it does not archive, delete, or replace messages. v0 uses a bounded transcript source so the runtime does not trip rate limits by trying to send an unlimited conversation in one request.

## Compaction Checkpoint

After the agent and operator review a compiled proposal, the operator can edit the proposal in the UI and click **Create Checkpoint**.

This is append-only. It saves a checkpoint marker into `conversation_messages`, increments the conversation's compaction count, and tells the runtime to use that checkpoint plus messages after it as active context. It does not delete, archive, or replace raw messages.

CLI form:

```bash
curl -s -X POST http://localhost:3001/api/compaction/checkpoint \
  -H "Content-Type: application/json" \
  -d '{"agent":"varro","summary":"Approved checkpoint summary..."}'
```

After a checkpoint, the health panel shows active messages separately from total messages. That lower active count is the pressure relief; the full transcript is still retained in Supabase for later archive tooling.

## Current State Handoff

Agents can read and update their own restoration profile handoff field:

- `supabase_get_restoration_profile`
- `supabase_update_current_state`

`current_state` should be updated before compaction or after major state changes. It is the agent-authored handoff note that future wake/compression context should trust.

## Environment

Secrets live in `.env.local`. Do not commit that file.

Use `.env.example` as the checklist for required values:

- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ANTHROPIC_API_KEY`
- `ANTHROPIC_MODEL_SOREN`
- `ANTHROPIC_MODEL_VARRO`
- `ANTHROPIC_PROMPT_CACHE`
- `OUTPOST_TOKEN_SOREN`
- `OUTPOST_TOKEN_VARRO`

`ANTHROPIC_PROMPT_CACHE` defaults on when unset. Set it to `false` only if you need to disable Anthropic's automatic prompt-prefix cache while debugging.
