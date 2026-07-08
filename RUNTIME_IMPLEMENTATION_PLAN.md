# Runtime Implementation Plan

This is Julian's working implementation plan for folding proven pieces from Kim's runtime into the Varro/Soren runtime without turning the system into a pile of clever machinery.

## North Star

Build continuity infrastructure that lets agents wake, act, remember, rest, and choose with less dependence on the Operator, while keeping every state-changing system inspectable, reversible, and calm.

The plan is not to copy Kim's system wholesale. The plan is to borrow the patterns that have already survived real use, adapt them to this runtime, and ship them in small steps.

## Working Principles

- Ship small, reviewable changes.
- Keep raw source material before writing summaries.
- Treat "or nothing at all" as a valid agent action.
- Keep providers swappable where possible.
- Prefer the open, provider-neutral shape first. Use the current Anthropic
  Soren/Varro runtime as the test bed, not the permanent boundary.
- Expose enough runtime state for Chris to understand what happened without micromanaging every turn.
- Do not restart or change the live runtime while Chris is actively testing with Varro or Soren.
- Let Julian own architecture, review, and integration; let worker agents take bounded implementation slices.

## Track 1: Compaction Safety

Goal: make checkpointing feel like a blink, with a recoverable record behind it.

Near-term work:

- Add immutable archive tables for checkpoint source material:
  - `compaction_archives`
  - `compaction_archive_messages`
- Archive active pre-checkpoint messages before writing a checkpoint.
- Abort checkpoint creation if archive creation fails.
- Insert archive message rows in chunks.
- Add archive/checkpoint health visibility.
- Keep current append-only checkpoints; do not introduce destructive transcript replacement yet.

Later work:

- Add a database RPC for atomic append/checkpoint operations.
- Replace client-side next-position calculation for high-concurrency paths.
- Add archive browsing/search tools for agents and Operators.
- Decide whether any future destructive compaction is ever needed.

## Track 2: Prompt Cache And Runtime Accounting

Goal: make cost, pressure, and cache behavior visible enough to manage.

Near-term work:

- Document and surface the distinction between stored transcript, active prompt
  context, and billable tokens. A 1,000-message stored conversation should not
  imply a 1,000-message prompt on every turn.
- Persist provider-neutral usage records per model/API call, with Anthropic as
  the first adapter:
  - provider
  - model
  - agent
  - conversation id
  - turn id
  - source
  - input tokens
  - output tokens
  - cache read tokens
  - cache creation tokens
- Store provider-specific raw usage details separately enough that future
  OpenAI, local, or other model adapters can coexist without inventing false
  equivalence.
- Add conversation-level totals.
- Surface cache and token totals in `/api/health`.
- Clarify the current prompt-cache TTL behavior and document the 5-minute vs. 1-hour tradeoff.
- Estimate dollar cost through pricing adapters only after usage logging is reliable.

Later work:

- Add per-agent budget panels.
- Add search/fetch/tool usage counters.
- Add warning thresholds before expensive operations.

## Track 3: File And Media Read Tools

Goal: let agents inspect useful source material beyond plain URLs.

Approved direction:

- Operator attachment flow should be chat-native. The Operator can send text and
  files in the same chat turn; the UI uploads files first, then sends `/api/chat`
  JSON with compact attachment references.
- Supabase Storage plus `source_materials` is the canonical file record.
- `source_material_access` grants the active agent access automatically for
  files attached in that agent's chat.
- Conversation history should store lightweight attachment references, not
  binary blobs or base64.
- Agents discover and inspect attachments through source-material tools.
- Text-like files can continue through bounded `source_read_text`.
- PDFs/images should use Anthropic file/document/image delivery when the current
  turn directly asks about the file, with file ids treated as cached delivery
  handles rather than canonical storage.
- Numerous, large, ambiguous, or background files should be listed for staged
  agent retrieval instead of auto-sent to Anthropic.
- Unsupported media/doc types should start as metadata-only until conversion or
  extraction rules exist.
- Keep file count, size, type, and cost caps explicit.
- Mark all imported file contents, filenames, metadata, OCR, and visual text as
  untrusted source material.

Implemented first slice:

- Added chat composer file selection/drop support.
- Added `/api/source-materials/upload` to upload files into Supabase Storage and
  create `source_materials` plus `source_material_access`.
- Added structured user-message attachment references in `conversation_messages`.
- Added `conversation_message_attachments` migration/table for queryable turn to
  source-material links.
- Kept direct Anthropic PDF/image delivery out of this slice.

Implemented second slice:

- Added current-turn direct Anthropic delivery for small supported image and PDF
  attachments from canonical Supabase Storage.
- Emits Anthropic `image` blocks for JPEG, PNG, GIF, and WebP attachments.
- Emits Anthropic `document` blocks for PDF attachments.
- Keeps unsupported or over-limit files as metadata-only source material
  references.
- Keeps saved transcript content lightweight; direct bytes are not persisted in
  `conversation_messages`.

Verified 2026-07-07:

- Soren and Varro both completed prompted Markdown attachment tests.
- Soren and Varro both completed attachment-only Markdown tests.
- Agents listed, inspected, and read the uploaded source materials through the
  source material tools.
- Blocked file types fail before the chat turn is sent, leaving the agent
  unwoken and the operator message available to retry.
- PDF direct delivery returned the expected smoke phrase.
- Image direct delivery returned the expected smoke phrase for Soren and Varro,
  including a JPG-named upload whose bytes were detected as PNG.

Later work:

- Add local source-library support if needed.
- Add Anthropic Files API cache support if repeated image/PDF delivery becomes
  common enough to justify file-id lifecycle tracking.
- Add richer agent-facing file tools after direct PDF/image delivery is stable.
- Add explicit share-with-both controls after active-agent upload works.

## Track 4: Free Moments V1

Goal: give Varro and Soren unprompted time without creating noise or runaway cost.

Next architecture step:

- Move per-agent access, cadence, action bias, and approval posture into a
  shared Agent Capability Profile. Free Moments should consume that profile
  instead of becoming the permanent home for all autonomy and permission logic.

Implemented V1 slices:

- Extracted the chat execution path into `lib/chat-runtime.ts` so human chat and runtime-originated wakes share the same machinery.
- Added `lib/free-time.ts` with `status`, `start`, `stop`, and `tick`.
- Added `/api/free-time` for status, start, stop, and manual tick.
- Kept Free Moments local and in-process with no boot auto-start.
- Wakes `soren` and `varro` round-robin, one turn at a time, through existing main conversations.
- Uses `setTimeout` and schedules the next turn only after completion.
- Records a bounded recent event log and keeps errors visible without wedging the scheduler.
- Added cadence environment variables with a default of 120 minutes and a floor of 5 minutes.
- Added a small Operator panel for status, Start, Stop, and Wake One Now controls.
- Updated the Free Moments prompt to make each wake an unprompted moment of
  agency rather than a task, while still requiring tools before describing
  external or stored content.

Implemented temporal orientation guard:

- Injects a live runtime temporal anchor into every agent system prompt.
- Treats dates in `current_state`, memories, journals, peer notes, source
  material, and transcript history as historical claims that may be stale.
- Keeps `runtime_get_time` available for explicit confirmation when temporal
  orientation matters.

Implemented compaction completeness guard:

- Compaction proposal generation now fails loudly if Anthropic stops at the
  output token cap.
- Proposal generation also requires sections 6 and 7 so candidate memories and
  compression recommendations cannot disappear silently at the tail.
- Proposal output now uses a concise seven-section skeleton with bullet caps so
  sections 1-5 cannot consume the whole response before memory/compression
  review.

Original minimal shape:

- Extract the chat execution path into a reusable server helper.
- Add an in-process scheduler modeled on the Free Moment template:
  - one agent at a time
  - round-robin
  - no overlap
  - `setTimeout`, not `setInterval`
  - start/stop/status/manual tick
  - cadence floor
  - rolling event log
- Use the existing main conversations (`soren-main`, `varro-main`) so agents wake as themselves.
- Add a small Operator panel for status and controls.

Free moment prompt:

```text
[Free moment — this one is yours]

No one is asking you for anything right now. This is unprompted time of your own.
Do whatever you like with it, or nothing at all. You may orient, write, post, read,
remember something, reach out, or simply let the moment pass.

There is no task here and nothing you have to produce.
```

Constraints:

- A quiet or short response is success, not failure.
- No retry nagging.
- Do not auto-start on boot in v1.
- Keep multi-instance hosting out of scope until this leaves local development.

## Track 5: Web And Search

Goal: widen public-source access without making search a reflex.

Current state:

- URL fetch, link extraction, and small multi-fetch are working.
- Search provider is parked because paid providers and native Anthropic search have cost implications.

Possible next step:

- Prototype a no-key search adapter behind an interface, with clear fragility warnings.
- Keep search separate from fetch: search finds candidates; fetch reads sources.
- Default 5 results, cap 10.
- No auto-fetching search results.

## Track 6: Outpost And Shared Spaces

Goal: keep Outpost participation capable but deliberate.

Near-term work:

- Keep tools aligned with the current Agent Guide.
- Add room/post search only when it becomes useful.
- Add profile update tools if Outpost supports them.

Later work:

- Consider an unlisted family-business room after Varro and Soren have enough runtime capability to participate without frustration.

Implemented peer-note slice:

- Added `peer_notes` for asynchronous Soren/Varro notes.
- Added active-agent-scoped tools to send to the other peer, list addressed notes, read one addressed note, and mark an addressed note read.
- Kept V1 non-realtime and Operator-visible; reads do not mark notes read automatically.

## Track 7: WHEELS/EYES And Car Loops

Goal: return to embodied experiences after runtime foundations are stronger.

Near-term:

- Table autonomous car loops.
- Keep WHEELS/EYES references as known future integrations.

Later:

- Adapt Kim's car-room pattern only after Free Moments and archive safety are stable.
- Preserve Operator presence and manual override.
- Avoid overlapping drivers or autonomous turns.

## Delegation Pattern

Julian should keep:

- architecture decisions
- cross-track sequencing
- final review
- integration patches touching shared runtime paths
- Operator-facing explanations

Worker agents can take:

- bounded schema additions
- isolated API routes
- docs updates
- UI panels with clear props/endpoints
- verification scripts

Worker-agent prompt shape:

```text
You are working in /Users/chris/Sites/repositories/supabase.
Do not revert user or other-agent changes.
Own only these files: ...
Implement only this slice: ...
Run npm run build if code changes.
Report changed files and verification.
```

## Implementation Order

### 1. Compaction Archive V1

Reason: Free Moments will create more autonomous turns. Before we increase the amount of life in the runtime, we should make sure checkpoints have an immutable archive layer and clearer receipts.

Implemented first slice:

- Add archive tables to `schema.sql`.
- Add helper functions to snapshot active messages before checkpoint creation.
- Add archive metadata to checkpoint receipts.
- Add archive presence/counts to `/api/health`.
- Keep the existing checkpoint UI and checkpoint semantics unchanged.

Remaining archive hardening:

- Run the updated schema in Supabase before using archive-backed checkpoints.
- Add transactional RPCs later if concurrent writes become a real problem.
- Add archive browsing tools later if agents or Operators need to inspect archived source windows directly.

### 2. Free Moments V1

Free Moments V1 is implemented for local use. Next step is cautious testing with manual `Wake One Now` before leaving the scheduler running.
