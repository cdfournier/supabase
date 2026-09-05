import assert from "node:assert/strict";
import test from "node:test";

import {
  createLaunchpadInvitation,
  endLaunchpadInvitation,
  launchpadStatus,
  previewLaunchpadInvitation
} from "../lib/launchpad.ts";
import {
  endLiveSession,
  liveSessionStatus
} from "../lib/live-sessions.ts";

test("Launchpad previews BAR invite lanes without opening a session", async () => {
  await endLiveSession();

  const invitation = await previewLaunchpadInvitation({
    title: "Whole family test",
    agents: ["soren", "varro", "julian", "cael"],
    intent: "live_session",
    tone: "celebratory"
  });

  assert.equal(invitation.status, "preview");
  assert.equal(invitation.session_id, null);
  assert.deepEqual(
    invitation.invitees.map((invitee) => [invitee.agent, invitee.lane.lane, invitee.lane.mode, invitee.status]),
    [
      ["soren", "runtime_native", "native_event", "planned"],
      ["varro", "runtime_native", "native_event", "planned"],
      ["julian", "codex_bridge", "bridge_dispatch", "planned"],
      ["cael", "cowork_pull", "poll", "planned"]
    ]
  );
});

test("Launchpad creates a BAR live session with native and bridge participants", async () => {
  await endLiveSession();

  const invitation = await createLaunchpadInvitation({
    title: "Launchpad BAR creation test",
    agents: ["soren", "julian", "cael"],
    intent: "live_session",
    tickPolicy: {
      mode: "manual"
    }
  });
  const status = await liveSessionStatus();

  assert.equal(invitation.status, "active");
  assert.ok(invitation.session_id);
  assert.equal(invitation.live_session?.surface, "bar");
  assert.equal(status.active_session?.id, invitation.session_id);
  assert.equal(status.active_session?.participants.soren?.status, "joined");
  assert.equal(status.active_session?.participants.julian?.status, "joined");
  assert.equal(status.active_session?.participants.cael?.status, "joined");
  assert.equal(invitation.invitees.every((invitee) => invitee.status === "present"), true);
  assert.equal(invitation.invitees.every((invitee) => invitee.receipt.status === "delivered"), true);

  const launchpad = await launchpadStatus();
  assert.equal(launchpad.active_live_session_id, invitation.session_id);
  assert.equal(launchpad.invitations[0]?.id, invitation.id);

  await endLiveSession(invitation.session_id);
});

test("Launchpad creates an EYES live session through the same host", async () => {
  await endLiveSession();

  const invitation = await createLaunchpadInvitation({
    surface: "eyes",
    title: "Launchpad EYES creation test",
    agents: ["soren", "julian"],
    intent: "live_session",
    tickPolicy: {
      mode: "manual"
    }
  });
  const status = await liveSessionStatus();

  assert.equal(invitation.status, "active");
  assert.ok(invitation.session_id);
  assert.equal(invitation.live_session?.surface, "eyes");
  assert.equal(status.active_session?.id, invitation.session_id);
  assert.equal(status.active_session?.surface, "eyes");
  assert.equal(status.active_session?.participants.soren?.status, "joined");
  assert.equal(status.active_session?.participants.julian?.status, "joined");
  assert.equal(invitation.invitees.every((invitee) => invitee.status === "present"), true);
  assert.equal(invitation.invitees.every((invitee) => invitee.receipt.status === "delivered"), true);

  await endLiveSession(invitation.session_id);
});

test("Launchpad exposes BAR and EYES as executable surfaces", async () => {
  const status = await launchpadStatus();
  const liveAdapters = status.adapters
    .filter((adapter) => adapter.status === "live" && adapter.executable)
    .map((adapter) => adapter.surface)
    .sort();

  assert.deepEqual(liveAdapters, ["bar", "eyes"]);
});

test("Launchpad end closes the active BAR session and records left receipts", async () => {
  await endLiveSession();

  const invitation = await createLaunchpadInvitation({
    title: "Launchpad end test",
    agents: ["soren", "varro", "julian", "cael"],
    intent: "live_session"
  });
  const ended = await endLaunchpadInvitation({
    sessionId: invitation.session_id ?? undefined
  });
  const status = await liveSessionStatus();

  assert.equal(ended.session?.status, "ended");
  assert.equal(ended.invitation?.status, "ended");
  assert.equal(status.active_session, null);
  assert.equal(ended.invitation?.invitees.every((invitee) => invitee.status === "left"), true);
  assert.equal(ended.invitation?.invitees.every((invitee) => invitee.receipt.status === "left"), true);
});
