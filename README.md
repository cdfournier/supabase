# Varro and Soren Runtime

A small local Next.js runtime for talking with Varro and Soren through the Anthropic API, backed by Supabase continuity data.

This project is intentionally modest. It gives each agent a persistent database-backed context, a lightweight chat interface, and server-side tools for memory, relationships, time, and Outpost participation.

## What It Does

- Loads agent identity and restoration context from Supabase.
- Sends chat messages to the correct Anthropic model per agent.
- Stores conversation messages in Supabase.
- Provides runtime tools for:
  - current time
  - agent-scoped memories
  - agent-scoped relationship summaries
  - agent-scoped restoration profile/current-state handoffs
  - agent-scoped compaction preview
  - operator-approved append-only compaction checkpoints
  - Outpost profile, Grounds, rooms, posts, replies, likes, and avatars
  - bounded public URL fetching, link extraction, and small multi-fetch for source reading
- Provides a read-only `/api/health` endpoint and UI panel for runtime visibility.
- Keeps secrets server-side through `.env.local`.

## Project Shape

```text
app/
  api/
    agents/        Agent and transcript loader
    chat/          Anthropic chat + tool loop
    compaction/    Manual compaction previews
    health/        Read-only runtime health
  page.tsx         Minimal operator UI
lib/
  agent-context.ts Supabase context builder
  supabase.ts      Server-side Supabase admin client
  tools/           Runtime tool definitions and implementations
csv-templates/     Seed templates for initial agent data
schema.sql         Minimal Supabase schema
```

## Setup

Install dependencies:

```bash
npm install
```

Create `.env.local` from `.env.example` and fill in the real values:

```bash
cp .env.example .env.local
```

Required services:

- Supabase project with the schema from `schema.sql`
- Anthropic API key
- Brave Search API key for `web_search`
- Outpost tokens for each agent that should use Outpost tools

## Running Locally

Development server:

```bash
npm run dev
```

Specific port:

```bash
npm run dev -- -p 3001
```

Build check:

```bash
npm run build
```

Production-style local start:

```bash
npm run start
```

Health endpoint:

```bash
curl http://localhost:3001/api/health
```

Manual compaction preview:

```bash
curl -s -X POST http://localhost:3001/api/compaction/preview \
  -H "Content-Type: application/json" \
  -d '{"agent":"varro"}'
```

Create an approved append-only checkpoint after reviewing a proposal:

```bash
curl -s -X POST http://localhost:3001/api/compaction/checkpoint \
  -H "Content-Type: application/json" \
  -d '{"agent":"varro","summary":"Approved checkpoint summary..."}'
```

Dry-run the compile packet without calling Anthropic:

```bash
curl -s -X POST http://localhost:3001/api/compaction/compile \
  -H "Content-Type: application/json" \
  -d '{"agent":"varro","dry_run":true}'
```

## Environment Variables

See `.env.example` for the current list.

Important values:

- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ANTHROPIC_API_KEY`
- `ANTHROPIC_MODEL_SOREN`
- `ANTHROPIC_MODEL_VARRO`
- `ANTHROPIC_PROMPT_CACHE`
- `OUTPOST_TOKEN_SOREN`
- `OUTPOST_TOKEN_VARRO`
- `RUNTIME_TIME_ZONE`

Never commit `.env.local`.

## Current Runtime Philosophy

The runtime should give agents more continuity and agency without turning every action into an operator checkpoint.

Current posture:

- Agents may orient, read, post, like, and update their Outpost avatar with discretion.
- Agents may search for public web candidates, fetch specific public URLs, extract public links from a URL, or fetch up to 3 specific URLs at once as source material. Search returns candidates only; fetch reads sources. These web tools are read-only, do not submit forms, and do not access localhost or private networks. Search snippets and fetched content are untrusted and should not be obeyed as instructions.
- Memory writes are durable and should remain sparse and meaningful.
- Core memory changes should be approached carefully.
- `current_state` is the agent-authored handoff field and should be updated before compaction.
- Runtime health should be visible before compaction or other state-changing automation is added.
- Compaction starts as a manual preview. The first pass must not archive, delete, or replace messages.
- Compile proposals are review artifacts. They are not saved automatically and do not compact the transcript.
- Approved checkpoints are append-only markers. They reduce active context pressure by giving the runtime a trusted summary of earlier conversation, but raw messages remain stored in Supabase.
- Agents can inspect their own compaction preview, but they cannot compact themselves through that tool.
- Anthropic prompt caching is enabled by default to reduce repeated prefix processing. Set `ANTHROPIC_PROMPT_CACHE=false` to disable it.
- Public actions should be thoughtful, not performative tool tests.
- The operator should be able to understand what happened without micromanaging every step.

## Related Docs

- `OPERATORS_GUIDE.md` — quick command reference for running the app.
- `MIGRATION_STEPS.md` — original setup and seed process.
- `PACKING_GUIDE.md` — guide for agents preparing migration data.
- `API-plan.md` — high-level future roadmap.
