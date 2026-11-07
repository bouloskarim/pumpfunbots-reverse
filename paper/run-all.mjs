#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runScenario } from "./engine.mjs";
import { renderDashboard } from "./dashboard.mjs";
import { forwardStatus } from "./forward.mjs";
import { copyTape, flatRoundtrip, graduationEarly, spotJump, staleGap } from "./fixtures.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "paper", "out");
const fixtureDir = path.join(root, "paper", "fixtures");
fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(fixtureDir, { recursive: true });
for (const scenario of [flatRoundtrip, spotJump, graduationEarly, copyTape, staleGap]) {
  fs.writeFileSync(path.join(fixtureDir, `${scenario.id}.json`), `${JSON.stringify(scenario, null, 2)}\n`);
}

const variants = [
  { variant: "baseline-costs-latency0", entryLatencyMs: 0, extraSlippageBps: 0, failureEvery: 0, staleMs: null },
  { variant: "latency-2000ms", entryLatencyMs: 2000, extraSlippageBps: 0, failureEvery: 0, staleMs: null },
  { variant: "extra-slippage-100bps", entryLatencyMs: 0, extraSlippageBps: 100, failureEvery: 0, staleMs: null },
  { variant: "fail-every-2nd-attempt", entryLatencyMs: 0, extraSlippageBps: 0, failureEvery: 2, staleMs: null },
  { variant: "latency-2000-stale-5000", entryLatencyMs: 2000, extraSlippageBps: 0, failureEvery: 0, staleMs: 5000 },
];

const jobs = [
  [flatRoundtrip, "sniper"],
  [flatRoundtrip, "sniper-env-example"],
  [spotJump, "sniper"],
  [graduationEarly, "graduation"],
  [copyTape, "copy"],
  [staleGap, "sniper"],
];

const runs = [];
for (const [scenario, strategyName] of jobs) {
  for (const variant of variants) {
    const strategy = strategyName === "sniper-env-example" ? "sniper" : strategyName;
    const overrides = { ...variant, strategy };
    if (strategyName === "sniper-env-example") overrides.minDevBuySol = 0.5;
    const result = runScenario(scenario, overrides);
    runs.push({
      ...result,
      scenarioId: scenario.id,
      strategy: strategyName,
      variant: variant.variant,
      logs: result.logs.slice(0, 30),
    });
  }
}

const generatedAt = new Date().toISOString();
const report = {
  generatedAt,
  timezone: "UTC",
  label: "STATIC_AS_OF",
  live: false,
  empiricalBacktest: false,
  edgeClaim: false,
  profitClaim: false,
  note: "Fixture mechanism checks only. No historical wallet tape was replayed. A 24-hour sample would not establish an edge even if it were run.",
  forward: forwardStatus(),
  runs,
};

const dashboard = renderDashboard({
  generatedAt,
  forward: report.forward,
  runs: runs.filter((r) => r.variant === "baseline-costs-latency0" || r.variant === "latency-2000ms"),
});

const summary = {
  generatedAt,
  timezone: "UTC",
  label: "STATIC_AS_OF",
  live: false,
  empiricalBacktest: false,
  edgeClaim: false,
  profitClaim: false,
  note: report.note,
  forward: report.forward,
  chainProbe: JSON.parse(fs.readFileSync(path.join(root, "audit", "chain-probe.json"), "utf8")),
  runs: runs.map((run) => ({
    scenarioId: run.scenarioId,
    strategy: run.strategy,
    variant: run.variant,
    empirical: run.empirical,
    edgeClaim: run.edgeClaim,
    profitClaim: run.profitClaim,
    startingSol: run.startingSol,
    endingEquitySol: run.endingEquitySol,
    netPnlSol: run.netPnlSol,
    netPnlUsdAtAssumption: run.netPnlUsdAtAssumption,
    maxDrawdownSol: run.maxDrawdownSol,
    printedSpotPnlSolOnCloses: run.printedSpotPnlSolOnCloses,
    tradeCountClosed: run.tradeCountClosed,
    tradeCountOpen: run.tradeCountOpen,
    attempts: run.attempts,
    failedAttempts: run.failedAttempts,
    staleSkips: run.staleSkips,
    slippageSkips: run.slippageSkips,
    closed: run.closed,
    open: run.open,
  })),
};

fs.mkdirSync(path.join(root, "audit"), { recursive: true });
fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify(report, null, 2));
fs.writeFileSync(path.join(outDir, "dashboard.html"), dashboard);
fs.writeFileSync(path.join(outDir, "forward-status.json"), JSON.stringify(report.forward, null, 2));
fs.writeFileSync(path.join(root, "audit", "results.json"), JSON.stringify(summary, null, 2));
process.stdout.write(`wrote ${path.join(outDir, "report.json")}\n`);
process.stdout.write(`wrote ${path.join(outDir, "dashboard.html")}\n`);
process.stdout.write(`wrote ${path.join(root, "audit", "results.json")}\n`);
process.stdout.write(`runs ${runs.length} empiricalBacktest ${report.empiricalBacktest}\n`);
