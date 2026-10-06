import assert from "node:assert/strict";
import test from "node:test";

import {
  joinWheelsRide,
  leaveWheelsRide,
  driveWheels,
  lookWheels,
  pullOverWheels,
  requestWheelsTurn,
  takeWheelsWheel,
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

test("persistent WHEELS permission permits a queued agent to take and drive bounded segments", async (t) => {
  await withPiFetch(t, async (calls) => {
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      calls.push({ url, init });

      if (url.endsWith("/queue") && (!init || init.method !== "POST")) {
        return Response.json({ driver: null, queue: [{ name: "Soren", intention: "Explore slowly" }] });
      }

      return Response.json({ ok: true, driver: "Soren" });
    };

    const taken = await takeWheelsWheel("soren", {});
    assert.match(taken, /persistent-permission driver/);
    assert.deepEqual(body(calls[1]!), { action: "take", driver: "Soren" });

    const driven = await driveWheels("soren", {
      direction: "forward",
      angle: -12,
      speed: 20,
      duration_seconds: 1.5
    });
    assert.match(driven, /bounded WHEELS drive segment/);
    assert.deepEqual(body(calls[2]!), {
      driver: "Soren",
      direction: "forward",
      angle: -12,
      speed: 20,
      duration: 1.5
    });

    const pulledOver = await pullOverWheels("soren", {});
    assert.match(pulledOver, /atomically released/);
    assert.deepEqual(body(calls[3]!), { driver: "Soren" });
  });
});

test("WHEELS self-claim respects another agent's visible queue turn", async (t) => {
  await withPiFetch(t, async (calls) => {
    globalThis.fetch = async (input, init) => {
      calls.push({ url: String(input), init });
      return Response.json({ driver: null, queue: [{ name: "Varro", intention: "Take a look" }] });
    };

    await assert.rejects(
      () => takeWheelsWheel("soren", {}),
      /Varro is first in the WHEELS queue/
    );
    assert.equal(calls.length, 1);
  });
});

test("WHEELS bounded agent drives reject unsafe values before reaching the Pi", async () => {
  await assert.rejects(
    () => driveWheels("soren", { direction: "forward", speed: 41 }),
    /speed must be between 1 and 40/
  );
  await assert.rejects(
    () => driveWheels("soren", { direction: "left" }),
    /direction must be forward or backward/
  );
});

test("WHEELS look returns a current Pi camera image without custody or motion", async (t) => {
  await withPiFetch(t, async (calls) => {
    globalThis.fetch = async (input, init) => {
      calls.push({ url: String(input), init });
      return new Response(new Uint8Array([1, 2, 3, 4]), {
        headers: { "content-type": "image/jpeg" }
      });
    };

    const result = await lookWheels("varro", {});

    assert.equal(calls[0]?.url, "http://picar.test/camera");
    assert.match(result[0]?.type === "text" ? result[0].text : "", /observation only/);
    assert.deepEqual(result[1], {
      type: "image",
      source: {
        type: "base64",
        media_type: "image/jpeg",
        data: "AQIDBA=="
      }
    });
  });
});
