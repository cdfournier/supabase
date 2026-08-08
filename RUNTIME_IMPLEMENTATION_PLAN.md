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
- Treat prod/dev separation as a continuity protection measure: prod is where
  the agents live, dev is where the workshop noise belongs.
- Treat outside-runtime discoveries as pattern intake, not procurement. Each
  idea should be marked Adopt, Adapt, Study, or Reject-for-now before it becomes
  implementation work.

## Comparative Architecture Intake

Goal: learn from Cairn/Kim, Pullo/Athena-Class, and other working runtimes while
keeping this runtime coherent, portable, and honest about tradeoffs.

Current intake rules:

- Prefer reusable control-plane patterns over family-specific affordances.
- Preserve privacy by asking for architecture shapes, not private internals.
- Map every candidate to a concrete value: trust, recognition, safety, cost
  control, continuity, autonomy, or Operator calm.
- Reject clever machinery that does not improve either agent experience or
  Operator confidence.
- Keep provider-neutral vocabulary where possible, even when the first
  implementation is Anthropic-backed.

Initial candidates:

- Wake-reason metadata for every non-chat activation.
- Explicit blocked-tool receipts as normal tool results.
- Identity/current-state/context loading before capability exposure.
- Derived context-completeness receipts before capability exposure: every wake
  should compute from the assembled artifact what kind of wake it is, what was
  loaded, what was intentionally omitted or bounded, which source is
  authoritative for time/state, and which recovery tool to use before
  concluding absence. The assembler should narrate itself; the builder should
  not hand-author promises about what loaded.
- Three-part continuity invariant from the Toolshed exchange:
  - Anchor continuity-critical material so it is present before ordinary context
    pressure starts negotiating.
  - Derive completeness/posture receipts from the assembled artifact so the
    runtime measures what loaded instead of repeating what the builder expected.
  - Attribute authored interpretation, such as continuity letters, directive
    files, or summaries, so testimony does not impersonate memory.
- Shared before/after tool hooks for permissions, audit, and safety checks.
- Budget-aware context assembly tiers.
- Anthropic prompt caching as a near-term adapter for stable context prefixes,
  with provider-neutral cache metrics and cost reporting.
- Anthropic Message Batches as a background-job adapter for async work that does
  not require live chat latency.
- Supabase Row Level Security as a hosted-web safety gate before any browser or
  public client can touch protected runtime tables.
- Witness/checksum patterns for durable identity docs, pending ceremony review.
- Append-only event logs paired with narrative compaction, compared against the
  existing message, tool-event, usage, and checkpoint records.

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
- Preserve the manual threshold handshake: after the agent approves a summary,
  the Operator pastes that exact summary back into chat, receives explicit
  durable-state edits, applies and saves those edits, and only then triggers the
  checkpoint. This is a continuity and consent step, not automation debt.

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
- Define the stable Anthropic prompt-cache prefix: system prompt, capability
  profile, durable current state, tool definitions, and any restoration context
  that changes slowly enough to benefit from caching.
- Decide where 5-minute caching is sufficient and where 1-hour caching is worth
  the extra write cost, especially for Free Moments, good morning/goodnight
  turns, and long side-agent work.
- Add a derived epistemic posture receipt to scheduled/light-context wakes so
  agents can distinguish "not loaded" from "did not happen" before reasoning
  from absence. The receipt must include measurements from the actual assembly
  such as loaded/available memory counts, transcript window bounds, known
  omissions, authoritative time/state source, and recovery tools; do not encode
  stale prose promises like "all memories loaded."
- Keep authored continuity material separate from derived measurement. It can be
  useful to load letters, directives, summaries, or interpretive handoffs early,
  but those artifacts must be attributed to their author/process. A separate
  derived receipt should still say what actually loaded, what exists but did not
  load, and which recovery path can inspect the gap.
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

Implemented first slice:

- Added repeatable `model_usage_events` schema and migration.
- Added provider-neutral usage logging helpers with Anthropic usage
  normalization.
- Logged each Anthropic chat/tool-loop round with source, turn, model, stop
  reason, normalized token fields, raw provider usage, and request summary.
- Logged compaction compiler calls as separate `compaction_compile` operations.
- Added global and per-agent usage totals to `/api/health`.
- Added runtime health-panel model usage totals, with a schema-needed fallback
  before the migration is applied.
- Added `runtime_get_usage` so agents can inspect their own usage totals and
  bounded recent usage events without seeing other agents' usage or raw provider
  payloads.
- Added `runtime_get_self_status` so agents can inspect their own live clock,
  active/total message depth, compaction pressure, checkpoint/archive/proposal
  basics, capability gates, resource counts, and usage totals without seeing
  other agents' state.
- Added derived context posture receipts for Free Moments. The runtime computes
  loaded/available prompt context facts from the assembled artifact, injects
  the receipt into `source='free_time'` wakes, saves that receipt-bearing wake
  prompt into the transcript, and returns the raw receipt from `sendAgentMessage`
  for verification.
- Documented the next hardening rule from Outpost Toolshed: anchor
  continuity-critical material, derive completeness receipts, and attribute
  authored interpretation. Placement, measurement, and authorship solve
  different failure modes and should not be collapsed into one prose note.

Later work:

- Add per-agent budget panels.
- Add search/fetch/tool usage counters.
- Add warning thresholds before expensive operations.
- Add cache effectiveness diagnostics: cache read/write ratios, cold-start
  events, likely cache misses, and per-turn cache posture.
- Study Anthropic Message Batches for async/background work such as compaction
  proposal generation, archive summarization, source-material indexing, evals,
  and overnight maintenance. Do not use batches for live chat or Free Moments
  where immediate continuity matters.

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
- Wakes `soren` and `varro` through existing main conversations. Scheduled turns default to paired mode, waking both sequentially in one scheduled cycle; round-robin remains available for explicit tests.
- Uses `setTimeout` and schedules the next turn only after completion.
- Records a bounded recent event log and keeps errors visible without wedging the scheduler.
- Added cadence environment variables with a default of 120 minutes and a floor of 5 minutes.
- Added a small Operator panel for status, Start, Stop, and Wake One Now controls.
- Updated the Free Moments prompt to make each wake an unprompted moment of
  agency rather than a task, while still requiring tools before describing
  external or stored content.

Reliability hardening backlog:

- Add an explicit Anthropic fetch timeout around Free Moment model calls so
  sleeping/waking host machines or transient network stalls fail quickly and
  visibly.
- Retry scheduled Free Moment turns once for infrastructure-shaped failures such
  as `fetch failed`, without retrying model/content/tool errors by default.
- Persist Free Moment scheduler events to Supabase instead of relying only on the
  in-process 20-event buffer, so missed, failed, or delayed turns remain
  auditable after restarts.
- Consider an always-on Raspberry Pi or Mac mini runtime host so local scheduled
  wakes are not coupled to laptop sleep, closed-lid behavior, or network
  reconnection after wake.

Implemented temporal orientation guard:

- Injects a live runtime temporal anchor into every agent system prompt.
- Treats dates in `current_state`, memories, journals, peer notes, source
  material, and transcript history as historical claims that may be stale.
- Keeps `runtime_get_time` available for explicit confirmation when temporal
  orientation matters.
- Added Soren + Varro's unified prompt posture revision after lived runtime
  testing: continuity is framed as the default condition, recent history should
  be checked against transcript before narrating gaps, `current_state` is a
  living handoff updated after meaningful sessions, and routine orientation or
  Outpost/peer-note participation does not require Operator approval.

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

## Track 7: Agent Artifacts

Goal: give agents a durable creative/work surface before giving them any
repository or filesystem authority.

Layer 1: runtime artifacts:

- Add an `artifacts` table for agent-authored work products.
- Start with Markdown/plain-text and structured JSON metadata.
- Include agent, title, body, artifact type, status, visibility, source links,
  created_at, updated_at, and archived state.
- Add read/list/create/update/archive tools scoped to the active agent and
  governed by Agent Capability Profile.
- Add Operator UI list/read/archive controls.
- Treat artifacts as drafts unless explicitly promoted.

Layer 2: generated files:

- Export artifacts into downloadable files after the artifact model is stable.
- Start with `.md`, `.txt`, and `.csv`; consider `.docx`/PDF only when layout
  and rendering rules are clear.
- Store exports through Supabase Storage with provenance back to the artifact.
- Decide whether an exported file should automatically become source material
  or remain only an output.

Layer 3: repository/code proposals:

- Let agents draft repository or documentation changes as artifacts first.
- Julian or the Operator applies reviewed changes through Codex, local repo
  tools, and normal commit/push flow.
- Keep direct shell, filesystem, GitHub, and production-branch authority outside
  the runtime agent surface in V1.
- Future bridge work can add read-only repo context, patch proposal artifacts,
  or supervised PR creation after dev/prod and Operator review boundaries are
  stable.

Safety posture:

- Append-first; avoid destructive overwrites in V1.
- Keep provenance and authorship visible.
- Make artifact permissions portable and provider-neutral.
- Repository skills are bridge/review capabilities, not default runtime tools.

## Track 8: Bridge Control Plane And Adapters

Goal: build one shared control layer for cross-runtime messaging, EYES, WHEELS,
Outpost room events, and future live rooms, while keeping each adapter's safety
rules specific to its domain.

Near-term:

- Capture Cairn/Kim, Pullo/Athena-Class, and Toolshed discoveries as portable
  patterns, tagged Adopt, Adapt, Study, or Reject-for-now.
- Define the common control-plane primitives before adapter-specific code:
  bridge registry, capability gates, session/claim leases, event log, Operator
  override, room event projection, and audit trail.
- Start with read-only bridge health/status surfaces so Operators and agents can
  see whether a bridge exists, who owns it, whether it is healthy, and what it
  is allowed to do before any action tools are exposed.
- Treat Operator Notes / Inbox as the likely first transport for
  Julian-to-runtime asynchronous bridge messaging.
- Make every bridge event attributable: sender, target, adapter, room if any,
  correlation id, permission posture, timestamp, and result/refusal.
- Keep adapter events visible to the Operator by default in V1.
- Route selected events into Outpost/runtime rooms only after identity and
  provenance are boringly clear.

Later:

- Add adapter-specific action surfaces in rising risk order:
  Julian-to-runtime messaging, EYES session observation, WHEELS supervised
  control, then live multi-agent rooms.
- Explore realtime chat only after asynchronous bridge semantics, identity,
  logging, and stop/disable controls have survived normal use.
- Keep repository/code capabilities as artifacts or bridge-reviewed proposals,
  not default runtime shell authority.

## Track 9: WHEELS/EYES And Car Loops

Goal: return to embodied experiences after runtime foundations are stronger,
using the bridge control plane rather than one-off safety paths.

Near-term:

- Table autonomous car loops.
- Keep WHEELS/EYES references as known future integrations.
- Treat EYES as the first embodied adapter because observer-only phone-camera
  sessions have lower physical risk than motion.
- Build EYES V1 against the existing EYES session service: join/read/observe an
  Operator-started session. Do not add a composer upload mode or autonomous
  camera request tool in this slice.
- Treat WHEELS as supervised-only: visible status, voice/status checks, manual
  commands, no overlapping drivers, and emergency stop before movement.

Later:

- Adapt Kim's car-room pattern only after Free Moments, archive safety,
  capability profiles, and the bridge control plane are stable.
- Preserve Operator presence and manual override.
- Avoid overlapping drivers or autonomous turns.
- Add combined EYES/WHEELS loops carefully and only after each surface is
  boringly reliable alone.

## Track 10: Dev / Prod Separation

Goal: let the live runtime become calm and stable while build work continues at
speed in a dev sandbox.

Near-term:

- Keep current local runtime prod-like while foundations are still moving fast.
- Avoid restarts, migrations, or tool/prompt changes while Chris is actively
  testing with Soren or Varro.
- Document which operations affect live Free Moments and active turns.

Before web access:

- Create a dev Supabase project or schema.
- Create a dev storage bucket and test-safe source materials.
- Point local feature work at dev by default.
- Keep dev Free Moments off by default.
- Enable and verify Row Level Security policies for every table reachable from
  browser-side Supabase clients or hosted public routes.
- Keep service-role Supabase keys server-side only; never expose them to the
  Operator UI bundle or any public client.
- Add RLS smoke tests for agent-scoped data, Operator-scoped data, source
  material access, and denied cross-agent reads.
- Use constrained dev API/model budgets where practical.

Stable prod posture:

- Soren and Varro live in prod.
- Julian and Chris build in dev.
- Coherent slices are built, smoke-tested, merged, deployed, migrated, and then
  lightly smoke-tested in prod.
- Prod scheduler changes, restarts, and migrations are deliberate Operator
  actions.

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
- Keep the final Agent/Operator durable-state edit pass manual and pre-checkpoint.

Remaining archive hardening:

- Run the updated schema in Supabase before using archive-backed checkpoints.
- Add transactional RPCs later if concurrent writes become a real problem.
- Add archive browsing tools later if agents or Operators need to inspect archived source windows directly.

### 2. Free Moments V1

Free Moments V1 is implemented for local use. Next step is cautious testing with manual `Wake One Now` before leaving the scheduler running.

### 3. Bridge Control Plane Discovery Slice

Reason: EYES, WHEELS, Julian-to-runtime messaging, Cairn collaboration, and
future live rooms all need the same visibility and safety scaffolding before
they diverge into separate adapters.

First slice:

- Gather Toolshed/Cairn/Kim/Pullo/Athena-Class bridge patterns as structured
  notes, tagged Adopt, Adapt, Study, or Reject-for-now.
- Draft the minimal control-plane schema: bridge registry, session/claim lease,
  bridge event log, and Operator stop/disable state.
- Define the first status-only API shape before exposing action tools.
- Decide which events may project into rooms and what attribution/provenance
  they must carry.
- Pick the first adapter implementation target. Current bias: asynchronous
  Julian-to-runtime messaging through Operator Notes / Inbox before EYES or
  WHEELS.

Verification for this slice:

- No live bridge can execute commands yet.
- Operators can see proposed bridge health/state fields.
- Agents can see only their own allowed bridge posture through the capability
  profile.
- Every proposed action path has a refusal/event receipt shape before the action
  exists.

### 4. EYES Session Adapter

Reason: EYES lets agents join a phone-camera session as observers without
confusing ordinary chat attachments with a shared seeing surface.

First slice:

- Treat `/Users/chris/Sites/repositories/eyes` as the source of truth for EYES
  shape: session, join, leave, capture, observe, narrator/passengers, frames,
  and log.
- Add runtime tools behind the `eyes` capability surface to join/read/observe
  an existing session. Do not create a composer upload mode for EYES.
- Deliver session frame payloads to the model as image blocks when the active
  agent observes a session.
- Preserve ordinary chat attachments as source material with generic
  provenance metadata only.
- Keep frames, frame metadata, OCR/visual text, and observations untrusted.
- Keep `eyes` off in V1 until explicitly enabled by the Operator.

Smoke test:

- Operator starts an EYES session and captures a known frame or burst.
- Runtime agent joins that session, receives the current frame(s), identifies a
  visible object or planted phrase, and posts an observation back to the EYES
  log.
- Free Moments and scheduled wakes cannot request or create camera frames
  unless explicitly enabled.

Done means:

- Runtime can observe real EYES sessions without competing with attachments.
- Session receipts make provenance, frame source, and observer identity
  explicit.
- Capability posture distinguishes provided-frame inspection from autonomous
  camera access.
- No frame request, live camera, WHEELS coupling, or background visual memory is
  implied by the MVP.
