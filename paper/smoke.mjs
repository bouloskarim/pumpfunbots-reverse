#!/usr/bin/env node
// One bounded public-RPC read, then a sniper-only paper evaluation.
// Does not arm a 24-hour trial and does not send transactions.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateObservedSniper } from "./observed.mjs";
import { recordBounded } from "./record.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "paper", "out");
fs.mkdirSync(outDir, { recursive: true });

const recording = await recordBounded({ maxCalls: 12, maxTransactions: 4, signatureLimit: 20, spacingMs: 800 });
const tradable = (recording.events || []).filter((event) => event.kind === "quote" || event.kind === "create");
const instructionCounts = {};
for (const event of recording.events || []) {
  for (const name of event.instructionNames || []) {
    instructionCounts[name] = (instructionCounts[name] || 0) + 1;
  }
}
const evaluation = evaluateObservedSniper(tradable);
const status = {
  label: "SMOKE_NOT_A_24H_TRIAL",
  live: false,
  provenStrategy: false,
  profitClaim: false,
  edgeClaim: false,
  twentyFourHourTrial: {
    started: false,
    timezone: "UTC",
    start: null,
    end: null,
    autoStopAt: null,
    heartbeat: null,
    reason: "This process is a bounded smoke read on a cloud agent VM. The 24-hour clock is armed only by paper/host/run.mjs on a persistent host.",
  },
  strategy: "sniper",
  strategiesMixed: false,
  notSelected: {
    copy: "No wallet was chosen before this sample, and the advertised 80% list is not evidence.",
    graduation: "The virtual-SOL gauge is not a verified migration test, and there is no bonding-curve sell after complete.",
  },
  dataHealth: recording.dataHealth,
  recording: {
    recordedAt: recording.recordedAt,
    endpoint: recording.endpoint,
    slot: recording.slot,
    signaturePage: recording.signaturePage,
    failedInPage: recording.failedInPage,
    transactionsFetched: recording.transactionsFetched,
    eventRows: (recording.events || []).length,
    quoteRows: tradable.filter((event) => event.kind === "quote").length,
    createRows: tradable.filter((event) => event.kind === "create").length,
    instructionCounts,
    calls: recording.calls,
    errors: recording.errors,
    heartbeat: recording.heartbeat,
  },
  evaluation: {
    tradeCountClosed: evaluation.tradeCountClosed,
    tradeCountOpen: evaluation.tradeCountOpen,
    netPnlSol: evaluation.netPnlSol,
    attempts: evaluation.attempts ?? 0,
    rejections: evaluation.rejections,
    note: evaluation.note ?? null,
    provenStrategy: false,
    profitClaim: false,
    usdBudgetApplied: false,
  },
};

const file = path.join(outDir, "smoke-status.json");
fs.writeFileSync(file, `${JSON.stringify(status, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ file, dataHealth: status.dataHealth, closed: status.evaluation.tradeCountClosed, rejections: status.evaluation.rejections?.length ?? 0, trialStarted: false })}\n`);
