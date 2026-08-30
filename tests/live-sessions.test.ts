import assert from "node:assert/strict";
import test from "node:test";

import {
  acknowledgeLiveSessionBridgeAgent,
  claimLiveSessionBridgeDelivery,
  completeLiveSessionBridgeDelivery,
  endLiveSession,
  leaveLiveSessionAgent,
  liveSessionStatus,
  previewLiveSessionBridgeAgent,
  previewLiveSessionAgent,
  startLiveSession,
  tickLiveSession
} from "../lib/live-sessions.ts";
import { postBarMessage } from "../lib/bar.ts";

async function nextTick() {
  await new Promise((resolve) => setTimeout(resolve, 2));
}

async function withEnv<T>(values: Record<string, string | undefined>, action: () => Promise<T>) {
  const previous = Object.fromEntries(
    Object.keys(values).map((key) => [key, process.env[key]])
  );

  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    return await action();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

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

  const endedSession = await endLiveSession(session.id);

  assert.equal(endedSession?.participants.julian?.status, "left");
  assert.equal(endedSession?.participants.cael?.status, "left");
  assert.equal(endedSession?.bridge_attendants.julian?.status, "stopped");
  assert.equal(endedSession?.bridge_attendants.cael?.status, "stopped");
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

  const endedSession = await endLiveSession(session.id);

  assert.equal(endedSession?.participants.julian?.status, "left");
  assert.equal(endedSession?.bridge_attendants.julian?.status, "stopped");
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

test("Live Session Host queues and completes bridge delivery jobs", async () => {
  await withEnv({ JULIAN_CODEX_THREAD_ID: "test-thread" }, async () => {
    const session = await startLiveSession({
      title: "Test BAR Bridge Delivery",
      agents: [],
      bridgeAgents: ["julian"]
    });
    await nextTick();

    await postBarMessage({
      participant_id: "operator:chris",
      participant_type: "operator",
      display_name: "Chris",
      source: "test",
      content: "Julian, delivery queue check."
    });

    const tick = await tickLiveSession({
      sessionId: session.id
    });
    const queued = tick.results.find((result) => result.agent === "julian");

    assert.equal(queued?.status, "queued");
    assert.equal((queued as { adapter?: string } | undefined)?.adapter, "external_bridge");
    assert.equal(queued?.pending_events, 1);

    const status = await liveSessionStatus();
    const activeSession = status.active_session;

    assert.equal(status.bridge_adapters.julian.target.status, "configured");
    assert.equal(activeSession?.bridge_deliveries.length, 1);
    assert.equal(activeSession?.bridge_deliveries[0]?.status, "pending");
    assert.equal(activeSession?.participants.julian?.last_checked_event_at, session.participants.julian?.last_checked_event_at);

    const claimed = await claimLiveSessionBridgeDelivery({
      sessionId: session.id,
      agent: "julian"
    });

    assert.equal(claimed.delivery?.status, "claimed");
    assert.equal(claimed.delivery?.pending_events[0]?.content, "Julian, delivery queue check.");
    assert.match(claimed.delivery?.prompt ?? "", /BAR Live Session delivery/);

    const completed = await completeLiveSessionBridgeDelivery({
      sessionId: session.id,
      agent: "julian",
      deliveryId: claimed.delivery?.id ?? "",
      claimId: claimed.delivery?.claim_id ?? undefined,
      outcome: "delivered"
    });

    assert.equal(completed.delivery.status, "delivered");
    assert.equal(completed.participant.last_checked_event_at, completed.delivery.event_cutoff_at);
    assert.equal(completed.attendant.pending_delivery_count, 0);

    await endLiveSession(session.id);
  });
});

test("Live Session Host surfaces Cael pull bridge work without queueing a delivery", async () => {
  const session = await startLiveSession({
    title: "Test BAR Cael Pull Bridge",
    agents: [],
    bridgeAgents: ["cael"]
  });
  const initialCursor = session.participants.cael?.last_checked_event_at ?? null;
  await nextTick();

  await postBarMessage({
    participant_id: "operator:chris",
    participant_type: "operator",
    display_name: "Chris",
    source: "test",
    content: "Cael, pull bridge queue check."
  });

  const tick = await tickLiveSession({ sessionId: session.id });
  const skipped = tick.results.find((result) => result.agent === "cael");
  const status = await liveSessionStatus();
  const activeSession = status.active_session;

  assert.equal(skipped?.status, "skipped");
  assert.equal((skipped as { reason?: string } | undefined)?.reason, "manual_pull");
  assert.equal(activeSession?.bridge_deliveries.length, 0);
  assert.equal(activeSession?.participants.cael?.last_checked_event_at, initialCursor);
  assert.equal(activeSession?.bridge_attendants.cael?.pending_event_count, 1);
  assert.equal(status.bridge_adapters.cael.target.status, "configured");
  assert.equal(status.bridge_adapters.cael.target.method, "manual");
  assert.equal(status.bridge_adapters.cael.ready, false);

  const preview = await previewLiveSessionBridgeAgent({
    sessionId: session.id,
    agent: "cael"
  });
  assert.equal(preview.pending_events.length, 1);

  const acked = await acknowledgeLiveSessionBridgeAgent({
    sessionId: session.id,
    agent: "cael",
    eventCutoffAt: preview.event_cutoff_at
  });

  assert.equal(acked.participant.last_checked_event_at, preview.event_cutoff_at);

  await endLiveSession(session.id);
});

test("Live Session Host keeps bridge cursor open when delivery fails", async () => {
  await withEnv({ JULIAN_CODEX_THREAD_ID: "thread_test" }, async () => {
    const session = await startLiveSession({
      title: "Test BAR Bridge Delivery Failure",
      agents: [],
      bridgeAgents: ["julian"]
    });
    const initialCursor = session.participants.julian?.last_checked_event_at ?? null;
    await nextTick();

    await postBarMessage({
      participant_id: "operator:chris",
      participant_type: "operator",
      display_name: "Chris",
      source: "test",
      content: "Julian, failed delivery queue check."
    });

    await tickLiveSession({ sessionId: session.id });
    const claimed = await claimLiveSessionBridgeDelivery({
      sessionId: session.id,
      agent: "julian"
    });
    const failed = await completeLiveSessionBridgeDelivery({
      sessionId: session.id,
      agent: "julian",
      deliveryId: claimed.delivery?.id ?? "",
      claimId: claimed.delivery?.claim_id ?? undefined,
      outcome: "failed",
      error: "Codex delivery unavailable."
    });

    assert.equal(failed.delivery.status, "failed");
    assert.equal(failed.participant.last_checked_event_at, initialCursor);
    assert.equal(failed.participant.last_error, "Codex delivery unavailable.");

    await endLiveSession(session.id);
  });
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
