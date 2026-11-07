#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runSourceBaseline } from "./baseline.mjs";
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

const baselines = [flatRoundtrip, spotJump].map((scenario) => {
  const spot = runSourceBaseline(scenario);
  const corrected = runs.find((run) => run.scenarioId === scenario.id && run.strategy === "sniper" && run.variant === "baseline-costs-latency0");
  return {
    scenarioId: scenario.id,
    sourceBaselineSpotSol: spot.printedSpotPnlSolOnCloses,
    correctedNetSol: corrected?.netPnlSol ?? null,
    rows: [
      { scenarioId: scenario.id, variant: "source-baseline", printedSpotPnlSol: spot.printedSpotPnlSolOnCloses, netPnlSol: null, costsApplied: false },
      { scenarioId: scenario.id, variant: "corrected", printedSpotPnlSol: corrected?.printedSpotPnlSolOnCloses ?? null, netPnlSol: corrected?.netPnlSol ?? null, costsApplied: true },
    ],
  };
});

const smokePath = path.join(outDir, "smoke-status.json");
const smoke = fs.existsSync(smokePath) ? JSON.parse(fs.readFileSync(smokePath, "utf8")) : null;
const generatedAt = new Date().toISOString();
const report = {
  generatedAt,
  timezone: "UTC",
  label: "STATIC_AS_OF",
  live: false,
  empiricalBacktest: false,
  provenStrategy: false,
  selectedStrategy: "sniper",
  edgeClaim: false,
  profitClaim: false,
  note: "Synthetic checks are separate from the public-RPC smoke. Neither is a profitability claim. The 24-hour trial is not started.",
  forward: forwardStatus(),
  baselines: baselines.flatMap((row) => row.rows),
  smoke,
  runs,
};

const dashboard = renderDashboard({
  generatedAt,
  forward: report.forward,
  baselines: report.baselines,
  smoke: report.smoke,
  runs: runs.filter((r) => r.strategy === "sniper" && (r.variant === "baseline-costs-latency0" || r.variant === "latency-2000ms")),
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
  selectedStrategy: "sniper",
  provenStrategy: false,
  baselines: report.baselines,
  smoke: smoke
    ? {
        dataHealth: smoke.dataHealth,
        recordedAt: smoke.recording?.recordedAt ?? null,
        slot: smoke.recording?.slot ?? null,
        calls: smoke.recording?.calls ?? null,
        tradeCountClosed: smoke.evaluation?.tradeCountClosed ?? null,
        tradeCountOpen: smoke.evaluation?.tradeCountOpen ?? null,
        netPnlSol: smoke.evaluation?.netPnlSol ?? null,
        rejections: smoke.evaluation?.rejections ?? [],
        twentyFourHourTrialStarted: false,
        provenStrategy: false,
      }
    : null,
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
