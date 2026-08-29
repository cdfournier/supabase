import "server-only";

import { spawn } from "node:child_process";

import {
  claimLiveSessionBridgeDelivery,
  completeLiveSessionBridgeDelivery,
  type BridgeAgentName,
  type LiveSessionBridgeDelivery
} from "@/lib/live-sessions";

type BridgeAdapterResult = {
  agent: BridgeAgentName;
  status: "disabled" | "idle" | "delivered" | "failed";
  delivery_id?: string;
  error?: string;
};

const BRIDGE_AGENTS: BridgeAgentName[] = ["julian", "cael"];
const DEFAULT_CODEX_CLI = "/Applications/ChatGPT.app/Contents/Resources/codex";

export async function deliverPendingLiveSessionBridgeDeliveries(sessionId?: string) {
  const results: BridgeAdapterResult[] = [];

  for (const agent of BRIDGE_AGENTS) {
    results.push(await deliverPendingLiveSessionBridgeDelivery(agent, sessionId));
  }

  return results;
}

async function deliverPendingLiveSessionBridgeDelivery(
  agent: BridgeAgentName,
  sessionId?: string
): Promise<BridgeAdapterResult> {
  if (!adapterEnabled(agent)) {
    return {
      agent,
      status: "disabled"
    };
  }

  const claimed = await claimLiveSessionBridgeDelivery({
    sessionId,
    agent
  });

  if (!claimed.delivery) {
    return {
      agent,
      status: "idle"
    };
  }

  try {
    await deliver(agent, claimed.delivery);
    await completeLiveSessionBridgeDelivery({
      sessionId,
      agent,
      deliveryId: claimed.delivery.id,
      claimId: claimed.delivery.claim_id ?? undefined,
      outcome: "delivered"
    });

    return {
      agent,
      status: "delivered",
      delivery_id: claimed.delivery.id
    };
  } catch (error) {
    const message = errorMessage(error);

    await completeLiveSessionBridgeDelivery({
      sessionId,
      agent,
      deliveryId: claimed.delivery.id,
      claimId: claimed.delivery.claim_id ?? undefined,
      outcome: "failed",
      error: message
    });

    return {
      agent,
      status: "failed",
      delivery_id: claimed.delivery.id,
      error: message
    };
  }
}

async function deliver(agent: BridgeAgentName, delivery: LiveSessionBridgeDelivery) {
  if (agent === "julian") {
    await deliverToCodex(delivery);
    return;
  }

  await deliverToCowork(delivery);
}

async function deliverToCodex(delivery: LiveSessionBridgeDelivery) {
  const threadId = process.env.JULIAN_CODEX_THREAD_ID?.trim();
  const cli = process.env.CODEX_CLI?.trim() || DEFAULT_CODEX_CLI;

  if (!threadId) {
    throw new Error("JULIAN_CODEX_THREAD_ID is required for Julian bridge delivery.");
  }

  await run(cli, [
    "queue",
    "--thread",
    threadId,
    "--message",
    delivery.prompt
  ]);
}

async function deliverToCowork(delivery: LiveSessionBridgeDelivery) {
  const url = process.env.CAEL_COWORK_CONNECTOR_URL?.trim();

  if (!url) {
    throw new Error("CAEL_COWORK_CONNECTOR_URL is required for Cael bridge delivery.");
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      type: "live_session_bridge_delivery",
      delivery
    })
  });

  if (!response.ok) {
    throw new Error(`Cowork connector returned HTTP ${response.status}.`);
  }
}

function adapterEnabled(agent: BridgeAgentName) {
  const envName = agent === "julian"
    ? "LIVE_SESSION_BRIDGE_AUTODELIVER_JULIAN"
    : "LIVE_SESSION_BRIDGE_AUTODELIVER_CAEL";

  return process.env[envName]?.trim().toLowerCase() === "true";
}

function run(command: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stderr = "";

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(stderr.trim() || `${command} exited with status ${code}`));
    });
  });
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown bridge adapter error.";
}
