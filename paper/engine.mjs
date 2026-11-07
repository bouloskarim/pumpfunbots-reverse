// Corrected paper replay. One strategy per call. Books are not combined.
// This module cannot sign or broadcast: it does not import a wallet, a
// transaction builder, or an RPC sender.

import { SOURCE_DEFAULTS } from "./defaults.mjs";
import { calcBuyTokens, calcSellSol, fillPctOfVirtual85, getPrice } from "./curve.mjs";
import { lamportsToSol, txOverheadLamports } from "./costs.mjs";

const OVERHEAD = txOverheadLamports();

function ms(iso) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) throw new Error(`bad timestamp ${iso}`);
  return t;
}

export function parseQuote(event) {
  if (!event?.ts || !event?.mint) return { error: "missing_timestamp_or_mint" };
  if (event.virtualSol == null || event.virtualSol === "" || event.virtualToken == null || event.virtualToken === "") {
    return { error: "missing_reserves" };
  }
  try {
    const virtualSolReserves = BigInt(event.virtualSol);
    const virtualTokenReserves = BigInt(event.virtualToken);
    if (virtualSolReserves <= 0n || virtualTokenReserves <= 0n) return { error: "non_positive_reserves" };
    let realSolReserves = null;
    let realTokenReserves = null;
    if (event.realSol != null && event.realSol !== "") realSolReserves = BigInt(event.realSol);
    if (event.realToken != null && event.realToken !== "") realTokenReserves = BigInt(event.realToken);
    return {
      quote: {
        virtualSolReserves,
        virtualTokenReserves,
        realSolReserves,
        realTokenReserves,
        // Only an explicit flag. Missing does not mean "still on the curve" for exits
        // when the caller asked for strict quotes; synthetic fixtures set it.
        complete: event.complete === true,
        completeKnown: event.complete === true || event.complete === false,
      },
    };
  } catch {
    return { error: "malformed_reserves" };
  }
}

function solLamports(sol) {
  return BigInt(Math.floor(sol * 1e9));
}

function applyExtra(amount, extraSlippageBps) {
  if (!extraSlippageBps) return amount;
  return (amount * BigInt(10_000 - extraSlippageBps)) / 10_000n;
}

export function assertChronological(events) {
  for (let i = 1; i < events.length; i++) {
    if (ms(events[i].ts) < ms(events[i - 1].ts)) {
      throw new Error(`events are not chronological at index ${i}`);
    }
  }
}

export function assertCopySelection(scenario) {
  const targets = scenario.copyTargets || [];
  if (!targets.length) {
    throw new Error("copy strategy has no targets selected before the tape");
  }
  if (!scenario.copyTargetsSelectedAt) {
    throw new Error("copyTargetsSelectedAt is required (selection time, before the tape)");
  }
  const selected = ms(scenario.copyTargetsSelectedAt);
  const first = ms(scenario.events[0].ts);
  if (selected > first) {
    throw new Error("copy target list is timestamped after the tape starts (lookahead)");
  }
  if (!scenario.copyTargetEvidence) {
    // Corrected evaluation refuses an unexplained list. Source-mention tests pass evidence: "synthetic-fixture".
  }
}

function paramsFor(strategy, overrides) {
  const base = SOURCE_DEFAULTS[strategy];
  return {
    buySol: overrides.buySol ?? base.buySol,
    takeProfit: overrides.takeProfit ?? base.takeProfit,
    stopLoss: overrides.stopLoss ?? base.stopLoss,
    timeoutSec: overrides.timeoutSec ?? base.timeoutSec,
    maxPositions: overrides.maxPositions ?? base.maxPositions,
    minDevBuySol: overrides.minDevBuySol ?? (strategy === "sniper" ? base.minDevBuySol : 0),
    cooldownSec: overrides.cooldownSec ?? base.cooldownSec ?? 0,
    sellPct: overrides.sellPct ?? base.sellPct ?? 100,
    minFillPct: overrides.minFillPct ?? base.minFillPct,
  };
}

function assertTapeClass(scenario, options, strategy) {
  const events = scenario.events || [];
  if (scenario.empirical === true) {
    if (options.allowObserved !== true) {
      throw new Error("empirical tapes are refused until a checked-in observed dataset is supplied");
    }
    if (strategy !== "sniper") {
      throw new Error("observed evaluation runs one strategy: sniper");
    }
    for (const event of events) {
      if (event.synthetic === true) throw new Error("synthetic event in observed tape");
      if (String(event.provenance || "").toLowerCase().includes("synthetic")) {
        throw new Error("synthetic provenance in observed tape");
      }
      if (event.source !== "public-rpc" || !event.signature) {
        throw new Error("observed event missing public-rpc signature");
      }
    }
  } else if (events.some((event) => event.source === "public-rpc")) {
    throw new Error("observed event mixed into a synthetic scenario");
  }
}

/**
 * Corrected evaluation.
 *
 * Assumptions, all explicit:
 * - Protocol fee is the repo's flat 1% inside calcBuyTokens / calcSellSol.
 * - Price impact is that same constant-product quote. The historical tape is not
 *   rewritten with our size.
 * - Every submitted attempt pays priority fee + tip + signature fee from
 *   lib/config.mjs (225_000 lamports) even when it fails.
 * - Entry is sent at the signal and fills on the first later quote for that
 *   mint at or after signal+entryLatencyMs. No quote, a stale quote, or a
 *   curve already marked complete grants no tokens.
 * - Slippage uses SLIPPAGE_BPS (500) against the signal quote. A worse fill
 *   quote rejects the buy. Extra slippage bps worsens the fill further.
 * - A sell that fails slippage, fails the inclusion model, or arrives after
 *   complete does not close. There is no PumpSwap or other venue.
 * - Stuck positions are valued at 0. That is a conservative valuation, not a sale.
 * - Copy, corrected: event.user must be a target chosen before the tape.
 *   A log mention alone is attribution_mismatch.
 * - Copy is not used for observed tapes.
 */
export function runScenario(scenario, options = {}) {
  const strategy = options.strategy;
  if (!["sniper", "copy", "graduation"].includes(strategy)) {
    throw new Error(`unknown strategy ${strategy}`);
  }
  const events = scenario.events || [];
  if (!events.length) throw new Error("scenario has no events");
  assertChronological(events);
  assertTapeClass(scenario, options, strategy);
  if (strategy === "copy") {
    assertCopySelection(scenario);
    if (options.attribution !== "source-mention" && !scenario.copyTargetEvidence) {
      throw new Error("corrected copy requires copyTargetEvidence recorded before the tape");
    }
  }

  const p = paramsFor(strategy, options);
  const targets = new Set(scenario.copyTargets || []);
  const attribution = options.attribution || "corrected";
  const latencyMs = options.entryLatencyMs ?? 0;
  const staleMs = options.staleMs ?? null;
  const extraSlippageBps = options.extraSlippageBps ?? 0;
  const failureEvery = options.failureEvery ?? 0;
  const slippageBps = options.slippageBps ?? SOURCE_DEFAULTS.slippageBps;
  const solDenominated = options.solDenominated === true;
  const solUsd = scenario.solUsd;
  const usdKnown = !solDenominated && solUsd && solUsd.empirical === false && solUsd.usd > 0;
  if (!solDenominated && !usdKnown) {
    throw new Error("solUsd must be an explicit non-empirical positive assumption, or omitted by not claiming USD");
  }
  const equityUsd = options.equityUsd ?? 1000;
  let cash = solDenominated
    ? (options.startingCashLamports ?? 2_000_000_000n)
    : BigInt(Math.floor((equityUsd / solUsd.usd) * 1e9));
  const startCash = cash;

  const quotes = new Map();
  const positions = new Map();
  const pending = [];
  const closed = [];
  const logs = [];
  const ledger = [];
  const rejections = [];
  const equityCurve = [];
  let lastBuyMs = -1e15;
  let attempts = 0;
  let failedAttempts = 0;
  let staleSkips = 0;
  let slippageSkips = 0;
  let peak = cash;
  let maxDrawdown = 0n;

  function log(ts, msg) {
    logs.push({ ts, msg });
  }

  function reject(ts, reason, extra = {}) {
    rejections.push({ ts: ts ?? null, reason, ...extra });
    log(ts, `reject ${reason}${extra.mint ? " " + extra.mint : ""}`);
  }

  function move(ts, kind, lamports) {
    cash += lamports;
    ledger.push({ ts, kind, sol: lamportsToSol(lamports), cashSol: lamportsToSol(cash) });
  }

  function submit(ts, label) {
    attempts += 1;
    move(ts, "overhead", -OVERHEAD);
    log(ts, `${label}: paid overhead ${lamportsToSol(OVERHEAD)} SOL`);
    if (failureEvery > 0 && attempts % failureEvery === 0) {
      failedAttempts += 1;
      return false;
    }
    return true;
  }

  function reservedCount() {
    return positions.size + pending.length;
  }

  function markPosition(pos) {
    if (pos.stuck) return 0n;
    const q = quotes.get(pos.mint);
    if (!q || q.complete || !q.completeKnown) return 0n;
    const out = calcSellSol(q, pos.tokens);
    return out > OVERHEAD ? out - OVERHEAD : 0n;
  }

  function equityNow() {
    let mtm = 0n;
    for (const pos of positions.values()) mtm += markPosition(pos);
    return cash + mtm;
  }

  function snapshot(ts) {
    const eq = equityNow();
    if (eq > peak) peak = eq;
    if (peak - eq > maxDrawdown) maxDrawdown = peak - eq;
    equityCurve.push({
      ts,
      equitySol: lamportsToSol(eq),
      cashSol: lamportsToSol(cash),
      open: positions.size,
    });
  }

  function dropPending(order, ts, reason) {
    const idx = pending.indexOf(order);
    if (idx >= 0) pending.splice(idx, 1);
    reject(ts, reason, { mint: order.mint });
  }

  function tryFill(event, state) {
    const now = ms(event.ts);
    for (const order of [...pending]) {
      if (order.mint !== event.mint) continue;
      if (now < order.readyMs) continue;
      if (staleMs != null && now > order.expireMs) {
        staleSkips += 1;
        dropPending(order, event.ts, "stale_quote");
        continue;
      }
      if (!order.submitted) {
        dropPending(order, event.ts, "buy_not_submitted");
        continue;
      }
      if (state.complete) {
        dropPending(order, event.ts, "migrated_before_fill");
        continue;
      }
      const tokensRaw = calcBuyTokens(state, p.buySol);
      const tokens = applyExtra(tokensRaw, extraSlippageBps);
      if (tokens < order.minTokens) {
        slippageSkips += 1;
        dropPending(order, event.ts, "buy_slippage");
        continue;
      }
      const cost = solLamports(p.buySol);
      if (cash < cost) {
        dropPending(order, event.ts, "insufficient_cash");
        continue;
      }
      move(event.ts, "buy_notional", -cost);
      const entrySpot = getPrice(state);
      positions.set(order.mint, {
        mint: order.mint,
        tokens,
        entrySpot,
        entryTs: event.ts,
        entryMs: now,
        signalTs: order.signalTs,
        spentLamports: cost,
        entryOverhead: OVERHEAD,
        stuck: false,
      });
      pending.splice(pending.indexOf(order), 1);
      log(event.ts, `opened ${order.mint} spent ${p.buySol} SOL tokens ${tokens}`);
    }
  }

  function closeLive(pos, event, state, trigger) {
    if (state.complete || !state.completeKnown) {
      pos.stuck = true;
      reject(event.ts, "sell_unsupported_after_migration_or_unknown_curve", { mint: pos.mint });
      return;
    }
    const landed = submit(event.ts, "sell");
    const tokens = (pos.tokens * BigInt(p.sellPct)) / 100n;
    const expected = calcSellSol(state, tokens);
    const minSol = (expected * BigInt(10_000 - slippageBps)) / 10_000n;
    const proceeds = applyExtra(expected, extraSlippageBps);
    const printedSpotPnlSol = lamportsToSol(pos.spentLamports) * (trigger.ratio - 1);
    if (!landed) {
      reject(event.ts, "sell_tx_failed", { mint: pos.mint });
      return;
    }
    if (proceeds < minSol) {
      slippageSkips += 1;
      reject(event.ts, "sell_slippage", { mint: pos.mint });
      return;
    }
    move(event.ts, "sell_proceeds", proceeds);
    positions.delete(pos.mint);
    const pnl = proceeds - pos.spentLamports - pos.entryOverhead - OVERHEAD;
    closed.push({
      mint: pos.mint,
      entryTs: pos.entryTs,
      exitTs: event.ts,
      spentSol: lamportsToSol(pos.spentLamports),
      proceedsSol: lamportsToSol(proceeds),
      overheadSol: lamportsToSol(pos.entryOverhead + OVERHEAD),
      pnlSol: lamportsToSol(pnl),
      reason: trigger.reason,
      printedSpotPnlSol,
      holdSec: (ms(event.ts) - pos.entryMs) / 1000,
      exitPolicy: "bonding-curve-only",
      assumedExit: false,
    });
    log(event.ts, `closed ${pos.mint} ${trigger.reason} net ${lamportsToSol(pnl)} SOL spotPrint ${printedSpotPnlSol}`);
  }

  function checkExits(event, state) {
    const now = ms(event.ts);
    for (const pos of [...positions.values()]) {
      if (pos.mint !== event.mint || pos.stuck) continue;
      if (strategy === "copy") continue;
      if (state.complete || !state.completeKnown) {
        pos.stuck = true;
        reject(event.ts, "migration_or_unknown_curve_no_exit", { mint: pos.mint });
        continue;
      }
      const ratio = getPrice(state) / pos.entrySpot;
      const holdSec = (now - pos.entryMs) / 1000;
      let trigger = null;
      if (ratio >= p.takeProfit) trigger = { reason: "take-profit", ratio };
      else if (ratio <= p.stopLoss) trigger = { reason: "stop-loss", ratio };
      else if (holdSec >= p.timeoutSec) trigger = { reason: "timeout", ratio };
      if (!trigger) continue;
      closeLive(pos, event, state, trigger);
    }
  }

  function queue(event, state, now) {
    const expected = calcBuyTokens(state, p.buySol);
    const minTokens = (expected * BigInt(10_000 - slippageBps)) / 10_000n;
    const submitted = submit(event.ts, "buy");
    if (!submitted) {
      reject(event.ts, "buy_tx_failed", { mint: event.mint });
      return;
    }
    pending.push({
      mint: event.mint,
      readyMs: now + latencyMs,
      expireMs: now + latencyMs + (staleMs ?? 0),
      minTokens,
      submitted: true,
      signalTs: event.ts,
    });
  }

  function signal(event, state) {
    const now = ms(event.ts);
    if (strategy === "sniper") {
      if (event.kind !== "create") return;
      if (positions.has(event.mint) || pending.some((o) => o.mint === event.mint)) return;
      if (reservedCount() >= p.maxPositions) return;
      if (now - lastBuyMs < p.cooldownSec * 1000) return;
      if (p.minDevBuySol > 0 && !(Number(event.devBuySol) >= p.minDevBuySol)) {
        reject(event.ts, "dev_buy_below_threshold", { mint: event.mint });
        return;
      }
      if (scenario.empirical === true && event.createInstructionVerified !== true) {
        reject(event.ts, "create_instruction_not_verified", { mint: event.mint });
        return;
      }
      queue(event, state, now);
      lastBuyMs = now;
    } else if (strategy === "graduation") {
      if (state.complete) return;
      const fill = fillPctOfVirtual85(state.virtualSolReserves);
      if (!(fill >= p.minFillPct && fill < 100)) return;
      if (positions.has(event.mint) || pending.some((o) => o.mint === event.mint)) return;
      if (reservedCount() >= p.maxPositions) return;
      if (now - lastBuyMs < p.cooldownSec * 1000) return;
      queue(event, state, now);
      lastBuyMs = now;
      log(event.ts, `graduation signal fill ${fill.toFixed(2)}%`);
    } else if (strategy === "copy") {
      const userOk = Boolean(event.user) && targets.has(event.user);
      const mentionOk = Boolean(event.logMention) && targets.has(event.logMention);
      if (attribution === "source-mention") {
        if (!mentionOk && !userOk) return;
      } else if (mentionOk && !userOk) {
        reject(event.ts, "attribution_mismatch", { mint: event.mint, user: event.user, logMention: event.logMention });
        return;
      } else if (!userOk) {
        return;
      }
      if (event.side === "buy") {
        if (state.complete) {
          reject(event.ts, "copy_buy_on_completed_curve", { mint: event.mint });
          return;
        }
        if (positions.has(event.mint) || pending.some((o) => o.mint === event.mint)) return;
        if (reservedCount() >= p.maxPositions) return;
        queue(event, state, now);
      } else if (event.side === "sell") {
        const pos = positions.get(event.mint);
        if (!pos) return;
        const ratio = getPrice(state) / pos.entrySpot;
        closeLive(pos, event, state, { reason: "copy-sell", ratio });
      }
    }
  }

  for (const event of events) {
    const parsed = parseQuote(event);
    if (!parsed.quote) {
      reject(event.ts, parsed.error, { mint: event.mint ?? null });
      snapshot(event.ts || events[0].ts);
      continue;
    }
    const state = parsed.quote;
    quotes.set(event.mint, state);
    tryFill(event, state);
    if (strategy !== "copy") checkExits(event, state);
    signal(event, state);
    if (latencyMs === 0) tryFill(event, state);
    snapshot(event.ts);
  }

  const endTs = events[events.length - 1].ts;
  const endMs = ms(endTs);
  for (const order of [...pending]) {
    const expired = staleMs != null ? endMs > order.expireMs : endMs >= order.readyMs;
    if (!expired && staleMs == null && endMs < order.readyMs) {
      staleSkips += 1;
      dropPending(order, endTs, "no_fill_quote");
      continue;
    }
    if (expired || endMs >= order.readyMs) {
      staleSkips += 1;
      dropPending(order, endTs, staleMs != null && endMs > order.expireMs ? "stale_quote" : "no_fill_quote");
    }
  }

  const open = [...positions.values()].map((pos) => {
    const q = quotes.get(pos.mint);
    const mark = markPosition(pos);
    const stuck = pos.stuck || Boolean(q?.complete) || !q?.completeKnown;
    return {
      mint: pos.mint,
      tokens: pos.tokens.toString(),
      entryTs: pos.entryTs,
      spentSol: lamportsToSol(pos.spentLamports),
      stuck,
      assumedExit: false,
      valuation: stuck ? "conservative_zero_no_supported_venue" : "bonding_curve_liquidation_net_of_exit_overhead",
      markSol: lamportsToSol(mark),
    };
  });

  const endEquity = equityNow();
  const net = endEquity - startCash;
  const printed = closed.reduce((s, t) => s + t.printedSpotPnlSol, 0);

  return {
    strategy,
    evaluationVariant: "corrected",
    attribution,
    empirical: scenario.empirical === true,
    empiricalBacktest: false,
    provenStrategy: false,
    edgeClaim: false,
    profitClaim: false,
    interpretation: scenario.empirical === true ? "observed_public_rpc_not_a_backtest" : "synthetic_mechanism_check",
    solUsdAssumption: usdKnown ? solUsd : { usd: null, empirical: false, note: "No observed SOL/USD print. USD budget was not applied." },
    usdBudgetApplied: usdKnown,
    equityUsdStart: usdKnown ? equityUsd : null,
    startingSol: lamportsToSol(startCash),
    endingEquitySol: lamportsToSol(endEquity),
    netPnlSol: lamportsToSol(net),
    netPnlUsdAtAssumption: usdKnown ? lamportsToSol(net) * solUsd.usd : null,
    maxDrawdownSol: lamportsToSol(maxDrawdown),
    printedSpotPnlSolOnCloses: printed,
    tradeCountClosed: closed.length,
    tradeCountOpen: open.length,
    attempts,
    failedAttempts,
    staleSkips,
    slippageSkips,
    rejectionCount: rejections.length,
    overheadSolPerAttempt: lamportsToSol(OVERHEAD),
    params: {
      ...p,
      virtualSolLamportsAt100Pct: strategy === "graduation" ? "85000000000" : undefined,
      entryLatencyMs: latencyMs,
      staleMs,
      extraSlippageBps,
      failureEvery,
      slippageBps,
      exitPolicy: "bonding-curve-only-stuck-marks-zero",
      overheadPaidOnSubmit: true,
    },
    rejections,
    ledger,
    closed,
    open,
    logs,
    equityCurve,
  };
}
