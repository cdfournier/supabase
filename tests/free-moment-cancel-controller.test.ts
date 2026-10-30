import assert from "node:assert/strict";
import test from "node:test";

import { FreeMomentCancelController } from "../lib/free-moment-cancel-controller.ts";

async function settle() {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

test("graceful Stop lets the current simulated tool finish, then closes without another tool", async () => {
  const cancellation = new FreeMomentCancelController();
  const events: string[] = [];
  let finishCurrentTool!: () => void;
  const currentTool = new Promise<void>((resolve) => {
    finishCurrentTool = resolve;
  });

  const simulatedFreeMoment = (async () => {
    events.push("tool:current:start");
    await currentTool;
    events.push("tool:current:complete");

    if (cancellation.gracefulStopRequested) {
      events.push("model:closing-note");
      return "cancelled";
    }

    events.push("tool:next:start");
    return "completed";
  })();

  await settle();
  assert.deepEqual(events, ["tool:current:start"]);

  const requested = cancellation.requestGracefulStop(1_000, () => {
    events.push("force-stop:available");
  });
  assert.equal(requested, true);
  assert.equal(cancellation.gracefulStopRequested, true);
  assert.equal(cancellation.abortController.signal.aborted, false);

  finishCurrentTool();
  assert.equal(await simulatedFreeMoment, "cancelled");
  assert.deepEqual(events, [
    "tool:current:start",
    "tool:current:complete",
    "model:closing-note"
  ]);
  cancellation.clear();
});

test("Force stop aborts the active request and prevents the next simulated tool", () => {
  const cancellation = new FreeMomentCancelController();
  const requested = cancellation.requestForceStop();

  assert.equal(requested, true);
  assert.equal(cancellation.forceStopRequested, true);
  assert.equal(cancellation.abortController.signal.aborted, true);

  const mayStartAnotherTool = !cancellation.abortController.signal.aborted;
  assert.equal(mayStartAnotherTool, false);
  assert.equal(cancellation.requestForceStop(), false);
});

test("Force stop becomes available only after the graceful grace period", async () => {
  const cancellation = new FreeMomentCancelController();
  let available = 0;

  cancellation.requestGracefulStop(15, () => {
    available += 1;
  });

  assert.equal(cancellation.forceStopAvailable, false);
  await new Promise<void>((resolve) => setTimeout(resolve, 30));
  assert.equal(available, 1);
  assert.equal(cancellation.forceStopAvailable, true);
  cancellation.clear();
});
