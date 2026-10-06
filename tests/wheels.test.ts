import assert from "node:assert/strict";
import test from "node:test";

import {
  joinWheelsRide,
  leaveWheelsRide,
  requestWheelsTurn,
  withdrawWheelsTurn
} from "../lib/tools/wheels.ts";

type FetchCall = {
  url: string;
  init?: RequestInit;
};

function withPiFetch(t: test.TestContext, callback: (calls: FetchCall[]) => Promise<void>) {
  const originalFetch = globalThis.fetch;
  const previousBaseUrl = process.env.PICAR_BASE_URL;
  const calls: FetchCall[] = [];

  process.env.PICAR_BASE_URL = "http://picar.test";
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    return Response.json({ ok: true, passengers: [], queue: [] });
  };

  t.after(() => {
    globalThis.fetch = originalFetch;
    if (previousBaseUrl === undefined) {
      delete process.env.PICAR_BASE_URL;
    } else {
      process.env.PICAR_BASE_URL = previousBaseUrl;
    }
  });

  return callback(calls);
}

function body(call: FetchCall) {
  return JSON.parse(String(call.init?.body));
}

test("WHEELS ride actions use named passenger endpoints without motion", async (t) => {
  await withPiFetch(t, async (calls) => {
    const joined = await joinWheelsRide("soren", {});

    assert.match(joined, /no wheel or motion authority/);
    assert.deepEqual(calls.map((call) => call.url), ["http://picar.test/passengers"]);
    assert.deepEqual(body(calls[0]!), { action: "join", name: "Soren" });

    const left = await leaveWheelsRide("soren", {});

    assert.match(left, /withdrew any pending wheel request/);
    assert.deepEqual(calls.slice(1).map((call) => call.url).sort(), [
      "http://picar.test/passengers",
      "http://picar.test/queue"
    ]);
    assert.deepEqual(calls.slice(1).map(body).sort((a, b) => String(a.action).localeCompare(String(b.action))), [
      { action: "leave", name: "Soren" },
      { action: "leave", name: "Soren" }
    ]);
  });
});

test("WHEELS queue actions express a request but never motion", async (t) => {
  await withPiFetch(t, async (calls) => {
    const requested = await requestWheelsTurn("varro", { intention: "A slow supervised look down the hall." });

    assert.match(requested, /Operator must explicitly hand over custody/);
    assert.deepEqual(calls.map((call) => call.url), ["http://picar.test/queue"]);
    assert.deepEqual(body(calls[0]!), {
      action: "join",
      name: "Varro",
      intention: "A slow supervised look down the hall."
    });

    const withdrawn = await withdrawWheelsTurn("varro", {});

    assert.match(withdrawn, /No passenger, wheel, or motion state changed/);
    assert.deepEqual(body(calls[1]!), { action: "leave", name: "Varro" });
  });
});

test("WHEELS queue action requires a concise intention", async () => {
  await assert.rejects(
    () => requestWheelsTurn("soren", {}),
    /requires a short intention/
  );
});
