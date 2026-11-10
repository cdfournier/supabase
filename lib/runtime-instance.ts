import "server-only";

import { randomUUID } from "node:crypto";

type RuntimeInstanceState = {
  id: string;
  startedAt: string;
  seenModelRequests: Set<string>;
};

type RuntimeGlobal = typeof globalThis & {
  __runtimeInstanceState?: RuntimeInstanceState;
};

export type ModelRequestMeasurement = {
  runtimeInstanceId: string;
  runtimeStartedAt: string;
  coldStart: boolean;
  startedAtMs: number;
};

/**
 * A process-local identity lets the accounting trail distinguish a first
 * provider call after a runtime boot from an ordinary warm request. It is
 * diagnostic metadata only: it never controls whether a turn may run.
 */
export function beginModelRequest(provider: string, model: string): ModelRequestMeasurement {
  const runtimeGlobal = globalThis as RuntimeGlobal;
  runtimeGlobal.__runtimeInstanceState ??= {
    id: randomUUID(),
    startedAt: new Date().toISOString(),
    seenModelRequests: new Set<string>()
  };

  const state = runtimeGlobal.__runtimeInstanceState;
  const requestKey = `${provider}:${model}`;
  const coldStart = !state.seenModelRequests.has(requestKey);
  state.seenModelRequests.add(requestKey);

  return {
    runtimeInstanceId: state.id,
    runtimeStartedAt: state.startedAt,
    coldStart,
    startedAtMs: Date.now()
  };
}

export function elapsedModelRequestMs(measurement: ModelRequestMeasurement) {
  return Math.max(0, Date.now() - measurement.startedAtMs);
}

export function runtimeInstanceStatus() {
  const runtimeGlobal = globalThis as RuntimeGlobal;
  const state = runtimeGlobal.__runtimeInstanceState;

  return state
    ? {
        id: state.id,
        started_at: state.startedAt,
        observed_model_lanes: state.seenModelRequests.size
      }
    : null;
}
