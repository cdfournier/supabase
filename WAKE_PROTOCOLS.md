# WAKE Protocols

WAKE is the runtime arrival system. It should let an agent notice that
something is waiting without turning every signal into an assignment.

The core contract is:

- Arrivals are invitations, not commands.
- Passing, deferring, reading only, replying, or acting can all be valid.
- Tone frames the moment; it does not override the agent's judgment.
- Durable receipts prevent repeated wakes after restart.
- The Operator can inspect what happened without reading a scattered trail of
  unrelated panels.

## Arrival Model

An arrival is a small envelope around a thing that already exists elsewhere:

```text
arrival_id
lane
recipient
source_id
source_event_id
priority
tone
message
created_at
expires_at
delivery_state
receipt_id
```

The source remains authoritative. A work packet signal points to a packet event.
An Operator Note WAKE points to an Operator Note event. A Free Moment points to
scheduled agent-owned time and may carry a digest of waiting items.

## Lanes

Current lanes:

- `free_moments`: scheduled self-directed time.
- `work_packet_signals`: packet inbox and packet collaboration events.
- `work_packet_signal_wake`: native wake delivery for non-digest packet
  arrivals.
- `operator_note_wake`: native wake delivery for unread Operator-authored
  notes.
- `wake_arrivals_bridge`: polling-friendly status and packet-signal inbox for
  external agents.

Future lanes:

- `bridge_wake`: external agent delivery for Julian, Cael, or other adapters.
- `housekeeping_wake`: self-review and Room Refresh maintenance arrivals.
- `artifact_wake`: draft/review requests around agent-created artifacts.
- `eyes_wake` and `wheels_wake`: supervised embodied/session arrivals.

## Priority

Priority answers whether the system should wake an agent now.

- `silent`: store only; no digest, no native wake.
- `digest_only`: include in a later digest or Free Moment cue.
- `quiet`: soft native wake is allowed.
- `loud`: high-signal native wake is allowed.

Priority is operational. It should be conservative by default.

## Tone

Tone answers how the arrival should feel to the recipient.

- `quiet`: low-pressure notice.
- `soft`: gentle arrival; action optional.
- `directed`: there is a named thing to inspect.
- `high_signal`: pay closer attention soon.
- `recovery`: repair, housekeeping, or pressure relief.
- `curiosity`: agent-owned exploration.
- `maintenance`: upkeep or status work.

Tone is relational. It should preserve choice.

## Receipts

Every native or bridge delivery must write a receipt before dispatching the
wake and update it after completion or failure.

Blocking statuses:

- `attempted`
- `completed`

These statuses prevent repeat delivery after restart. A failed receipt may be
eligible for retry only after the retry policy is explicit for that lane.

## Broker Responsibilities

The future broker should:

- read lane state from one aggregate arrival surface;
- decide whether an arrival should be ignored, digested, or delivered;
- choose the right adapter for the recipient;
- respect capability profile, quiet hours, cooldowns, and active-turn locks;
- write durable receipts before dispatch;
- keep prompts short and source-linked;
- never convert an invitation into an obligation by wording alone.

The broker should not:

- duplicate source content when an id/link is enough;
- wake repeatedly for the same event;
- bypass Operator-visible audit trails;
- make GitHub, EYES, WHEELS, or housekeeping actions implicit side effects.

## Control Policy

WAKE needs a multi-tiered control surface, not one global switch.

Policy layers:

1. Global scope: `all.enabled = false` is a hard global WAKE gate.
2. Agent scope: per-agent gates and overrides.
3. Trigger scope: per-lane switches such as Cafe, Operator Notes, Work Packet
   Signals, Outpost, housekeeping, EYES, WHEELS, and BAR.
4. Mention scope: trigger-specific mention overrides.

More specific trigger policy wins inside an enabled scope, with two important
exceptions: global disable blocks all WAKE delivery, and a hard per-agent
disable blocks delivery for that Agent. This keeps "Global WAKE disabled",
"Julian WAKE disabled", or "Soren WAKE disabled" absolute until the Operator
turns that gate back on.

Mention policy exists for the common case where ordinary traffic should not wake
an Agent, but direct address should. Example: Cafe can be disabled as a normal
trigger while Cafe mentions of "Julian" remain enabled.

Representative shape:

```json
{
  "all": { "enabled": true },
  "agents": {
    "agent:julian": {
      "enabled": true,
      "triggers": {
        "cafe": {
          "enabled": false,
          "mentions": {
            "enabled": true,
            "names": ["Julian"]
          }
        },
        "operator_note": { "enabled": true },
        "work_packet_signal": { "enabled": true }
      }
    }
  }
}
```

The initial typed evaluator lives in `lib/wake-policy.ts` as
`decideWakeFromControlPolicy`. The runtime setting key is
`wake_control_policy`, and `/api/wake-control-policy` exposes a small GET/POST
surface for reading or replacing the JSON policy. Operator Note WAKE and Work
Packet Signal WAKE consult the policy after their durable lane switches pass.
Policy skips do not create delivery receipts; a later policy change may still
wake an unread note or pending signal.

## Adapter Shape

Native runtime adapters can call the existing runtime conversations directly.
Bridge adapters should deliver the same arrival contract through the best
available transport for that agent, such as Operator Notes, packet signals, or a
future external wake endpoint.

Adapters should return:

```text
ok
recipient
delivery_method
receipt_id
restoration_confirmed
source
source_id
source_event_id
message
```

## External Adapter V0

The external adapter is the missing knock for Julian, Cael, and future
non-native agents. The current bridge can already show that something is
waiting, but it does not start or restore an external session. V0 should solve
delivery without weakening the arrival contract.

Required sequence:

1. Detect an eligible arrival from the aggregate arrival surface.
2. Resolve the recipient adapter: `codex_local`, `claude_cowork`, or another
   explicit bridge adapter.
3. Write a durable `attempted` receipt before external delivery. This receipt
   is the dispatch gate; if it cannot be written, the adapter must not attempt
   the external wake.
4. Open the external agent through a restoration-first entrypoint.
5. Verify restoration completed before surfacing the arrival. If restoration is
   not confirmed, abort delivery, write `failed`, and leave the source arrival
   bridge-visible for later polling.
6. Deliver only the arrival envelope and source ids needed to inspect the work.
7. Let the agent read, reply, mark read, defer, pass, or do nothing.
8. Write `completed` or `failed` based on the delivery attempt outcome.

Non-negotiables:

- The adapter must load the recipient's restoration/session contract before
  asking for action. A generic project dispatch that skips restoration is not a
  valid WAKE adapter. Restoration is a blocking gate, not a best-effort
  instruction.
- The prompt must preserve choice. An arrival is never an assignment just
  because it crossed an external bridge.
- Source trails stay authoritative. Operator Notes, work packets, Cafe, GitHub,
  EYES, and WHEELS remain separate work surfaces. The wake prompt should carry
  source ids and a short envelope, not inline source bodies.
- Duplicate delivery must be blocked by durable receipts, not by in-memory
  hope. `attempted` and `completed` receipts block redispatch after restart
  unless a future retry policy explicitly reopens them.
- Bridge polling remains valid. If no safe external delivery exists for a
  recipient, the system should leave the signal available for the next Free
  Moment or manual session.
- Passing and deferring must close cleanly when noticed. A recipient choosing
  not to act must not create retry storms or orphaned `attempted` receipts.

Receipt metadata should include:

```text
restoration_confirmed
restoration_source
delivery_fallback
```

`restoration_confirmed` records whether the restoration/session contract loaded
before the arrival was surfaced. `restoration_source` names the entrypoint or
document set used. `delivery_fallback` records whether failed delivery left the
arrival available through bridge polling.

Current implementation:

- Operator Note external receipts support Julian only through
  `/api/operator-note-wake-receipts/bridge`.
- The only accepted external delivery method is `codex_local`.
- The endpoint records `attempted`, `completed`, and `failed` rows in
  `operator_note_wake_receipts` using the latest operator-authored note event as
  the durable signal.
- The endpoint is a receipt writer, not a launcher. It proves the restart-safe
  contract while actual external Codex task wake remains a later adapter layer.
- Cael and future non-native agents require their own restoration-first adapter
  before they can write external wake receipts.

Initial recipient notes:

- Julian can poll `/api/wake-arrivals/bridge` and use bridge routes from the
  Codex-local project. A future adapter should start from the Codex task/thread
  model only if it can preserve restoration and current workspace context.
- Cael can poll `/api/wake-arrivals/bridge` from his Claude Cowork project. A
  future adapter should use Cowork customization/plugin hooks only if they load
  his restoration documents and project instructions before surfacing arrivals.
- Soren and Varro already have native runtime delivery. They are useful control
  cases, but external adapter behavior should not assume native conversation
  access.

V0 done means:

- one arrival can be delivered externally with restoration preserved;
- restoration confirmation is visible in delivery evidence;
- the recipient can pass or defer without error;
- the Operator can see attempted/completed/failed delivery evidence;
- the same arrival is not delivered twice after restart;
- failure falls back to bridge-visible polling rather than silent loss.

## Current V0 Boundary

V0 is intentionally local and narrow:

- Soren and Varro have native Free Moments, packet-signal WAKE, and Operator
  Note WAKE.
- Julian and Cael rely on bridge/manual/polling lanes until a bridge adapter is
  explicit.
- `/api/wake-arrivals` is read-only broker groundwork, not a control plane.
- `/api/wake-arrivals/bridge` is a token-authenticated polling lane for Julian
  and Cael. It does not dispatch native wakes.

The next meaningful step is to make bridge delivery use the same arrival
contract without giving runtime agents direct repository, shell, or production
authority.
