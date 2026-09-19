#!/usr/bin/env node

/** Install or remove Julian's local BAR/EYES delivery relay.
 *
 * The runtime can create a bounded bridge-delivery job, but only this local
 * process can queue that job into the currently bound Codex task. launchd
 * keeps the relay available after login and restarts it if it exits.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { dirname, resolve } from "node:path";

const label = "ai.blackcoffeeshoppe.hug.julian-live-session-relay";
const home = homedir();
const uid = userInfo().uid;
const workspace = resolve(import.meta.dirname, "..");
const plistPath = `${home}/Library/LaunchAgents/${label}.plist`;
const logsDirectory = `${home}/Library/Logs/HUG`;
const statePath = `${home}/Library/Application Support/HUG/julian-live-session-relay.json`;
const args = new Set(process.argv.slice(2));

if (args.has("--help") || args.has("-h")) {
  console.log("Usage: node scripts/install-julian-live-session-relay.mjs [--uninstall]");
  process.exit(0);
}

if (args.has("--uninstall")) {
  runLaunchctl(["bootout", `gui/${uid}`, plistPath], { allowFailure: true });
  if (existsSync(plistPath)) {
    unlinkSync(plistPath);
  }
  console.log(`Removed ${label}.`);
  process.exit(0);
}

mkdirSync(dirname(plistPath), { recursive: true });
mkdirSync(logsDirectory, { recursive: true });
mkdirSync(dirname(statePath), { recursive: true });

runLaunchctl(["bootout", `gui/${uid}`, plistPath], { allowFailure: true });
writeFileSync(plistPath, plist(), "utf8");
runLaunchctl(["bootstrap", `gui/${uid}`, plistPath]);
runLaunchctl(["kickstart", "-k", `gui/${uid}/${label}`]);

console.log(`Installed and started ${label}.`);
console.log(`Health receipt: ${statePath}`);
console.log(`Logs: ${logsDirectory}/julian-live-session-relay.{out,err}.log`);

function plist() {
  const values = [
    process.execPath,
    `${workspace}/scripts/live-session-bridge-adapter.mjs`,
    "--agent",
    "julian",
    "--state-path",
    statePath
  ];
  const array = values.map((value) => `      <string>${xml(value)}</string>`).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>${label}</string>
    <key>ProgramArguments</key>
    <array>
${array}
    </array>
    <key>WorkingDirectory</key>
    <string>${xml(workspace)}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>ThrottleInterval</key>
    <integer>5</integer>
    <key>StandardOutPath</key>
    <string>${xml(`${logsDirectory}/julian-live-session-relay.out.log`)}</string>
    <key>StandardErrorPath</key>
    <string>${xml(`${logsDirectory}/julian-live-session-relay.err.log`)}</string>
  </dict>
</plist>
`;
}

function runLaunchctl(command, options = {}) {
  try {
    execFileSync("launchctl", command, { stdio: "pipe" });
  } catch (error) {
    if (options.allowFailure) {
      return;
    }
    const detail = error instanceof Error ? error.message : "Unknown launchctl error.";
    throw new Error(`launchctl ${command.join(" ")} failed: ${detail}`);
  }
}

function xml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
