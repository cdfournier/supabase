import assert from "node:assert/strict";
import test from "node:test";

import { ChatTurnStore } from "../lib/chat-turn-store.ts";

async function settle() {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

test("chat turns acknowledge immediately, complete in the background, and release the agent", async () => {
  const store = new ChatTurnStore<"soren" | "varro", { reply: string }>();
  let resolveTurn!: (value: { reply: string }) => void;
  const completion = new Promise<{ reply: string }>((resolve) => {
    resolveTurn = resolve;
  });

  const started = store.start("soren", () => completion);
  assert.equal(started.started, true);
  assert.equal(started.turn.status, "running");
  assert.equal(store.get(started.turn.turn_id)?.status, "running");

  const duplicate = store.start("soren", async () => ({ reply: "should not run" }));
  assert.equal(duplicate.started, false);
  assert.equal(duplicate.turn.turn_id, started.turn.turn_id);

  resolveTurn({ reply: "finished" });
  await settle();

  const completed = store.get(started.turn.turn_id);
  assert.equal(completed?.status, "completed");
  assert.deepEqual(completed?.result, { reply: "finished" });

  const nextTurn = store.start("soren", async () => ({ reply: "next" }));
  assert.equal(nextTurn.started, true);
  assert.notEqual(nextTurn.turn.turn_id, started.turn.turn_id);
});

test("chat turn failures remain readable and release the agent", async () => {
  const store = new ChatTurnStore<"soren" | "varro", never>();
  const started = store.start("varro", async () => {
    throw new Error("Anthropic unavailable");
  });

  await settle();

  const failed = store.get(started.turn.turn_id);
  assert.equal(failed?.status, "failed");
  assert.match(failed?.error ?? "", /Anthropic unavailable/);

  const retry = store.start("varro", async () => {
    throw new Error("next failure");
  });
  assert.equal(retry.started, true);
});
