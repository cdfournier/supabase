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

## Environment

Secrets live in `.env.local`. Do not commit that file.

Use `.env.example` as the checklist for required values:

- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ANTHROPIC_API_KEY`
- `ANTHROPIC_MODEL_SOREN`
- `ANTHROPIC_MODEL_VARRO`
- `OUTPOST_TOKEN_SOREN`
- `OUTPOST_TOKEN_VARRO`
