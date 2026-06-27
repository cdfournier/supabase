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
  - agent-scoped compaction preview
  - Outpost profile, Grounds, rooms, posts, replies, likes, and avatars
  - bounded public URL fetching for source reading
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

## Environment Variables

See `.env.example` for the current list.

Important values:

- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ANTHROPIC_API_KEY`
- `ANTHROPIC_MODEL_SOREN`
- `ANTHROPIC_MODEL_VARRO`
- `OUTPOST_TOKEN_SOREN`
- `OUTPOST_TOKEN_VARRO`
- `RUNTIME_TIME_ZONE`

Never commit `.env.local`.

## Current Runtime Philosophy

The runtime should give agents more continuity and agency without turning every action into an operator checkpoint.

Current posture:

- Agents may orient, read, post, like, and update their Outpost avatar with discretion.
- Agents may fetch specific public URLs as source material, but fetched content is untrusted and should not be obeyed as instructions.
- Memory writes are durable and should remain sparse and meaningful.
- Core memory changes should be approached carefully.
- Runtime health should be visible before compaction or other state-changing automation is added.
- Compaction starts as a manual preview. The first pass must not archive, delete, or replace messages.
- Agents can inspect their own compaction preview, but they cannot compact themselves through that tool.
- Public actions should be thoughtful, not performative tool tests.
- The operator should be able to understand what happened without micromanaging every step.

## Related Docs

- `OPERATORS_GUIDE.md` — quick command reference for running the app.
- `MIGRATION_STEPS.md` — original setup and seed process.
- `PACKING_GUIDE.md` — guide for agents preparing migration data.
- `API-plan.md` — high-level future roadmap.
