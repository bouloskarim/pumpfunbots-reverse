#!/usr/bin/env node
// Persistent-host paper runner. This VM must not pass the arming checks.
// Read-only public RPC, sniper only, auto-stop 24h after a verified start.

import fs from "node:fs";
import path from "node:path";
import { evaluateObservedSniper } from "../observed.mjs";
import { recordBounded } from "../record.mjs";
import { publicRpc } from "../public-rpc.mjs";

export const HOST_REQUIREMENTS = [
  "A host that is still running after this cloud agent VM exits. This VM is not that host.",
  "An existing supervisor the operator already controls (a leftover terminal, systemd, or equivalent). This package does not install or buy one.",
  "Node.js 22 or newer on that host.",
  "A writable state directory for status, heartbeat.jsonl, events.jsonl, and errors.jsonl.",
  "Outbound HTTPS to https://api.mainnet-beta.solana.com. The runner does not read RPC_URL and does not use a paid key.",
  "A clock close to UTC. The stop time is start plus 24 hours, written only after getSlot succeeds.",
  "Arming requires both --persistent-host and PAPER_PERSISTENT_HOST=I_CONTROL_THIS_MACHINE. Neither is set by the cloud agent.",
];

export function hostPlan(argv = process.argv.slice(2), env = process.env) {
  const flagged = argv.includes("--persistent-host");
  const phrase = env.PAPER_PERSISTENT_HOST === "I_CONTROL_THIS_MACHINE";
  if (!flagged || !phrase) {
    return {
      started: false,
      timezone: "UTC",
      start: null,
      end: null,
      autoStopAt: null,
      heartbeat: null,
      provenStrategy: false,
      profitClaim: false,
      strategy: "sniper",
      exitCode: 2,
      requirements: HOST_REQUIREMENTS,
      reason: "24-hour clock not armed. Missing --persistent-host or the operator phrase.",
    };
  }
  return { started: true, exitCode: 0, strategy: "sniper" };
}

async function runArmed(stateDir) {
  fs.mkdirSync(stateDir, { recursive: true });
  const heartbeatPath = path.join(stateDir, "heartbeat.jsonl");
  const statusPath = path.join(stateDir, "status.json");
  let slot;
  try {
    slot = await publicRpc("getSlot", [{ commitment: "confirmed" }]);
  } catch (error) {
    const status = {
      started: false,
      timezone: "UTC",
      start: null,
      autoStopAt: null,
      dataHealth: "rpc_unavailable",
      error: error.message,
      provenStrategy: false,
    };
    fs.writeFileSync(statusPath, JSON.stringify(status, null, 2));
    process.exit(2);
  }
  const start = new Date();
  const autoStopAt = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  const seen = new Set();
  const all = [];
  while (Date.now() < autoStopAt.getTime()) {
    const beat = { t: new Date().toISOString(), slot, strategy: "sniper", autoStopAt: autoStopAt.toISOString() };
    fs.appendFileSync(heartbeatPath, `${JSON.stringify(beat)}\n`);
    const batch = await recordBounded({ maxCalls: 8, maxTransactions: 3, spacingMs: 900 });
    for (const event of batch.events || []) {
      if (!event.signature || seen.has(event.signature + event.kind + event.mint)) continue;
      seen.add(event.signature + event.kind + event.mint);
      all.push(event);
    }
    const evaluation = evaluateObservedSniper(all.filter((event) => event.kind === "quote" || event.kind === "create"));
    const status = {
      started: true,
      timezone: "UTC",
      start: start.toISOString(),
      end: null,
      autoStopAt: autoStopAt.toISOString(),
      strategy: "sniper",
      provenStrategy: false,
      profitClaim: false,
      dataHealth: batch.dataHealth,
      lastHeartbeat: beat.t,
      tradeCountClosed: evaluation.tradeCountClosed,
      tradeCountOpen: evaluation.tradeCountOpen,
      netPnlSol: evaluation.netPnlSol,
    };
    fs.writeFileSync(statusPath, JSON.stringify(status, null, 2));
    fs.writeFileSync(path.join(stateDir, "events.jsonl"), all.map((event) => JSON.stringify(event)).join("\n") + "\n");
    await new Promise((r) => setTimeout(r, 30_000));
  }
  const finalStatus = JSON.parse(fs.readFileSync(statusPath, "utf8"));
  finalStatus.end = new Date().toISOString();
  finalStatus.started = false;
  finalStatus.stoppedReason = "auto_stop_24h";
  fs.writeFileSync(statusPath, JSON.stringify(finalStatus, null, 2));
}

const isMain = process.argv[1] && process.argv[1].endsWith("run.mjs");
if (isMain) {
  const plan = hostPlan();
  const stateDir = process.argv.includes("--state")
    ? process.argv[process.argv.indexOf("--state") + 1]
    : path.join(process.cwd(), "paper-state");
  if (!plan.started) {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    process.exit(plan.exitCode);
  }
  await runArmed(stateDir);
}
