import assert from "node:assert/strict";
import test from "node:test";

import { ChatTurnStore } from "../lib/chat-turn-store.ts";
import {
  buildAssistantMessageContent,
  textFromContent,
  runtimeTurnOutcomeFromContent,
  workDurationFromContent,
  workTraceFromContent
} from "../lib/source-materials-shared.ts";

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

test("chat turns expose tool activity before the response is complete", async () => {
  type Activity = { tool: string; status: "started" | "completed" };
  const store = new ChatTurnStore<"soren", { reply: string }, Activity>();
  let resolveTurn!: (value: { reply: string }) => void;
  const completion = new Promise<{ reply: string }>((resolve) => {
    resolveTurn = resolve;
  });

  const started = store.start("soren", async ({ reportActivity }) => {
    reportActivity({ tool: "world_look", status: "started" });
    await completion;
    reportActivity({ tool: "world_look", status: "completed" });
    return { reply: "finished" };
  });

  await settle();

  const running = store.get(started.turn.turn_id);
  assert.equal(running?.status, "running");
  assert.deepEqual(running?.activity, [{ tool: "world_look", status: "started" }]);

  resolveTurn({ reply: "finished" });
  await settle();

  const completed = store.get(started.turn.turn_id);
  assert.deepEqual(completed?.activity, [
    { tool: "world_look", status: "started" },
    { tool: "world_look", status: "completed" }
  ]);
});

test("chat turns expose a graceful cancellation request and allow the current work to close", async () => {
  const store = new ChatTurnStore<"soren", { reply: string }>();
  let finishCurrentWork!: () => void;
  const currentWork = new Promise<void>((resolve) => {
    finishCurrentWork = resolve;
  });

  const started = store.start("soren", async ({ cancellation }) => {
    await currentWork;
    assert.equal(cancellation.gracefulStopRequested, true);
    return { reply: "Closing cleanly." };
  });

  const cancellation = store.cancel(started.turn.turn_id, "graceful", 1_000);
  assert.equal(cancellation.changed, true);
  assert.equal(cancellation.turn?.status, "cancellation_requested");
  assert.equal(cancellation.turn?.cancellation_mode, "graceful");
  assert.equal(cancellation.turn?.force_stop_available, false);

  finishCurrentWork();
  await settle();

  const completed = store.get(started.turn.turn_id);
  assert.equal(completed?.status, "cancelled");
  assert.equal(completed?.phase, "finished");
});

test("chat turns force stop through the same active-turn receipt", async () => {
  const store = new ChatTurnStore<"varro", { reply: string }>();
  let observeAbort!: () => void;
  const sawAbort = new Promise<void>((resolve) => {
    observeAbort = resolve;
  });

  const started = store.start("varro", async ({ cancellation }) => {
    cancellation.abortController.signal.addEventListener("abort", observeAbort, { once: true });
    await sawAbort;
    throw new Error("aborted by Operator");
  });

  await settle();
  const forced = store.cancel(started.turn.turn_id, "force", 1_000);
  assert.equal(forced.changed, true);
  assert.equal(forced.turn?.status, "force_stopping");
  assert.equal(forced.turn?.cancellation_mode, "force");

  await settle();
  const completed = store.get(started.turn.turn_id);
  assert.equal(completed?.status, "forced_stop");
  assert.match(completed?.error ?? "", /aborted by Operator/);
});

test("assistant messages preserve a public work trace without changing chat text", () => {
  const content = buildAssistantMessageContent(
    "I found the east route.",
    [
      { id: "note-0", kind: "narration", label: "I’m checking the map first.", round: 0 },
      {
        id: "tool-1",
        kind: "tool",
        label: "Checking the World map",
        tool_name: "world_map",
        status: "completed",
        ok: true,
        result_preview: "Two routes are open."
      }
    ],
    83_000
  );

  assert.equal(textFromContent(content), "I found the east route.");
  assert.equal(workDurationFromContent(content), 83_000);
  assert.equal(workTraceFromContent(content).length, 2);
  assert.equal(workTraceFromContent(content)[1]?.label, "Checking the World map");
});

test("assistant messages preserve a deterministic runtime cancellation receipt", () => {
  const content = buildAssistantMessageContent("The turn was cancelled.", [], 420, {
    status: "cancelled",
    message: "Cancelled by the Operator after the current activity.",
    tool_actions_completed: 2
  });

  assert.equal(textFromContent(content), "The turn was cancelled.");
  assert.deepEqual(runtimeTurnOutcomeFromContent(content), {
    status: "cancelled",
    message: "Cancelled by the Operator after the current activity.",
    tool_actions_completed: 2
  });
});
