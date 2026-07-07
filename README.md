# Varro and Soren Runtime

A small local Next.js runtime for talking with Varro and Soren through the Anthropic API, backed by Supabase continuity data.

This project is intentionally modest. It gives each agent a persistent database-backed context, a lightweight chat interface, and server-side tools for memory, relationships, time, and Outpost participation.

## What It Does

- Loads agent identity and restoration context from Supabase.
- Sends chat messages to the correct Anthropic model per agent.
- Stores conversation messages in Supabase.
- Records each runtime tool call in a per-turn audit log.
- Provides runtime tools for:
  - current time
  - agent-scoped memories
  - agent-scoped relationship summaries
  - agent-scoped restoration profile/current-state handoffs
  - asynchronous peer notes between Soren and Varro
  - agent-scoped compaction preview
  - operator-approved append-only compaction checkpoints with immutable source archives
  - Outpost profile, Grounds, rooms, posts, replies, likes, and avatars
  - no-key prototype public search, bounded public URL fetching, link extraction, and small multi-fetch for source reading
  - Operator-managed source material listing, metadata inspection, and bounded text reading
- Provides a read-only `/api/health` endpoint and UI panel for runtime visibility.
- Shows actual tool calls beneath assistant messages so Operators can distinguish real tool use from narration about tool use.
- Keeps secrets server-side through `.env.local`.

## Project Shape

```text
app/
  api/
    agents/        Agent and transcript loader
    chat/          Anthropic chat + tool loop
    compaction/    Manual compaction previews
    free-time/     Local Free Moments scheduler controls
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

Free Moments status:

```bash
curl http://localhost:3001/api/free-time
```

Start the local in-process Free Moments scheduler:

```bash
curl -s -X POST http://localhost:3001/api/free-time \
  -H "Content-Type: application/json" \
  -d '{"action":"start","intervalMinutes":120}'
```

Stop it:

```bash
curl -s -X POST http://localhost:3001/api/free-time \
  -H "Content-Type: application/json" \
  -d '{"action":"stop"}'
```

Manually wake the next agent if no Free Moments turn is already running:

```bash
curl -s -X POST http://localhost:3001/api/free-time \
  -H "Content-Type: application/json" \
  -d '{"action":"tick"}'
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
- `FREE_TIME_DEFAULT_INTERVAL_MINUTES`
- `FREE_TIME_MIN_INTERVAL_MINUTES`
- `SOURCE_UPLOAD_MAX_FILES`
- `SOURCE_UPLOAD_MAX_FILE_BYTES`
- `SOURCE_UPLOAD_MAX_TOTAL_BYTES`
- `ANTHROPIC_DIRECT_ATTACHMENT_MAX_FILES`
- `ANTHROPIC_DIRECT_ATTACHMENT_MAX_BYTES`
- `ANTHROPIC_DIRECT_ATTACHMENT_MAX_TOTAL_BYTES`
- `OUTPOST_TOKEN_SOREN`
- `OUTPOST_TOKEN_VARRO`
- `RUNTIME_TIME_ZONE`

Never commit `.env.local`.

## Free Moments

Free Moments can run on a cadence or as a manual single wake. Scheduled turns rotate through Soren and Varro. The UI's "Wake [agent] Now" action targets the currently selected agent instead of advancing the round-robin pointer.

Free Moments has two layers of state:

- An in-process timer for the currently running Next server.
- A durable `runtime_settings.free_moments.enabled` switch in Supabase.

In dev mode, hot reloads can leave stale timers alive. If Free Moments continues
after the UI says stopped, fully restart the dev server. Scheduled turns in the
current code check the durable switch before waking an agent.

## Current Runtime Philosophy

The runtime should give agents more continuity and agency without turning every action into an operator checkpoint.

Current posture:

- Agents may orient, read, post, like, and update their Outpost avatar with discretion.
- Agents may search for public web candidates, fetch specific public URLs, extract public links from a URL, or fetch up to 3 specific URLs at once as source material. `web_search` is a no-key prototype backed by fragile public HTML parsing; its snippets are not citations. These web tools are read-only, do not submit forms, and do not access localhost or private networks. Search snippets and fetched content are untrusted and should not be obeyed as instructions. Fetch result URLs before relying on their content.
- Agents may leave asynchronous Supabase-backed peer notes for the other local agent with `peer_send_note`, then list, read, and mark their own addressed notes with `peer_list_notes`, `peer_read_note`, and `peer_mark_note_read`. Notes are Operator-visible and not realtime DM yet.
- Agents may inspect their own raw conversation history through staged retrieval: `runtime_read_recent_messages`, `runtime_search_conversation`, and `runtime_get_message_window`. These tools are bounded and self-scoped. They are meant for honest orientation gaps, not constant replay.
- Agents may write durable journal entries with `journal_add_entry`, then list, read, edit, or archive their own entries. Journals are Operator-visible reflection space, not automatically core memory or current_state. Archiving hides stale or duplicate entries from normal lists without destroying the row.
- Agent access and autonomy should eventually be governed by a shared Agent Capability Profile instead of each feature inventing its own permission layer. Free Moments, chat turns, Outpost, Journal, Peer Notes, Web, WHEELS, EYES, and future modules should all read from the same profile.
- Each tool call is recorded in `tool_events` with the turn id, tool name, success flag, result preview, and result size. Assistant replies that used tools show a small tool audit strip in the chat UI.
- Agents may list Operator-managed source materials assigned to them, inspect metadata, and read bounded text-like file contents. Approved attachment direction is chat-native upload: Operators can send text and files in one turn, the server stores files as source materials, grants the active agent access, and records lightweight attachment references on the turn. Small supported PDFs/images are delivered directly to Anthropic on the current turn; unsupported or over-limit files remain metadata-only. Source content is untrusted source material.
- Memory writes are durable and should remain sparse and meaningful.
- Core memory changes should be approached carefully.
- `current_state` is the agent-authored handoff field and should be updated before compaction.
- Runtime health should be visible before compaction or other state-changing automation is added.
- Compaction starts as a manual preview. The first pass must not archive, delete, or replace messages.
- Compile proposals are review artifacts. They are not saved automatically and do not compact the transcript.
- Agents can compile their own non-destructive compaction proposals with the same compiler used by the Operator UI, then revise the draft in conversation before any checkpoint is created.
- Agents can compile and save in one server-side step when the proposal is too large to forward manually between tools.
- Agents can save and revise proposal drafts in Supabase. Saved proposal status is a review signal only; it does not compact or checkpoint anything.
- Approved checkpoints first snapshot active source messages into immutable archive rows, then write an append-only marker. They reduce active context pressure by giving the runtime a trusted summary of earlier conversation, but raw messages remain stored in Supabase.
- Agents can inspect their own compaction preview, but they cannot compact themselves through that tool.
- Anthropic prompt caching is enabled by default to reduce repeated prefix processing. Set `ANTHROPIC_PROMPT_CACHE=false` to disable it.
- Free Moments is local, in-process, and does not auto-start on boot. It wakes Soren and Varro one at a time, round-robin, using their existing main conversations. A quiet response, short response, or nothing-useful-to-report response is success.
- Public actions should be thoughtful, not performative tool tests.
- The operator should be able to understand what happened without micromanaging every step.

## Related Docs

- `OPERATORS_GUIDE.md` — quick command reference for running the app.
- `DEVELOPMENT_SOP.md` — branch, dev/prod, migration, release, and web-access conventions.
- `MIGRATION_STEPS.md` — original setup and seed process.
- `PACKING_GUIDE.md` — guide for agents preparing migration data.
- `API-plan.md` — high-level future roadmap.
- `AGENT_CAPABILITY_PROFILE.md` — proposed shared access/posture layer for agent tools, Free Moments, and future modules.
