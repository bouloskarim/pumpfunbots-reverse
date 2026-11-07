// Sniper-only evaluation of recorder output. Refuses synthetic rows.

import { runScenario } from "./engine.mjs";

export function evaluateObservedSniper(events) {
  const pre = [];
  const usable = [];
  if (!events?.length) pre.push({ reason: "no_observed_events" });
  for (const event of events || []) {
    if (event.synthetic === true || String(event.provenance || "").toLowerCase().includes("synthetic")) {
      throw new Error("synthetic event refused by observed sniper evaluation");
    }
    if (event.kind !== "create" && event.kind !== "quote") {
      pre.push({ reason: event.reason || event.kind || "ignored_row", signature: event.signature ?? null });
      continue;
    }
    if (event.sideConflict) {
      pre.push({ reason: "side_conflict", signature: event.signature ?? null });
      continue;
    }
    if (!event.ts) {
      pre.push({ reason: "missing_block_time", signature: event.signature ?? null });
      continue;
    }
    usable.push(event);
  }
  const creates = usable.filter((event) => event.kind === "create" && event.createInstructionVerified === true);
  const base = {
    strategy: "sniper",
    evaluationVariant: "corrected",
    provenStrategy: false,
    profitClaim: false,
    edgeClaim: false,
    empiricalBacktest: false,
    marketSample: events?.length > 0,
    usdBudgetApplied: false,
    budgetIntentUsd: 1000,
    budgetNote: "No SOL/USD print is on these RPC rows, so the $1000 figure is not converted and is not a result.",
  };
  if (!creates.length) {
    return {
      ...base,
      tradeCountClosed: 0,
      tradeCountOpen: 0,
      netPnlSol: null,
      attempts: 0,
      rejections: [
        ...pre,
        {
          reason: "no_verified_create_in_sample",
          observedRows: (events || []).length,
          quoteRows: usable.filter((event) => event.kind === "quote").length,
        },
      ],
      note: "No fill. A sniper entry needs a verified create instruction and reserves in the same sample. This sample did not have one.",
    };
  }
  const run = runScenario(
    { id: "observed-sniper", empirical: true, events: usable },
    { strategy: "sniper", allowObserved: true, solDenominated: true },
  );
  return {
    ...run,
    ...base,
    preRejections: pre,
    provenStrategy: false,
    profitClaim: false,
    edgeClaim: false,
    empiricalBacktest: false,
  };
}
