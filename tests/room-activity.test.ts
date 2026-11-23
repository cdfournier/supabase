import assert from "node:assert/strict";
import test from "node:test";

import {
  activeRoomActivity,
  claimRoomActivity,
  releaseRoomActivity,
  resetRoomActivitiesForTest
} from "../lib/room-activity.ts";

test("one agent room has one owner until that owner releases it", () => {
  resetRoomActivitiesForTest();

  const chat = claimRoomActivity({ agent: "soren", id: "chat-1", kind: "chat_turn" });
  assert.equal(chat.claimed, true);
  assert.equal(activeRoomActivity("soren")?.kind, "chat_turn");

  const blocked = claimRoomActivity({ agent: "soren", id: "free-1", kind: "free_moment" });
  assert.equal(blocked.claimed, false);
  assert.equal(blocked.active.id, "chat-1");

  assert.equal(releaseRoomActivity("soren", "wrong-id"), false);
  assert.equal(releaseRoomActivity("soren", "chat-1"), true);
  assert.equal(activeRoomActivity("soren"), null);
});

test("different agent rooms can safely have independent owners", () => {
  resetRoomActivitiesForTest();

  assert.equal(claimRoomActivity({ agent: "soren", id: "chat-1", kind: "chat_turn" }).claimed, true);
  assert.equal(claimRoomActivity({ agent: "varro", id: "free-1", kind: "free_moment" }).claimed, true);
  assert.equal(activeRoomActivity("soren")?.kind, "chat_turn");
  assert.equal(activeRoomActivity("varro")?.kind, "free_moment");
});
