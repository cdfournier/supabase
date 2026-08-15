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
source
source_id
source_event_id
message
```

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
