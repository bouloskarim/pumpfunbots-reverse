// Source-baseline spot accounting: what bots/sniper dry-run prints.
// Immediate spot ratio, no fee, no impact, no tip, no priority fee.
// On a completed curve the sniper dry-run still prints a spot sell.
// This is not the corrected evaluation.

import { SOURCE_DEFAULTS } from "./defaults.mjs";
import { getPrice } from "./curve.mjs";
import { parseQuote } from "./engine.mjs";

export function runSourceBaseline(scenario, options = {}) {
  if (scenario.empirical === true) {
    throw new Error("source baseline is a synthetic comparison, not an observed result");
  }
  const strategy = options.strategy || "sniper";
  if (strategy !== "sniper") {
    throw new Error("source baseline comparison is implemented for the sniper only");
  }
  const p = SOURCE_DEFAULTS.sniper;
  const buySol = options.buySol ?? p.buySol;
  const positions = new Map();
  const closed = [];
  let printed = 0;
  for (const event of scenario.events) {
    const parsed = parseQuote(event);
    if (!parsed.quote) continue;
    const spot = getPrice(parsed.quote);
    if (event.kind === "create" && !positions.has(event.mint)) {
      positions.set(event.mint, { entrySpot: spot, entryTs: event.ts, entryMs: Date.parse(event.ts) });
    }
    const pos = positions.get(event.mint);
    if (!pos || event.kind === "create" && pos.entryTs === event.ts && !options.exitOnEntryBar) {
      // Entry bar does not exit.
    }
    if (!pos) continue;
    if (pos.entryTs === event.ts) continue;
    const ratio = spot / pos.entrySpot;
    const holdSec = (Date.parse(event.ts) - pos.entryMs) / 1000;
    let reason = null;
    if (ratio >= p.takeProfit) reason = "take-profit";
    else if (ratio <= p.stopLoss) reason = "stop-loss";
    else if (holdSec >= p.timeoutSec) reason = "timeout";
    if (!reason) continue;
    const pnl = buySol * (ratio - 1);
    printed += pnl;
    closed.push({
      mint: event.mint,
      reason,
      printedSpotPnlSol: pnl,
      holdSec,
      assumedExit: parsed.quote.complete === true,
      costsApplied: false,
    });
    positions.delete(event.mint);
  }
  return {
    strategy: "sniper",
    evaluationVariant: "source-baseline",
    provenStrategy: false,
    profitClaim: false,
    edgeClaim: false,
    empirical: false,
    costsApplied: false,
    printedSpotPnlSolOnCloses: printed,
    tradeCountClosed: closed.length,
    closed,
    note: "Spot ratio only. Fees, impact, tips, priority fees, failures, and migration are omitted, matching bots/sniper dry-run.",
  };
}
