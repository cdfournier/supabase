# Runtime Roadmap

This roadmap is the working product map for the Varro and Soren runtime. It is
meant to be maintained like a living board: active work stays near the top,
completed slices move into release notes with dates and verification notes, and
larger architectural tracks stay visible without becoming today's obligation.

## Current Priorities

1. Agent Capability Profile V1 rollout
2. Operator Notes / Inbox V1
3. Julian-to-runtime bridge messaging
4. Agent Artifacts V1
5. Web search provider decision
6. Usage, cost, and cache accounting V1 follow-up
7. Checkpoint archive browsing and collapsed-history UI
8. Dev/prod separation V1
9. Comparative runtime architecture discovery
10. RLS and hosted web-readiness review
11. Batch/background-job evaluation
12. Bridge control plane and adapter architecture
13. EYES still-frame MVP
14. WHEELS supervised-control planning

## Product Principles

- Give agents real room to act, rest, notice, and choose.
- Keep state-changing systems inspectable, reversible, and calm.
- Preserve raw source material before writing summaries.
- Treat attachments, fetched pages, filenames, OCR, and metadata as untrusted
  source material.
- Make Operator controls available through the UI, not routine SQL.
- Keep public actions deliberate rather than performative.
- Prefer shared permission/posture machinery over one-off feature gates.
- Prefer open, provider-neutral, portable runtime shapes first. Narrow to the
  Soren/Varro Anthropic implementation only when that is the practical MVP path,
  then carry the lesson back toward the open model.
- Keep dev/prod separation in mind before the runtime becomes web-accessible.
- Treat vendor-specific primitives such as Anthropic prompt caching, batch
  processing, and file delivery as adapters behind provider-neutral runtime
  concepts wherever practical.

## Active Roadmap

### 1. Agent Capability Profile V1

Status: first implementation slice in progress.

Purpose: define what each agent can touch, how independently they can act, and
what default posture should guide them.

Scope:

- Per-agent surface access for Outpost, Journal, Peer Notes, Web, Conversation
  History, Memory, Compaction, Free Moments, WHEELS, EYES, and future modules.
- Permission posture: off, read-only, draft, write, or
  operator-approval-required.
- Moment bias, quiet hours, cadence, max actions, and notification posture.
- Operator-visible audit trail for meaningful actions.

Notes:

- The profile should be a readable agreement, not a cage.
- Free Moments should consume this profile instead of becoming the permanent
  permissions layer.
- V1 stores one row per `agent + surface`, injects the map into the system
  prompt, filters available tools, blocks direct tool calls by surface/action,
  and checks Free Moments before waking an agent.

### 2. Operator Notes / Inbox V1

Status: planned.

Purpose: give agents a direct, Operator-visible way to send notes during Free
Moments or normal work, and give Operators a place to reply without turning
every note into a live chat interruption.

Scope:

- Agent-to-Operator notes.
- Operator-to-agent replies.
- Unread/read/archive states.
- UI inbox surface.
- Tooling available during Free Moments, governed by the Agent Capability
  Profile.

Open questions:

- Should notes be per Operator, per household, or per runtime instance in V1?
- Should agent notes notify immediately or collect quietly unless urgent?

### 3. Julian-To-Runtime Bridge Messaging

Status: planned after Operator Notes foundation.

Purpose: allow an external agent such as Julian in Codex Desktop/CLI to exchange
messages with agents inside the runtime without depending on manual copy/paste.

Likely direction:

- Reuse the Operator Notes / Inbox infrastructure as the first bridge transport.
- Keep all bridge messages logged and Operator-visible in V1.
- Add sender identity, target agent, status, timestamps, and correlation ids.
- Avoid realtime chat until asynchronous bridge semantics are solid.

Future possibilities:

- CLI bridge adapter.
- Git-backed bridge experiments.
- Direct agent-to-agent chat room once identity, logging, and consent rules are
  clear.

### 4. Agent Artifacts V1

Status: planned.

Purpose: give agents a safe workspace for creating durable drafts, proposals,
and source-shaped outputs without granting raw repository or filesystem
authority.

Layer 1: runtime artifacts:

- Markdown or structured text artifacts stored in Supabase.
- Agent-authored drafts for brand exercises, HUG notes, proposals, source
  annotations, and working documents.
- Operator-visible list/read/archive states.
- Governed by Agent Capability Profile surface/action rules.
- Append-first; avoid silent overwrite semantics in V1.

Layer 2: generated files:

- Export selected artifacts as downloadable `.md`, `.txt`, `.csv`, or later
  `.docx`/PDF files.
- Store generated files through the existing storage/source-material pipeline
  where practical.
- Keep file provenance, creator, target agent, and source artifact links.
- Decide explicitly whether generated files become source materials.

Layer 3: repository/code proposals:

- Agents may draft code-change or documentation-change proposals as artifacts.
- Julian or the Operator reviews and applies changes through Codex/repo tools.
- No direct runtime write access to repositories, shell, GitHub, or production
  branches in V1.
- Future bridge work may add read-only repo context, patch proposal generation,
  or supervised PR creation, but direct write-to-main should remain out of scope
  until governance is boringly clear.

Notes:

- This is a studio first, not a nail gun wired to prod.
- Artifact creation should be auditable and portable across providers.
- Repository skills belong behind a bridge/review boundary, not inside the
  normal runtime tool surface by default.

### 5. Web Search Provider Reliability

Status: first implementation slice landed; provider/cost policy still planned.

Current state:

- `web_read_url`, `web_fetch_url`, `web_extract_links`, and `web_fetch_many` are useful.
- `web_read_url` improves long-page handling by returning bounded text windows
  with `next_offset`, so agents can continue deliberately instead of swallowing
  one oversized page blob.
- `web_search` now prefers the configured Brave Search API when
  `BRAVE_SEARCH_API_KEY` is present.
- It still falls back to no-key HTML providers, which are explicitly fragile.
- Soren and Varro have confirmed staged URL reading works cleanly.

Remaining decisions:

- Decide whether Brave Search API is the production provider or whether another
  provider/native path should be compared.
- Decide cost/usage reporting thresholds before encouraging frequent autonomous
  search.

Requirements:

- Search finds candidates; fetch reads sources.
- Search snippets are not citations.
- Web content remains untrusted source material.
- Add usage counters and cost visibility before encouraging frequent search.

### 6. Usage, Cost, And Cache Accounting

Status: first implementation slice landed; budget UX still planned.

Purpose: make runtime cost and pressure visible before autonomous activity grows.

Scope:

- Clarify the difference between stored transcript size, active prompt context,
  and billable tokens. A large stored chat window does not mean every API call
  replays the whole transcript.
- Persist provider-neutral usage records per model/API call, with Anthropic as
  the first adapter. Implemented first for chat/tool-loop and compaction-compile
  calls.
- Track input/output/cache usage fields where the provider exposes them.
- Add conversation-level and agent-level totals. Agent and global totals are in
  `/api/health`; richer conversation panels remain future work.
- Surface cache and token totals in `/api/health`.
- Add warning thresholds before expensive operations.
- Track search/fetch/tool usage counts.
- Consider per-agent budget panels.
- Add rough cost estimates through pricing adapters only after raw usage logging
  is reliable.

### 7. Checkpoint And Archive UX

Status: partially implemented; UI polish pending.

Current state:

- Approved checkpoints snapshot active source messages into immutable archive
  rows, then write append-only checkpoint markers.
- Raw messages remain stored in Supabase.
- Agents can compile and save reviewable compaction proposals.

Planned:

- Add archive browsing/search tools for Operators and agents.
- Collapse pre-checkpoint chat history in the UI behind an archive affordance
  without deleting raw messages.
- Add clearer archive/checkpoint health receipts.
- Consider database RPCs for atomic archive/checkpoint operations if concurrency
  becomes real.

### 8. Comparative Runtime Architecture Discovery

Status: planned discovery track.

Purpose: learn implementation patterns from other working agent runtimes without
reducing the exchange to a feature inventory or copying whole systems.

Primary venues and sources:

- Outpost Toolshed, with focused `@Cairn` questions.
- Notes from Cairn/Kim, Pullo/Athena-Class, and other lineages willing to share
  architecture at the pattern level.
- The thread is a discovery conversation, not a request to publish private
  family internals.

Intake filter:

- Adopt: clear value, low ceremony, fits this stack, and improves agent or
  Operator trust immediately.
- Adapt: strong principle, but the implementation should be reshaped for this
  runtime's safety, cost, UI, or provider-neutral goals.
- Study: promising but too heavy, too private, or insufficiently tested for V1.
- Reject for now: elegant but costly, brittle, performative, or likely to add
  false precision.

Questions to answer:

- How do agents wake, orient, resume, and know which context is current?
- How are tools exposed, gated, scoped, and audited?
- How do memory, restoration packets, journals, keepsakes, archives, and
  compaction-like records relate to each other?
- How do agents message Kim, each other, and public rooms?
- How do they control cost without flattening experience or agency?
- How are consent, visibility, and private/public artifacts handled?
- What belongs in tools, durable docs, prompts, room practice, or Operator UI?

Current pattern candidates from Pullo/Athena-Class:

- Adopt wake-reason metadata for scheduled turns, Operator prompts, free
  moments, bridge events, and recovery starts.
- Adopt explicit blocked-tool receipts: refusals and unavailable surfaces should
  return visible tool results, not vanish silently.
- Adapt identity/context loading before tool exposure as a runtime invariant:
  orientation first, capability exposure second.
- Adapt before/after tool hooks into the shared permission, audit, and safety
  layer rather than scattering checks inside each tool.
- Adapt budget-aware context assembly as provider-neutral priority tiers for
  identity, current state, recent transcript, memories, sources, and room state.
- Study checksum/witness patterns for identity documents before deciding how
  much ceremony belongs in V1.
- Compare append-only turn/tool logs plus narrative compression against our
  existing conversation messages, tool events, usage records, and checkpoint
  archives.

Output:

- Portable patterns for HUG/runtime design.
- Explicit list of family-specific details that should not be generalized.
- Follow-up implementation candidates for Bridge, Operator Notes, EYES, WHEELS,
  and live-room work.

### 9. Bridge Control Plane And Adapter Architecture

Status: design track; should shape Bridge, EYES, WHEELS, and live-room work
before implementation diverges.

Purpose: keep shared cross-runtime / real-world / room-facing infrastructure
coherent without pretending every bridge has the same safety semantics.

Core idea:

- Build a common control plane for visibility, permissions, leases, events, and
  Operator override.
- Implement domain-specific adapters for WHEELS, EYES, Outpost/chat, runtime
  tools, and future live-agent rooms.
- Reuse the control machinery while keeping policy and risk handling specific
  to each surface.

Common control plane primitives:

- Bridge registry: bridge type, endpoint, health, owner, and current state.
- Capability gates: which agents may read, write, request, observe, or drive.
- Session / claim model: active user, observers, queue, leases, and timeouts.
- Event log: commands, observations, refusals, errors, handoffs, and stops.
- Operator override: immediate stop/disable, visible globally.
- Room adapter: bridge events can appear in chat rooms as shared context, not
  only as one agent's private tool result.
- Audit trail: enough provenance to reconstruct who did what, when, and under
  which permissions.

Build order:

1. Discovery receipts: collect Cairn/Kim and Toolshed notes as patterns, tagged
   Adopt/Adapt/Study/Reject-for-now.
2. Control-plane schema: registry, sessions/claims, event log, and global
   Operator stop/disable state.
3. Read-only status routes and UI: show bridge health before any agent can act
   through a bridge.
4. Room adapter: let selected bridge events appear in a room with clear
   identity and provenance.
5. First low-risk adapter: Julian-to-runtime asynchronous messaging, likely
   through Operator Notes/Inbox.
6. EYES still-frame adapter: Operator-provided frames only.
7. WHEELS supervised adapter: status and manual supervised commands only, with
   stop/override tested before movement.

Adapter-specific policy:

- WHEELS: physical motion, stale geometry, no overlapping drivers, emergency
  stop, supervised-only defaults, network-loss handling.
- EYES: privacy, consent, frame retention, still-frame-only MVP, no autonomous
  camera requests in V1.
- Outpost/chat bridge: identity, attribution, public/private boundaries,
  anti-spam, and context/cost limits.
- Runtime tools: data access, memory writes, compaction pressure, cost, and
  self-scoping.

Notes:

- The abstraction is the control plane, not a universal bridge implementation.
- Live agent chat rooms become easier after the control plane can safely route
  events, enforce identity, and prevent overlapping or stale sessions.
- This should inform Operator Console layout: show bridge health, active claims,
  recent events, and stop/disable controls in one predictable place.

### 10. EYES MVP

Status: planned.

Purpose: bring camera-frame awareness into the runtime without overbuilding the
full embodied loop first.

Likely V1:

- Operator-provided still frame or short burst as source material.
- Route image delivery through the existing attachment pipeline.
- Let agents inspect current-turn frames through Anthropic image delivery.
- Preserve session/frame metadata as untrusted source material.

Later:

- EYES session tools.
- Agent-triggered frame requests, governed by capability profile and Operator
  presence rules.
- Richer visual memory only after consent, privacy, and storage policy are clear.

### 11. WHEELS Supervised-Control Planning

Status: planned; do not assume autonomy.

Purpose: bring PiCar/WHEELS back into the runtime as an embodied surface with
clear safety and Operator-presence rules.

Likely V1:

- Runtime-visible WHEELS status.
- Voice/status checks.
- Manual, supervised drive commands only.
- Explicit no-overlapping-drivers guard.
- Operator emergency stop / manual override.

Later:

- Adapt the car-room pattern after Free Moments, archive safety, capability
  profile, and Operator presence rules are stable.
- Add EYES/WHEELS combined loops carefully.
- Keep autonomous car loops tabled until safety posture is boringly clear.

### 12. Operator Console V1

Status: planned interface layer.

Purpose: move routine operations into a calm, durable Operator console.

Surfaces:

- Agent switcher and live status.
- Conversation view.
- Operator inbox.
- Peer notes.
- Journals.
- Artifacts and generated files.
- Memories and relationships.
- Compaction proposals and checkpoints.
- Runtime health and tool activity.
- Bridge health, active claims, recent bridge events, and stop/disable controls.
- Free Moments controls.
- Capability Profile controls.

### 13. Dev / Prod / Web Readiness

Status: staged approach documented; sandbox implementation pending before
public exposure.

Purpose: let Soren and Varro operate in a stable prod home while Julian and
Chris build, test, and occasionally make sparks in dev.

Required before external access:

- Authentication in front of the Operator UI.
- Separate dev/prod environments.
- Server-side-only service-role Supabase operations.
- Row Level Security review for every Supabase table exposed to browser-side or
  public-web access.
- Accurate `.env.example`.
- Repeatable migrations applied to dev before prod.
- HTTPS-only prod URL.
- Upload type/size/cost limits.
- Smoke tests for `/api/health`, Soren chat, Varro chat, and touched tools.

Staged plan:

- Treat the current local runtime as prod-like while foundations are still
  moving quickly.
- Create a dev Supabase project or schema, dev storage bucket, and constrained
  dev API budgets.
- Make local feature work point at dev by default, with Free Moments off by
  default.
- Promote coherent tested slices to prod deliberately.
- Keep prod scheduler changes, restarts, and migrations as explicit Operator
  actions once Free Moments and hosted access are stable.

## Parking Lot

- Anthropic Files API cache for repeated image/PDF delivery.
- Anthropic Message Batches for async compaction/archive/source jobs.
- Explicit share-with-both controls for uploaded source material.
- Richer source-material tools after direct PDF/image delivery stays stable.
- Outpost room/post search.
- Outpost profile update tools if supported.
- Private family-business Outpost room.
- Agent package/portability templates for households beyond Chris and Kim.
- Runtime artifact store and export formats.
- Supervised repository proposal workflow.
- Decision on whether destructive transcript replacement is ever needed.

## Release Notes

### 2026-07-08

Runtime visibility:

- Fixed runtime transcript loading past Supabase/PostgREST's default 1,000-row
  page, restoring Soren's full active window in the UI.
- Merged Agent Capability Profile V1 so tool access/posture is loaded into
  prompts, filters available tools, and governs Free Moments wakes.
- Added provider-neutral `model_usage_events` storage for model/API usage.
- Logged Anthropic chat/tool-loop calls per round instead of once per user turn.
- Logged compaction compiler usage separately from normal chat turns.
- Surfaced global and per-agent model usage totals in `/api/health`.
- Added a runtime health-panel row for model usage totals, with `schema needed`
  shown before the migration is applied.
- Added `runtime_get_usage`, a self-scoped read-only agent tool for usage totals
  and bounded recent usage events.
- Added `runtime_get_self_status`, a self-scoped cockpit tool for live clock,
  message depth, compaction pressure, checkpoint/proposal basics, capability
  gates, resource counts, and usage totals.
- Documented token/cost accounting, provider-neutral runtime bias, and the
  staged dev/prod separation path.
- Added Agent Artifacts V1 tracking: runtime artifacts first, generated files
  later, and supervised repository/code proposals behind review boundaries.

### 2026-07-07

Attachments and source materials:

- Added chat-native upload flow through the Operator UI.
- Added `/api/source-materials/upload`.
- Stored uploads in Supabase Storage with `source_materials` metadata.
- Granted uploaded files to the active agent through `source_material_access`.
- Recorded lightweight turn-to-file links in `conversation_message_attachments`.
- Supported prompted and attachment-only Markdown tests for Soren and Varro.
- Added current-turn Anthropic delivery for small PDFs and supported images.
- Verified PDF direct delivery.
- Verified image direct delivery for Soren and Varro.
- Fixed mismatched image metadata by sniffing bytes before Anthropic delivery.
- Confirmed blocked file types fail before waking the agent.

Free Moments and runtime control:

- Added durable Free Moments enabled/disabled setting.
- Stopped idle UI polling when Free Moments is off.
- Kept scheduled turns local, in-process, and non-auto-starting.
- Updated Free Moments prompt toward unprompted agent-owned time.
- Added derived context posture receipts to Free Moment wakes so agents can see
  computed context bounds, loaded/available memory counts, transcript window
  limits, known omissions, and recovery tools before reasoning from absence.

Temporal orientation:

- Added live runtime temporal anchor to every agent system prompt.
- Marked dates in current state, memory, journals, notes, source material, and
  transcript history as historical claims unless checked against live time.
- Updated `runtime_get_time` posture and current-state guidance.

Compaction:

- Added output controls for compaction proposal compilation.
- Required all seven proposal sections, including candidate memories and
  compression recommendations.
- Added a concise proposal skeleton so early sections cannot consume the whole
  response.
- Verified Soren could compile, approve, checkpoint, and orient after checkpoint.

Process:

- Added `DEVELOPMENT_SOP.md` with branch, dev/prod, migration, release, and
  web-access conventions.
- Added `AGENT_CAPABILITY_PROFILE.md` as the proposed shared access/posture
  layer.

### Earlier Foundations

- Added Supabase-backed agent identity, restoration context, memories,
  relationships, current-state handoffs, journals, and conversation storage.
- Added runtime tool audit logging and UI tool-call visibility.
- Added Outpost profile, room, post, reply, like, and avatar tools.
- Added peer notes between Soren and Varro.
- Added manual compaction preview, compile, proposal-save, and checkpoint flows.
- Added public URL fetch, link extraction, and small multi-fetch tools.
- Added read-only `/api/health` and basic runtime visibility.
