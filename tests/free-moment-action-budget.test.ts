import assert from "node:assert/strict";
import test from "node:test";

import {
  freeMomentActionLimit,
  freeMomentActionLimitLabel,
  wouldExceedFreeMomentActionLimit
} from "../lib/free-moment-action-budget.ts";

test("an absent action budget is explicitly uncapped", () => {
  assert.equal(freeMomentActionLimit(null), null);
  assert.equal(freeMomentActionLimit(undefined), null);
  assert.equal(freeMomentActionLimitLabel(null), "no cap");
});

test("action budgets preserve zero and normalize valid whole values", () => {
  assert.equal(freeMomentActionLimit(0), 0);
  assert.equal(freeMomentActionLimit(4.8), 4);
  assert.equal(freeMomentActionLimit(-1), null);
  assert.equal(freeMomentActionLimit(Number.NaN), null);
});

test("a bound counts requested tool actions, not elapsed time or tool rounds", () => {
  assert.equal(wouldExceedFreeMomentActionLimit(6, 0, 1), false);
  assert.equal(wouldExceedFreeMomentActionLimit(6, 5, 1), false);
  assert.equal(wouldExceedFreeMomentActionLimit(6, 5, 2), true);
  assert.equal(wouldExceedFreeMomentActionLimit(6, 6, 1), true);
  assert.equal(wouldExceedFreeMomentActionLimit(null, 60, 20), false);
});
