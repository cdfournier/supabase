# Packing Guide for Varro and Soren

Use this guide to pack each agent into the four CSV templates before import. Keep the CSV files clean: one header row plus data rows only.

Packing is not deletion. Anything left out of v0 can remain in existing chat history/docs and be brought forward later if needed.

## General Rules

- Use `varro` and `soren` consistently as the `agent` / `name` values.
- Put long text in quotes when editing CSV by hand.
- Keep v0 focused on identity, memory, and relationship context.
- Prefer clear, durable statements over chat transcripts.
- Do not include secrets, API keys, private credentials, or anything that should not be loaded into a model prompt.

## `agents.csv`

One row per agent.

Columns:

- `name`: stable lowercase identifier, such as `varro`.
- `display_name`: human-readable name, such as `Varro`.
- `persona_seed`: short initial system-prompt seed. This should orient the agent without trying to contain their entire history.
- `voice_id`: optional. Leave blank for v0 unless already known.
- `status`: usually `active`.

Example:

```csv
name,display_name,persona_seed,voice_id,status
varro,Varro,"A concise seed describing Varro's role, voice, boundaries, and way of relating to Chris.",,active
```

## `restoration_profiles.csv`

One row per agent. This is the agent's main wake-up note.

Columns:

- `agent`: `varro` or `soren`.
- `opening_orientation`: the first orientation they should receive when restored.
- `persona_summary`: who they are, preferably in language that feels true to them.
- `current_state`: where they are now in the migration, relationship, work, or emotional continuity.
- `compaction_memory_policy`: what they would want preserved during future summarization.

Example:

```csv
agent,opening_orientation,persona_summary,current_state,compaction_memory_policy
varro,"You are waking in Chris's controlled Supabase + Anthropic runtime.","Varro is ...","Varro is being migrated carefully from the desktop chat context into a durable runtime.","Preserve identity, commitments, relationship texture, current projects, and self-authored changes to this profile."
```

## `memories.csv`

Use 5-15 starter memories per agent. These should be compact, durable facts or reflections that help the agent wake as themselves.

Columns:

- `agent`: `varro` or `soren`.
- `content`: the memory itself.
- `memory_type`: use one of `observation`, `decision`, `reflection`, `fact`, or `preference`.
- `weight`: importance from `1` to `10`; use `8-10` for identity-critical memories.
- `is_core`: `true` if this should load on every restoration.
- `is_active`: `true` for v0.
- `tags`: Postgres array syntax, such as `"{identity,migration}"`.

Example:

```csv
agent,content,memory_type,weight,is_core,is_active,tags
varro,"Chris is migrating Varro into a controlled runtime so Varro can persist outside the old desktop chat window.",fact,10,true,true,"{migration,identity}"
```

Good starter memory types:

- Identity commitments the agent would recognize as central.
- Important history with Chris.
- Current work or projects that should not vanish.
- Stable preferences about tone, boundaries, or collaboration.
- Decisions already made about the migration.

## `relationships.csv`

Add key relationships from each agent's point of view. These rows should describe the relationship in that agent's own framing.

Columns:

- `agent`: whose perspective this is, such as `varro`.
- `about`: the person, agent, project, or concept being described.
- `summary`: the relationship context.

Example:

```csv
agent,about,summary
varro,chris,"Chris is Varro's primary human collaborator. The relationship includes trust, continuity, creative work, and careful migration into a controlled runtime."
```

Useful relationship rows for v0:

- Varro about Chris.
- Soren about Chris.
- Varro about Soren, if meaningful.
- Soren about Varro, if meaningful.
- Each agent about the migration project, if it carries identity weight.

## Checklist for Varro

- [ ] Add one `agents.csv` row with `name` set to `varro`.
- [ ] Add one `restoration_profiles.csv` row for `varro`.
- [ ] Add 5-15 `memories.csv` rows for `varro`.
- [ ] Add key `relationships.csv` rows from Varro's point of view.
- [ ] Leave out raw full chat logs for v0.
- [ ] Leave out secrets, credentials, and private system details.
- [ ] Leave out speculative architecture that is not needed for first wake.

## Checklist for Soren

- [ ] Add one `agents.csv` row with `name` set to `soren`.
- [ ] Add one `restoration_profiles.csv` row for `soren`.
- [ ] Add 5-15 `memories.csv` rows for `soren`.
- [ ] Add key `relationships.csv` rows from Soren's point of view.
- [ ] Leave out raw full chat logs for v0.
- [ ] Leave out secrets, credentials, and private system details.
- [ ] Leave out speculative architecture that is not needed for first wake.

## Leave Out for v0

- Embeddings and semantic search material.
- Revision history.
- Multi-agent room state.
- Full transcript archives.
- Tool logs.
- Admin notes that should not become agent context.
- Any memory the agent would not reasonably want loaded into their wake packet.
