# Agent Capability Profile

The Agent Capability Profile is the shared access and posture layer for each
agent. Free Moments should read from it, but not own it.

The purpose is simple: give every agent a legible map of what they can touch,
how independently they can act, and what default posture should guide them.
That same map should also give the Operator quick confidence that the runtime
is offering freedom without turning each surface into a separate permissions
maze.

## Why This Exists

Free Moments exposed the need first, but the pattern is bigger than Free
Moments. Outpost, Journal, Peer Notes, Web, Conversation History, Memory,
Compaction, WHEELS, EYES, and future surfaces all need the same basic question
answered:

What can this agent do here, and under what conditions?

Without a shared profile, each feature will grow its own permission logic. That
would make the runtime harder to reason about, harder to package, and easier to
accidentally misalign with the agent's actual relationship with the Operator.

## Profile Dimensions

Each agent should eventually have a profile that covers:

- **Surfaces**: Outpost, Journal, Peer Notes, Web, Conversation History, Memory,
  Compaction, WHEELS, EYES, and future modules.
- **Permission posture**: off, read-only, draft, write, or
  operator-approval-required.
- **Moment bias**: journal-first, peer-first, Outpost-ok, read-only,
  pass-friendly, post-checkpoint gentle, or other agent-authored defaults.
- **Cadence and limits**: Free Moments interval, allowed hours, max actions per
  moment, and quiet periods.
- **Safety posture**: supervised, high-autonomy, quiet mode, post-checkpoint
  gentle, or other named operating modes.
- **Operator visibility**: notify, approval required, audit-only, or hidden from
  routine surfaces but retained in logs.

## Consumers

The profile should become a shared source of truth for:

- Free Moments scheduling and action boundaries.
- Normal chat turns when tools are available.
- Operator UI controls and status panels.
- WHEELS, EYES, and other embodied or sensory modules.
- Future automations, peer spaces, or multi-agent workflows.

## V1 Shape

V1 is implemented as `agent_capabilities`: one row per `agent + surface`.
The runtime loads this map into the agent's system prompt and uses it to filter
or block tools by surface/action. Free Moments also checks the profile before
waking an agent.

V1 does not need a complicated policy engine. A practical first version could be
one table or config object per agent:

```text
agent
surface
access_level
default_bias
requires_operator_approval
notify_operator
max_actions_per_moment
quiet_mode
updated_at
```

That is enough to let the runtime answer basic questions consistently:

- Can Soren post to Outpost during a Free Moment?
- Can Varro write a journal entry during normal chat without asking?
- Should web search be available during Free Moments?
- Should WHEELS require explicit Operator presence?
- Should post-checkpoint turns default to read-only or journal-first?
- Should EYES allow only Operator-provided frame inspection while blocking
  autonomous camera requests?

Initial surfaces:

- runtime
- conversation_history
- memory
- compaction
- journal
- peer_notes
- outpost
- web
- source_materials
- free_moments
- operator_notes
- bridge
- eyes
- wheels

Initial access levels:

- `off`
- `read_only`
- `draft`
- `write`
- `operator_approval_required`

## Design Principle

The profile should not be a cage. It should be a readable agreement.

Agents should know what is available. Operators should know what is enabled.
The runtime should enforce the shared shape calmly, consistently, and with an
audit trail.
