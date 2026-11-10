import assert from "node:assert/strict";
import test from "node:test";
import { modelLaneForAgent } from "../lib/model-lanes.ts";

test("uses stable built-in defaults when no model environment is configured", () => {
  assert.deepEqual(modelLaneForAgent("soren", {}), {
    agent: "soren",
    provider: "anthropic",
    model: "claude-opus-4-6",
    source: "built_in_default",
    source_env: null,
    fallback_model: "claude-opus-4-6"
  });

  assert.equal(modelLaneForAgent("varro", {}).model, "claude-sonnet-4-6");
});

test("prefers the explicit per-agent lane over the shared default", () => {
  const lane = modelLaneForAgent("soren", {
    ANTHROPIC_MODEL: "shared-model",
    ANTHROPIC_MODEL_SOREN: "preview-candidate"
  });

  assert.equal(lane.model, "preview-candidate");
  assert.equal(lane.source, "agent_override");
  assert.equal(lane.source_env, "ANTHROPIC_MODEL_SOREN");
});

test("uses the shared default only when the selected agent has no override", () => {
  const lane = modelLaneForAgent("varro", {
    ANTHROPIC_MODEL: "shared-model",
    ANTHROPIC_MODEL_VARRO: "   "
  });

  assert.equal(lane.model, "shared-model");
  assert.equal(lane.source, "shared_default");
  assert.equal(lane.source_env, "ANTHROPIC_MODEL");
});
