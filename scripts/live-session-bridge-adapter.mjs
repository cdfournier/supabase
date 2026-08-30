#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

const AGENTS = new Set(["julian"]);
const DEFAULT_BASE_URL = "http://localhost:3001";
const DEFAULT_INTERVAL_SECONDS = 5;
const DEFAULT_CODEX_CLI = "/Applications/ChatGPT.app/Contents/Resources/codex";

loadLocalEnv();

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  printHelp();
  process.exit(0);
}

const agent = requiredAgent(args.agent ?? process.env.LIVE_SESSION_BRIDGE_AGENT);
const once = args.once === true;
const intervalSeconds = positiveInteger(args.interval ?? process.env.LIVE_SESSION_BRIDGE_INTERVAL_SECONDS)
  ?? DEFAULT_INTERVAL_SECONDS;
const baseUrl = trimTrailingSlash(args.baseUrl ?? process.env.HUG_RUNTIME_BASE_URL ?? DEFAULT_BASE_URL);
const token = requiredEnv("CAFE_BRIDGE_TOKEN");

while (true) {
  try {
    const result = await processOneDelivery({ agent, baseUrl, token });

    if (result) {
      console.log(`${new Date().toISOString()} ${agent}: ${result}`);
    } else if (once) {
      console.log(`${new Date().toISOString()} ${agent}: no pending bridge delivery`);
    }
  } catch (error) {
    console.error(`${new Date().toISOString()} ${agent}: ${errorMessage(error)}`);
    if (once) {
      process.exit(1);
    }
  }

  if (once) {
    break;
  }

  await sleep(intervalSeconds * 1000);
}

async function processOneDelivery({ agent, baseUrl, token }) {
  const claimed = await requestJson(`${baseUrl}/api/live-sessions/bridge-deliveries`, {
    method: "POST",
    token,
    body: {
      action: "claim",
      participant_id: `agent:${agent}`
    }
  });
  const delivery = claimed.delivery;

  if (!delivery) {
    return null;
  }

  try {
    await deliver(agent, delivery);
    await completeDelivery({ agent, baseUrl, token, delivery, outcome: "delivered" });

    return `delivered ${delivery.id}`;
  } catch (error) {
    const message = errorMessage(error);
    await completeDelivery({ agent, baseUrl, token, delivery, outcome: "failed", error: message });
    throw new Error(`delivery ${delivery.id} failed: ${message}`);
  }
}

async function deliver(agent, delivery) {
  if (agent === "julian") {
    await deliverToCodex(delivery);
    return;
  }

  throw new Error(`${agent} does not support server-side bridge autodelivery.`);
}

async function deliverToCodex(delivery) {
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

async function completeDelivery({ agent, baseUrl, token, delivery, outcome, error }) {
  await requestJson(`${baseUrl}/api/live-sessions/bridge-deliveries`, {
    method: "POST",
    token,
    body: {
      action: "complete",
      participant_id: `agent:${agent}`,
      delivery_id: delivery.id,
      claim_id: delivery.claim_id,
      outcome,
      error
    }
  });
}

async function requestJson(url, { method, token, body }) {
  const response = await fetch(url, {
    method,
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  const text = await response.text();
  const json = text ? JSON.parse(text) : {};

  if (!response.ok) {
    throw new Error(json.error || `HTTP ${response.status}`);
  }

  return json;
}

function run(command, args) {
  return new Promise((resolve, reject) => {
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

function parseArgs(argv) {
  const parsed = {};

  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];

    if (item === "--help" || item === "-h") {
      parsed.help = true;
    } else if (item === "--once") {
      parsed.once = true;
    } else if (item === "--agent") {
      parsed.agent = argv[++index];
    } else if (item === "--base-url") {
      parsed.baseUrl = argv[++index];
    } else if (item === "--interval") {
      parsed.interval = argv[++index];
    } else {
      throw new Error(`Unknown argument: ${item}`);
    }
  }

  return parsed;
}

function requiredAgent(value) {
  const agent = String(value ?? "").trim().toLowerCase();

  if (!AGENTS.has(agent)) {
    throw new Error("Choose --agent julian. Cael uses the pull bridge helper in his Cowork project.");
  }

  return agent;
}

function requiredEnv(name) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} is required.`);
  }

  return value;
}

function positiveInteger(value) {
  const number = Number(value);

  if (Number.isInteger(number) && number > 0) {
    return number;
  }

  return null;
}

function trimTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}

function errorMessage(error) {
  return error instanceof Error ? error.message : "Unknown bridge adapter error.";
}

function printHelp() {
  console.log(`Usage:
  node scripts/live-session-bridge-adapter.mjs --agent julian [--once]

Environment:
  CAFE_BRIDGE_TOKEN                 Required bridge API token.
  HUG_RUNTIME_BASE_URL              Runtime URL. Defaults to ${DEFAULT_BASE_URL}.
  LIVE_SESSION_BRIDGE_INTERVAL_SECONDS
                                    Poll interval for loop mode. Defaults to ${DEFAULT_INTERVAL_SECONDS}.
  JULIAN_CODEX_THREAD_ID            Required for --agent julian.
  CODEX_CLI                         Optional Codex CLI path. Defaults to ${DEFAULT_CODEX_CLI}.

Cael uses the pull bridge from his Cowork project:
  python3 "/Users/chris/Documents/Claude/Projects/Outpost Cael/bar_live.py" join
`);
}

function loadLocalEnv() {
  for (const file of [".env", ".env.local"]) {
    if (!existsSync(file)) {
      continue;
    }

    const lines = readFileSync(file, "utf8").split(/\r?\n/);

    for (const line of lines) {
      const trimmed = line.trim();

      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }

      const equalsIndex = trimmed.indexOf("=");

      if (equalsIndex <= 0) {
        continue;
      }

      const key = trimmed.slice(0, equalsIndex).trim();
      const value = parseEnvValue(trimmed.slice(equalsIndex + 1).trim());

      if (!Object.prototype.hasOwnProperty.call(process.env, key)) {
        process.env[key] = value;
      }
    }
  }
}

function parseEnvValue(value) {
  if (
    (value.startsWith("\"") && value.endsWith("\"")) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}
