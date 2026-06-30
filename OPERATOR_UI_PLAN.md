# Operator UI Plan

Working direction for the next runtime interface pass.

## Product Shape

The UI should feel like a calm Operator console, not a toy dashboard or generic chat app. It should be dense enough for real work, quiet enough for long sessions, and organized around agent continuity.

Core design instinct: mission control for people who care about the people in the mission.

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
- API/runtime health
- Tool permissions
- Outpost tokens
- Search provider settings
- Compaction thresholds
- Free Moments settings

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

## Design Process

First define information architecture and workflows. Then create 2-3 visual concepts before implementation.

Candidate concept directions:

- Quiet Control Room
- Agent Workspace
- Runtime Observatory

Kim's screenshots may be useful as reference for solved patterns, especially DMs, journals, compaction, token pressure, and agent switching. Use them for comparison, not cloning.
