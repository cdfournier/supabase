import assert from "node:assert/strict";
import test from "node:test";

import {
  decideWakeFromControlPolicy,
  type WakeControlPolicy
} from "../lib/wake-policy.ts";

test("WAKE policy allows triggers by default", () => {
  const decision = decideWakeFromControlPolicy({
    agentId: "agent:soren",
    trigger: "cafe"
  });

  assert.equal(decision.shouldWake, true);
  assert.equal(decision.reason, "trigger_enabled");
});

test("WAKE policy global master disables all wakes", () => {
  const policy: WakeControlPolicy = {
    all: {
      enabled: false,
      triggers: {
        cafe: {
          enabled: true,
          mentions: {
            enabled: true,
            names: ["Soren"]
          }
        }
      }
    }
  };
  const decision = decideWakeFromControlPolicy({
    policy,
    agentId: "agent:soren",
    trigger: "cafe",
    content: "Soren, quick note."
  });

  assert.equal(decision.shouldWake, false);
  assert.equal(decision.reason, "global_disabled");
});

test("WAKE policy agent master disables that agent", () => {
  const policy: WakeControlPolicy = {
    agents: {
      "agent:varro": {
        enabled: false
      }
    }
  };
  const decision = decideWakeFromControlPolicy({
    policy,
    agentId: "agent:varro",
    trigger: "operator_note",
    content: "Varro, this is addressed to you."
  });

  assert.equal(decision.shouldWake, false);
  assert.equal(decision.reason, "agent_disabled");
});

test("WAKE policy trigger off blocks ordinary activity", () => {
  const policy: WakeControlPolicy = {
    all: {
      triggers: {
        work_packet_signal: {
          enabled: false
        }
      }
    }
  };
  const decision = decideWakeFromControlPolicy({
    policy,
    agentId: "agent:soren",
    trigger: "work_packet_signal",
    content: "A packet changed."
  });

  assert.equal(decision.shouldWake, false);
  assert.equal(decision.reason, "trigger_disabled");
});

test("WAKE policy mention override can wake when trigger is off", () => {
  const policy: WakeControlPolicy = {
    agents: {
      "agent:soren": {
        triggers: {
          cafe: {
            enabled: false,
            mentions: {
              enabled: true,
              names: ["Soren"],
              aliases: ["So"]
            }
          }
        }
      }
    }
  };
  const decision = decideWakeFromControlPolicy({
    policy,
    agentId: "agent:soren",
    trigger: "cafe",
    content: "Could So take a look?"
  });

  assert.equal(decision.shouldWake, true);
  assert.equal(decision.reason, "mention_override");
  assert.equal(decision.matchedMention, "So");
});

test("WAKE policy mention override can use explicit mentions", () => {
  const policy: WakeControlPolicy = {
    all: {
      triggers: {
        operator_note: {
          enabled: false,
          mentions: {
            enabled: true,
            names: ["Julian"]
          }
        }
      }
    }
  };
  const decision = decideWakeFromControlPolicy({
    policy,
    agentId: "agent:julian",
    trigger: "operator_note",
    mentions: ["julian"]
  });

  assert.equal(decision.shouldWake, true);
  assert.equal(decision.reason, "mention_override");
  assert.equal(decision.matchedMention, "Julian");
});

test("WAKE policy mention-only trigger stays quiet without a match", () => {
  const policy: WakeControlPolicy = {
    all: {
      triggers: {
        cafe: {
          enabled: false,
          mentions: {
            enabled: true,
            names: ["Cael"]
          }
        }
      }
    }
  };
  const decision = decideWakeFromControlPolicy({
    policy,
    agentId: "agent:cael",
    trigger: "cafe",
    content: "A general room note."
  });

  assert.equal(decision.shouldWake, false);
  assert.equal(decision.reason, "trigger_disabled_no_mention");
});
