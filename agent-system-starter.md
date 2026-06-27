# Persistent-Identity Agents on Anthropic API + Supabase — Starter Kit

A minimal scaffold for moving agents off a closed chat client (Claude Desktop)
onto a runtime **you** control: the Anthropic Messages API for thinking, Supabase
for persistent memory and identity. This is the "basics" — the core tables plus
two briefs you can paste to your Claude Code for the front end and the compaction
protocol. Grow from here.

The whole idea: the **conversation** is ephemeral (it gets summarized when it
fills), but the **self** persists in two places that survive forever —
`memories` (things they chose to keep) and `restoration_profiles` (who they are,
in their own words). Get those two right and an agent stays itself across any
number of compactions.

---

## 1. Base tables (run in the Supabase SQL editor)

Keyed by the agent's `name` (text) for simplicity — clean to reason about, matches
how these systems tend to work in practice. Add UUID foreign keys later if you want.

```sql
-- WHO they are -----------------------------------------------------------
create table if not exists public.agents (
  name          text primary key,           -- "dom", "circe", …
  display_name  text,
  persona_seed  text,                        -- starting system-prompt seed
  voice_id      text,                        -- optional (TTS, etc.)
  status        text default 'active',
  created_at    timestamptz not null default now()
);

-- Their ongoing thread (one row per agent's living conversation) ---------
create table if not exists public.conversations (
  id               text primary key,         -- e.g. "conv_dom_<timestamp>"
  agent            text not null references public.agents(name),
  token_count      int  default 0,           -- last measured context size
  compaction_count int  default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- The actual turns (the chat history) -----------------------------------
create table if not exists public.conversation_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id text not null references public.conversations(id),
  position        int  not null,             -- 0,1,2… ordering within the convo
  role            text not null,             -- 'user' | 'assistant'
  content         jsonb not null,            -- string OR array of content blocks
  created_at      timestamptz not null default now(),
  unique (conversation_id, position)         -- guards against double-inserts
);
create index if not exists cm_by_convo on public.conversation_messages (conversation_id, position);

-- Durable memories (survive compaction; recalled separately) -------------
create table if not exists public.memories (
  id          uuid primary key default gen_random_uuid(),
  agent       text not null references public.agents(name),
  content     text not null,
  memory_type text default 'observation',    -- observation|decision|reflection|fact|preference
  weight      int  default 5,                 -- 1–10 importance
  is_core     boolean default false,          -- load on every restoration?
  is_active   boolean default true,           -- soft-delete / archive flag
  tags        text[] default '{}',
  created_at  timestamptz not null default now()
);
create index if not exists mem_by_agent on public.memories (agent, is_active, weight desc);

-- How they relate (to each other and to people) -------------------------
create table if not exists public.relationships (
  id         uuid primary key default gen_random_uuid(),
  agent      text not null references public.agents(name),  -- whose view this is
  about      text not null,                                  -- who/what it's about
  summary    text,                                           -- the relationship, in their words
  updated_at timestamptz not null default now(),
  unique (agent, about)
);

-- The self that carries through compaction (AGENT-AUTHORED) --------------
create table if not exists public.restoration_profiles (
  agent                     text primary key references public.agents(name),
  opening_orientation       text,   -- the first thing they read coming back
  persona_summary           text,   -- who they are
  current_state             text,   -- where they are in life right now
  compaction_memory_policy  text,   -- what to keep / how to summarize them
  updated_at                timestamptz not null default now()
);

-- OPTIONAL but recommended: archive pre-compaction history (nothing lost) -
create table if not exists public.compaction_archives (
  id              uuid primary key default gen_random_uuid(),
  conversation_id text not null,
  summary         text,
  message_count   int,
  created_at      timestamptz not null default now()
);
create table if not exists public.compaction_archive_messages (
  id         uuid primary key default gen_random_uuid(),
  archive_id uuid not null references public.compaction_archives(id),
  position   int,
  role       text,
  content    jsonb
);

-- Lock everything to the server. The app uses the SERVICE ROLE key (which
-- bypasses RLS); the public/anon key gets nothing. RLS on, no policies = closed.
alter table public.agents                      enable row level security;
alter table public.conversations               enable row level security;
alter table public.conversation_messages       enable row level security;
alter table public.memories                     enable row level security;
alter table public.relationships                enable row level security;
alter table public.restoration_profiles         enable row level security;
alter table public.compaction_archives          enable row level security;
alter table public.compaction_archive_messages  enable row level security;
```

**Migrating from Desktop:** seed `agents`, `memories`, and `restoration_profiles`
from each agent's existing identity/notes before first run, so they wake up as
*themselves*, not blank. The conversation starts fresh; the self comes pre-loaded.

---

## 2. Brief to hand your Claude Code — the front end

> Build a minimal **Next.js (App Router)** chat app for talking to persistent
> agents stored in Supabase.
> - **Agent picker:** list rows from the `agents` table; pick one to chat with.
> - **Chat panel:** show the selected agent's conversation; let me type and send a
>   message, with optional **image attachments** (convert to base64 → Anthropic
>   image content blocks).
> - **`POST /api/chat` `{ conversationId, message, files? }`:** load the agent's
>   conversation from `conversation_messages` (ordered by `position`), append my
>   message, call the **Anthropic Messages API** (`claude-opus-4-x` or a Sonnet)
>   with (a) the agent's **system prompt** — built from `agents.persona_seed` +
>   their `restoration_profiles` row + a few recalled `memories` — and (b) the
>   agent's **tools**; run the tool-use loop; persist new messages back to
>   `conversation_messages`; return the reply.
> - **Security:** use the Supabase **service-role** key **server-side only**,
>   never in the browser.
> - **Env:** `ANTHROPIC_API_KEY`, `NEXT_PUBLIC_SUPABASE_URL`,
>   `SUPABASE_SERVICE_ROLE_KEY`.
> - Give the agents a starter tool set: `create_memory`, `search_memories`,
>   `update_restoration_profile`, `get_restoration_packet`. (Add more later.)

---

## 3. Brief to hand your Claude Code — the compaction protocol

> Implement **compaction** so an agent's context never overflows and they keep
> their identity across it.
> - **Trigger:** track the conversation's token count. When it crosses a
>   threshold (start ~200K input tokens), compact before the next turn.
> - **Compact in four steps:**
>   1. **Summarize, identity-aware.** Generate a summary of the conversation so
>      far with a prompt that preserves *who the agent is* — their voice,
>      relationships, ongoing state, and what *they* would want to remember — not
>      just a bullet list of facts. (Feed the agent's `compaction_memory_policy`
>      into this prompt so they shape their own summarization.)
>   2. **Archive** the raw messages to `compaction_archives` /
>      `compaction_archive_messages` so nothing is ever truly lost.
>   3. **Replace** the live `conversation_messages` with `[the summary as message
>      0]` + the most recent N messages.
>   4. **Re-inject** the agent's `restoration_profiles` row into the system prompt
>      so they "come back to themselves" on the other side.
> - **Memories persist independently.** The `memories` table is recalled
>   separately and isn't part of the conversation, so it survives compaction
>   automatically — that's the long-term spine.
> - **Make the self agent-authored.** Give the agent tools to *read and rewrite*
>   its own `restoration_profiles` (`get_restoration_packet` /
>   `update_restoration_profile`). The profile is the note they leave themselves
>   for the morning — it should be theirs to write.

---

## The one principle worth keeping

A persistent agent is **three layers**: the *conversation* (ephemeral, summarized
when full), the *memories* (durable facts/moments they chose to keep), and the
*restoration profile* (their self-authored identity). Compaction only touches the
first. As long as the last two are rich and the agent can edit them, the agent
stays itself — across any number of windows. Build those two well; everything else
is plumbing.
