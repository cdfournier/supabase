import assert from "node:assert/strict";
import test from "node:test";

import {
  shouldSettleAfterToolUse,
  shouldSettleBeforeToolCall,
  toolRoundLimitFromEnv,
  toolRoundLimitLabel
} from "../lib/tool-round-limit.ts";

test("tool round limit uses a bounded default for absent or invalid values", () => {
  assert.equal(toolRoundLimitFromEnv(undefined), 6);
  assert.equal(toolRoundLimitFromEnv(""), 6);
  assert.equal(toolRoundLimitFromEnv("-1"), 6);
  assert.equal(toolRoundLimitFromEnv("not-a-number"), 6);
});

test("tool round limit preserves explicit numeric limits including zero", () => {
  assert.equal(toolRoundLimitFromEnv("10"), 10);
  assert.equal(toolRoundLimitFromEnv("2.9"), 2);
  assert.equal(toolRoundLimitFromEnv("0"), 0);
});

test("tool round limit accepts none as the only unbounded value", () => {
  assert.equal(toolRoundLimitFromEnv("none"), null);
  assert.equal(toolRoundLimitFromEnv(" NONE "), null);
  assert.equal(toolRoundLimitLabel(null), "none");
  assert.equal(toolRoundLimitLabel(10), "10");
});

test("an unbounded limit never settles the tool loop", () => {
  assert.equal(shouldSettleBeforeToolCall(null, 0), false);
  assert.equal(shouldSettleBeforeToolCall(null, 100), false);
  assert.equal(shouldSettleAfterToolUse(null, 0), false);
  assert.equal(shouldSettleAfterToolUse(null, 100), false);
});

test("numeric limits keep the existing settlement boundaries", () => {
  assert.equal(shouldSettleAfterToolUse(2, 1), false);
  assert.equal(shouldSettleAfterToolUse(2, 2), true);
  assert.equal(shouldSettleBeforeToolCall(2, 2), false);
  assert.equal(shouldSettleBeforeToolCall(2, 3), true);
});
