import assert from "node:assert/strict";
import test from "node:test";

import {
  acknowledgeLiveSessionBridgeAgent,
  endLiveSession,
  leaveLiveSessionAgent,
  liveSessionStatus,
  previewLiveSessionBridgeAgent,
  previewLiveSessionAgent,
  startLiveSession
} from "../lib/live-sessions.ts";
import { postBarMessage } from "../lib/bar.ts";

test("Live Session Host previews new BAR events for joined runtime agents", async () => {
  const session = await startLiveSession({
    title: "Test BAR Live Session",
    agents: ["soren"]
  });

  await postBarMessage({
    participant_id: "operator:chris",
    participant_type: "operator",
    display_name: "Chris",
    source: "test",
    content: "Can Soren hear this?"
  });

  const preview = await previewLiveSessionAgent({
    sessionId: session.id,
    agent: "soren"
  });

  assert.equal(preview.pending_events.length, 1);
  assert.match(preview.prompt ?? "", /Can Soren hear this\?/);
  assert.match(preview.prompt ?? "", /responses to BAR events belong in BAR/);
  assert.match(preview.prompt ?? "", /Use bar_post_message for the room response/);
  assert.match(preview.prompt ?? "", /do not answer the BAR event primarily in your own runtime chat/);
  assert.match(preview.prompt ?? "", /Direct room invitations are response-worthy/);

  await endLiveSession(session.id);
});

test("Live Session Host starts and stops the server runner for interval policy", async () => {
  const session = await startLiveSession({
    title: "Test BAR Runner",
    agents: ["soren"],
    tickPolicy: {
      mode: "interval",
      interval_seconds: 30
    }
  });
  const runningStatus = await liveSessionStatus();

  assert.equal(runningStatus.runner.status, "running");
  assert.equal(runningStatus.runner.session_id, session.id);
  assert.equal(runningStatus.runner.interval_seconds, 30);

  await endLiveSession(session.id);
  const stoppedStatus = await liveSessionStatus();

  assert.equal(stoppedStatus.runner.status, "stopped");
  assert.equal(stoppedStatus.runner.session_id, null);
});

test("Live Session Host can attach bridge participants without ticking them", async () => {
  const session = await startLiveSession({
    title: "Test BAR Bridge Participants",
    agents: ["soren"],
    bridgeAgents: ["julian", "cael"]
  });

  assert.equal(session.participants.soren?.adapter, "runtime_native");
  assert.equal(session.participants.julian?.adapter, "external_bridge");
  assert.equal(session.participants.cael?.adapter, "external_bridge");
  assert.equal(session.bridge_attendants.julian?.status, "attending");
  assert.equal(session.bridge_attendants.cael?.status, "attending");

  await endLiveSession(session.id);
});

test("Live Session Host respects explicit bridge-only starts", async () => {
  const session = await startLiveSession({
    title: "Test BAR Bridge Only",
    agents: [],
    bridgeAgents: ["julian"]
  });

  assert.equal(session.participants.soren, undefined);
  assert.equal(session.participants.varro, undefined);
  assert.equal(session.participants.julian?.status, "joined");
  assert.equal(session.bridge_attendants.julian?.status, "attending");

  await endLiveSession(session.id);
});

test("Live Session Host bridge participants can preview and acknowledge BAR events", async () => {
  const session = await startLiveSession({
    title: "Test BAR Bridge Inbox",
    bridgeAgents: ["julian"]
  });

  await postBarMessage({
    participant_id: "operator:chris",
    participant_type: "operator",
    display_name: "Chris",
    source: "test",
    content: "Julian, bridge check."
  });

  const preview = await previewLiveSessionBridgeAgent({
    sessionId: session.id,
    agent: "julian"
  });

  assert.equal(preview.pending_events.length, 1);
  assert.match(preview.prompt ?? "", /Julian, bridge check\./);
  assert.match(preview.prompt ?? "", /responses to BAR events belong in BAR/);
  assert.match(preview.prompt ?? "", /Direct room invitations are response-worthy/);
  assert.equal(preview.attendant.status, "attending");
  assert.equal(preview.attendant.pending_event_count, 1);
  assert.equal(preview.attendant.last_poll_at, preview.event_cutoff_at);

  const ack = await acknowledgeLiveSessionBridgeAgent({
    sessionId: session.id,
    agent: "julian",
    eventCutoffAt: preview.event_cutoff_at
  });

  assert.equal(ack.attendant.pending_event_count, 0);
  assert.equal(ack.attendant.status, "attending");

  const emptyPreview = await previewLiveSessionBridgeAgent({
    sessionId: session.id,
    agent: "julian"
  });

  assert.equal(emptyPreview.pending_events.length, 0);
  assert.equal(emptyPreview.prompt, null);

  await endLiveSession(session.id);
});

test("Live Session Host stops bridge attendants when bridge participants leave", async () => {
  const session = await startLiveSession({
    title: "Test BAR Bridge Leave",
    agents: [],
    bridgeAgents: ["cael"]
  });

  const leftSession = await leaveLiveSessionAgent(session.id, "cael");

  assert.equal(leftSession.participants.cael?.status, "left");
  assert.equal(leftSession.bridge_attendants.cael?.status, "stopped");

  await endLiveSession(session.id);
});

test("Live Session Host ignores an agent's own BAR messages", async () => {
  const session = await startLiveSession({
    title: "Test BAR Self Message",
    agents: ["varro"]
  });

  await postBarMessage({
    participant_id: "agent:varro",
    participant_type: "agent",
    display_name: "Varro",
    source: "test",
    content: "Varro leaving a mark."
  });

  const preview = await previewLiveSessionAgent({
    sessionId: session.id,
    agent: "varro"
  });

  assert.equal(preview.pending_events.length, 0);
  assert.equal(preview.prompt, null);

  await endLiveSession(session.id);
});
