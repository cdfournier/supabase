import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluatePresence,
  listPresenceAdapters,
  upsertPresenceReceipt
} from "../lib/presence.ts";

test("Presence derives stale state without changing the declared state", () => {
  const lastSeen = new Date("2026-08-29T12:00:00.000Z");
  const receipt = upsertPresenceReceipt({
    surface: "bar",
    participant_id: "agent:soren",
    display_name: "Soren",
    now: lastSeen,
    stale_after_ms: 1000
  });
  const evaluated = evaluatePresence(receipt, new Date("2026-08-29T12:00:02.000Z"));

  assert.equal(receipt.declared_state, "present");
  assert.equal(evaluated.state, "stale");
});

test("Presence keeps absent receipts absent after stale window", () => {
  const receipt = upsertPresenceReceipt({
    surface: "bar",
    participant_id: "agent:varro",
    display_name: "Varro",
    state: "absent",
    now: new Date("2026-08-29T12:00:00.000Z"),
    stale_after_ms: 1000
  });
  const evaluated = evaluatePresence(receipt, new Date("2026-08-29T12:30:00.000Z"));

  assert.equal(evaluated.state, "absent");
});

test("Presence exposes live BAR/EYES plus dry-run WHEELS adapter contracts", () => {
  const adapters = listPresenceAdapters();

  assert.equal(adapters.some((adapter) => adapter.surface === "bar" && adapter.status === "live"), true);
  assert.equal(adapters.some((adapter) => adapter.surface === "eyes" && adapter.status === "live"), true);
  assert.equal(adapters.some((adapter) => adapter.surface === "wheels" && adapter.status === "dry_run"), true);
});
