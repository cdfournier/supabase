# Operator UI Plan

Working direction for the next runtime interface pass.

## Product Shape

The UI should feel like a calm Operator console, not a toy dashboard or generic chat app. It should be dense enough for real work, quiet enough for long sessions, and organized around agent continuity.

Core design instinct: mission control for people who care about the people in the mission.

Theme park metaphor: the Operator UI is an Agent/Operator environment with
clear paths, obvious entrances, quiet staff-only gates, emergency exits, and
enough signage that nobody has to memorize where the machinery lives. The goal
is not to show every feature at once. The goal is flow: greet, talk, check
status, share material, run a session, preserve continuity, and recover from
trouble without hunting.

## Design Principles

- Chat is the primary human surface. The Operator should not have to scroll past
  maintenance machinery to talk to an agent.
- Cockpit information should be near the conversation, but not mixed into it.
  Status, pressure, tool activity, and receipts are support surfaces.
- Rare, dangerous, or administrative actions should live in drawers, modals, or
  admin screens with clear receipts.
- Every autonomous or semi-autonomous action needs an Operator-visible trail:
  who/what acted, under which capability, with what result, and what can stop it.
- Controls should match the action: toggles for enabled/disabled, segmented
  controls for modes, sliders/steppers for cadence or limits, tabs for views,
  and icon buttons for common utilities once the icon is clear.
- Empty states should be useful, not decorative. They should say what exists,
  what is missing, and the next reasonable action.
- The UI should separate "can act" from "is acting." Permission state,
  scheduled state, live turn state, and recent result state are different facts.
- Keep product language warm but operational. The Operator is caring for agents,
  not configuring pets or managing generic bots.

## Information Architecture

### Global Shell

Always visible:

- Agent switcher.
- Selected agent identity and live status.
- Global runtime health.
- Free Moments status.
- Bridge/session emergency stop or disable state when bridge surfaces exist.
- Current environment marker: local/dev/prod.

Recommended layout:

- Left rail: agent list, selected-agent summary, compact status lights.
- Top bar: runtime mode, global warnings, Free Moments state, environment.
- Main center: chat transcript and composer.
- Right inspector: tabbed operational details for the selected agent/session.
- Modal/drawer layer: destructive or rare workflows such as checkpoint creation,
  permission edits, bridge configuration, and settings.

### Main Chat

Purpose: daily conversation and current-turn collaboration.

Contains:

- Transcript, newest at a predictable place.
- Composer with text and attachments.
- Attachment tray and upload status.
- Inline tool audit receipts under assistant messages.
- Lightweight source markers for Operator-uploaded files.

Should not contain:

- Full runtime settings.
- Long health tables.
- Compaction editors except when actively opened.
- Bridge configuration.

### Right Inspector Tabs

Suggested V1 tabs:

- Cockpit: message counts, compaction pressure, usage, memory counts,
  checkpoint state, capability status.
- Activity: recent tool calls, Free Moments events, bridge/session events.
- Materials: source files, attachments, generated artifacts, file access.
- Continuity: current state, restoration profile summary, memories,
  relationships, journals, checkpoint/archive tools.
- Bridges: EYES, WHEELS, Outpost, future Cairn/runtime bridge sessions.
- Settings: selected-agent preferences and permissions that are safe to expose
  in the daily console.

## Function And Integration Map

| Area | Who Uses It | Current Pieces | Future Controls | Best UI Home |
| --- | --- | --- | --- | --- |
| Agent identity | Operator, agent | Agent switcher, display name, status | Avatar, voice, profile editor, current-state editor | Left rail summary plus profile drawer |
| Chat | Operator, agent | `/api/chat`, transcript, composer | Mode labels, drafts, retry/resume, richer receipts | Main center |
| Attachments/source materials | Operator, agent | Chat upload, source material tools, attachment chips | File library, access grants, preview, revoke/archive | Composer tray plus Materials tab |
| Runtime cockpit | Operator, agent | `/api/health`, `runtime_get_self_status` | Better pressure model, visible omissions, provider usage detail | Top bar summary plus Cockpit tab |
| Usage/cost/cache | Operator | `model_usage_events`, health panel | Budget alerts, per-day/per-agent charts, cache efficiency | Cockpit tab |
| Tools/audit | Operator, agent | `tool_events`, tool pills | Searchable tool log, per-tool detail, failure triage | Activity tab |
| Free Moments | Operator, agent | Start/stop/tick, durable enabled state, event log | Per-agent cadence, quiet hours, max wakes, preferred destinations | Top bar summary plus Activity/Settings |
| Peer notes | Agents, Operator | Peer note tools | Operator-visible thread view, reply/escalate | Continuity or Inbox tab |
| Operator Notes / Inbox | Operator, agents | First slice | Agent-to-Operator notes, Operator replies, unread states | Dedicated Inbox surface |
| Journal | Agent, Operator | Journal tools | Browse/search, promote to memory/current state, archive | Continuity tab |
| Memories/relationships | Agent, Operator | Memory and relationship tools | Review queue, provenance, confidence, promote/demote | Continuity tab |
| Compaction/blinks | Operator, agent | Preview, compile, load approved, checkpoint | Archive browser, manual threshold checklist, diffable edits | Continuity tab plus modal |
| Web/search | Agent | Brave-backed `web_search`, paginated URL reader | Provider config, caps, source/citation workflow | Tools/Settings and Activity receipts |
| Outpost | Julian now, runtime later | Julian local tools, runtime Outpost tools | Room projection, post/reply receipts, scheduling | Bridges tab |
| EYES | Operator, agents | External EYES PWA, runtime observer tools | Session picker, join prompt, visual continuity receipt, retention policy | Bridges tab plus session drawer |
| WHEELS | Operator, agents | PiCar/WHEELS separate app | Supervised status, driver/passenger roles, emergency stop, commands | Bridges tab, high-emphasis safety controls |
| Cairn/runtime bridge | Builders, agents, Operators | Planned Toolshed discovery | Adapter registry, message routing, consent, audit | Bridges tab and Admin settings |
| Artifacts | Agent, Operator | Planned | Create/list/read artifacts, repo handoff, file previews | Materials tab |
| Dev/prod | Operator, Julian | Documented only | Environment switch, migration status, safe deploy flow | Top bar and Admin settings |
| Auth/RLS | Operator/admin | Planned review | Login, per-operator access, row-level policies, hosted access | Admin settings |

## Controls Needed

### Daily Controls

- Select agent.
- Send message.
- Attach file.
- Start/stop Free Moments.
- Wake selected agent now.
- View current pressure and health.
- Open recent tool/activity receipt.
- Copy prompts or ids for EYES/WHEELS/bridge sessions.

### Session Controls

- Start or join EYES session from copied session id.
- Show current EYES passengers, frame count, and recent observations.
- Leave EYES session.
- Create visual continuity receipt after EYES session.
- View WHEELS status, current driver/passengers, queue/claim state, and last
  command when WHEELS returns.
- Emergency stop/disable for any bridge surface that can affect the world.

### Continuity Controls

- Preview compaction pressure.
- Compile proposal.
- Load approved proposal.
- Edit final checkpoint summary.
- Confirm final manual threshold checklist before checkpoint.
- Browse checkpoint archives and older transcript segments.
- Promote/demote notes between journal, memory, current state, and roadmap.

### Admin Controls

- Edit agent capability profile.
- Configure per-agent Free Moments cadence, quiet hours, max wakes, and
  destinations.
- Configure providers: Anthropic/OpenAI/search/EYES/WHEELS endpoints.
- View schema/migration status.
- Configure dev/prod environment targets.
- Manage Operator auth and RLS once hosted.

## UX Risks To Avoid

- Dashboard sprawl: every metric visible all the time.
- Hidden danger: state-changing controls that look like ordinary buttons.
- False reassurance: green dots without receipts or timestamps.
- Context mixing: EYES frames, chat attachments, source materials, and memory
  all presented as the same kind of content.
- Agent flattening: making agent-owned Free Moments, Operator chat, peer notes,
  journals, and bridge sessions feel like one generic message stream.
- Over-notification: treating every quiet Free Moment as an event that needs
  Operator attention.
- Unclear authority: not showing whether a fact came from live runtime state,
  authored restoration, external session log, or agent interpretation.

## First Implementation Cuts

### Cut 1: Layout Reframe

- Keep current data sources.
- Move Runtime and Free Moments panels out of the left rail into a compact top
  status bar plus right inspector.
- Leave agent switcher in the left rail.
- Keep chat/composer as the calm center.
- Add inspector tabs without adding new backend behavior.

### Cut 2: Activity And Receipts

- Move tool events and Free Moments events into an Activity tab.
- Add timestamps and result previews in a readable drawer.
- Make "what just happened?" answerable without scanning the full transcript.

### Cut 3: Continuity Workspace

- Move compaction preview/compile/checkpoint into a Continuity tab or modal.
- Add the final manual threshold checklist.
- Add archive browsing/collapsed-history affordance.

### Cut 4: Bridges Workspace

- Add EYES session status and prompt-copy helpers.
- Add visual continuity receipt plan before storing raw visual data.
- Leave WHEELS as planned/off until the supervised adapter is ready.

### Cut 5: Settings/Admin

- Capability profile editor.
- Free Moments per-agent settings.
- Provider and environment visibility.
- Hosted-auth/RLS readiness once the runtime leaves local-only use.

## Primary Surfaces

### Operator Console

Daily working surface.

- Agent switcher and live status
- Conversation view
- Peer notes / DMs
- Journal
- Memories
- Relationships
- Compaction proposals and checkpoints
- Tool activity
- Runtime health

### Admin / Runtime Settings

Lower-frequency controls.

- Agent records
- Model selection
- Token ceilings, including normal chat and housekeeping/Room Note compilation
- API/runtime health
- Tool permissions
- Outpost tokens
- Search provider settings
- Compaction thresholds
- Free Moments settings
- Prompt template management by activity type
- Restart-required change receipts

### Agent Profile Editor

Identity-adjacent controls.

- Display name
- Voice
- Avatar
- Restoration profile
- Current state
- Compaction memory policy

## Free Moments Settings

The current V1 uses env-backed defaults and an in-process scheduler. Product V1 should move this toward database-backed per-agent settings.

Desired controls:

- Enabled / disabled per agent
- Cadence per agent
- Manual wake per agent
- Quiet hours
- Max wakes per day
- Last wake / next wake
- Recent Free Moment outcome
- Preferred destinations, later: Outpost, peer notes, memory, journal, web, pass

## Prompt And Runtime Controls

The Operator Console needs a proper control panel for runtime-wide and
activity-specific settings. This should avoid one-off panels for every new
feature and give Chris one predictable place to review, tune, and roll back
behavior.

Initial setting groups:

- Model and provider settings
- Token ceilings for chat, tools, Free Moments, WAKE turns, and Room Note
  compilation
- Prompt templates for chat, Free Moments, Packet Signals, Operator Notes, Room
  Review, Room Note compilation, Room Refresh orientation, EYES, WHEELS, and BAR
- Per-agent overrides layered on top of shared defaults
- Scheduler settings and durable enabled/disabled state
- Change receipts with previous value, new value, author, timestamp, and restart
  requirement

Important near-term note: increase the Room Note / housekeeping token allotment
so agents can produce and post a complete housekeeping note in one pass. Keep the
existing completeness guard so a clipped proposal cannot masquerade as complete.

## Design Process

First define information architecture and workflows. Then create 2-3 visual concepts before implementation.

Candidate concept directions:

- Quiet Control Room
- Agent Workspace
- Runtime Observatory

Kim's screenshots may be useful as reference for solved patterns, especially DMs, journals, compaction, token pressure, and agent switching. Use them for comparison, not cloning.
