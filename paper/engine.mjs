// Paper replay. No RPC, websocket, keypair, signing, or transaction send.
// One strategy per call. Books are not combined.

import { SOURCE_DEFAULTS } from "./defaults.mjs";
import { calcBuyTokens, calcSellSol, fillPctOfVirtual85, getPrice } from "./curve.mjs";
import { lamportsToSol, txOverheadLamports } from "./costs.mjs";

const OVERHEAD = txOverheadLamports();

function ms(iso) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) throw new Error(`bad timestamp ${iso}`);
  return t;
}

function reserves(event) {
  return {
    virtualSolReserves: BigInt(event.virtualSol),
    virtualTokenReserves: BigInt(event.virtualToken),
    realSolReserves: BigInt(event.realSol ?? 0),
    realTokenReserves: BigInt(event.realToken ?? 0),
    complete: Boolean(event.complete),
  };
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

/**
 * Replay one strategy over a chronological quote/signal tape.
 *
 * Primary fill model (the bot's dry-run does not do this):
 * - buy and sell execute against the quote with the repo's curve formula,
 *   which already removes a flat 1% on each side
 * - each attempt pays the repo's priority fee, tip, and a 5000-lamport signature fee
 * - entry uses the quote at signal time plus entryLatencyMs
 * - a migrated/complete curve cannot be sold (live path). The bot's dry-run
 *   spot print is still recorded as printedSpotPnlSol
 * - optional deterministic failureEvery: attempt N fails when N % k === 0
 */
export function runScenario(scenario, options = {}) {
  const strategy = options.strategy;
  if (!["sniper", "copy", "graduation"].includes(strategy)) {
    throw new Error(`unknown strategy ${strategy}`);
  }
  if (scenario.empirical === true) {
    throw new Error("empirical tapes are refused until a checked-in observed dataset is supplied");
  }
  const events = scenario.events || [];
  if (!events.length) throw new Error("scenario has no events");
  assertChronological(events);
  if (strategy === "copy") assertCopySelection(scenario);

  const p = paramsFor(strategy, options);
  const targets = new Set(scenario.copyTargets || []);
  const latencyMs = options.entryLatencyMs ?? 0;
  const staleMs = options.staleMs ?? null;
  const extraSlippageBps = options.extraSlippageBps ?? 0;
  const failureEvery = options.failureEvery ?? 0;
  const slippageBps = options.slippageBps ?? SOURCE_DEFAULTS.slippageBps;
  const solUsd = scenario.solUsd;
  if (!solUsd || solUsd.empirical !== false || !(solUsd.usd > 0)) {
    throw new Error("solUsd must be an explicit non-empirical positive assumption, or omitted by not claiming USD");
  }
  const equityUsd = options.equityUsd ?? 1000;
  let cash = BigInt(Math.floor((equityUsd / solUsd.usd) * 1e9));
  const startCash = cash;

  const quotes = new Map();
  const positions = new Map();
  const pending = [];
  const closed = [];
  const logs = [];
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

  function spendOverhead(reason, ts) {
    cash -= OVERHEAD;
    log(ts, `${reason}: paid overhead ${lamportsToSol(OVERHEAD)} SOL`);
  }

  function land() {
    attempts += 1;
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
    if (!q || q.complete) return 0n;
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

  function tryFill(event) {
    const now = ms(event.ts);
    for (let i = pending.length - 1; i >= 0; i--) {
      const order = pending[i];
      if (order.mint !== event.mint) continue;
      if (now < order.readyMs) continue;
      if (staleMs != null && now > order.expireMs) {
        staleSkips += 1;
        log(event.ts, `stale quote, skipped buy ${order.mint}`);
        pending.splice(i, 1);
        continue;
      }
      const state = reserves(event);
      if (state.complete) {
        log(event.ts, `curve complete at fill, skipped buy ${order.mint}`);
        pending.splice(i, 1);
        continue;
      }
      const tokensRaw = calcBuyTokens(state, p.buySol);
      const tokens = applyExtra(tokensRaw, extraSlippageBps);
      const minFromSignal = order.minTokens;
      if (tokens < minFromSignal) {
        slippageSkips += 1;
        spendOverhead("buy slippage reject", event.ts);
        pending.splice(i, 1);
        continue;
      }
      const cost = solLamports(p.buySol);
      if (cash < cost + OVERHEAD) {
        log(event.ts, `insufficient cash, skipped buy ${order.mint}`);
        pending.splice(i, 1);
        continue;
      }
      if (!land()) {
        spendOverhead("buy failed", event.ts);
        pending.splice(i, 1);
        continue;
      }
      cash -= cost + OVERHEAD;
      const entrySpot = getPrice(state);
      positions.set(order.mint, {
        mint: order.mint,
        tokens,
        entrySpot,
        entryTs: event.ts,
        entryMs: now,
        spentLamports: cost,
        entryOverhead: OVERHEAD,
        stuck: false,
      });
      pending.splice(i, 1);
      log(event.ts, `opened ${order.mint} spent ${p.buySol} SOL tokens ${tokens}`);
    }
  }

  function closeLive(pos, event, state, trigger) {
    const tokens = (pos.tokens * BigInt(p.sellPct)) / 100n;
    const expected = calcSellSol(state, tokens);
    const minSol = (expected * BigInt(10_000 - slippageBps)) / 10_000n;
    const proceeds = applyExtra(expected, extraSlippageBps);
    const printedSpotPnlSol = lamportsToSol(pos.spentLamports) * (trigger.ratio - 1);
    if (proceeds < minSol) {
      slippageSkips += 1;
      spendOverhead("sell slippage reject", event.ts);
      return;
    }
    if (!land()) {
      spendOverhead("sell failed", event.ts);
      return;
    }
    cash += proceeds - OVERHEAD;
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
      exitPolicy: "live-curve",
    });
    log(event.ts, `closed ${pos.mint} ${trigger.reason} net ${lamportsToSol(pnl)} SOL printedSpot ${printedSpotPnlSol}`);
  }

  function checkExits(event) {
    const now = ms(event.ts);
    const state = reserves(event);
    for (const pos of [...positions.values()]) {
      if (pos.mint !== event.mint) continue;
      if (strategy === "copy") continue;
      if (state.complete) {
        pos.stuck = true;
        log(event.ts, `migration/complete, cannot sell ${pos.mint} on the bonding curve`);
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

  function signal(event) {
    const now = ms(event.ts);
    const state = reserves(event);
    if (strategy === "sniper") {
      if (event.kind !== "create") return;
      if (positions.has(event.mint) || pending.some((o) => o.mint === event.mint)) return;
      if (reservedCount() >= p.maxPositions) return;
      if (now - lastBuyMs < p.cooldownSec * 1000) return;
      if (p.minDevBuySol > 0 && !(Number(event.devBuySol) >= p.minDevBuySol)) {
        log(event.ts, `skip create, dev buy ${event.devBuySol ?? 0} < ${p.minDevBuySol}`);
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
      const mention = event.logMention || event.user;
      if (!targets.has(mention)) return;
      if (event.side === "buy") {
        if (state.complete) return;
        if (positions.has(event.mint) || pending.some((o) => o.mint === event.mint)) return;
        if (reservedCount() >= p.maxPositions) return;
        queue(event, state, now);
      } else if (event.side === "sell") {
        const pos = positions.get(event.mint);
        if (!pos) return;
        if (state.complete) {
          pos.stuck = true;
          log(event.ts, `copy sell but curve complete, stuck ${event.mint}`);
          return;
        }
        const ratio = getPrice(state) / pos.entrySpot;
        closeLive(pos, event, state, { reason: "copy-sell", ratio });
      }
    }
  }

  function queue(event, state, now) {
    const expected = calcBuyTokens(state, p.buySol);
    const minTokens = (expected * BigInt(10_000 - slippageBps)) / 10_000n;
    pending.push({
      mint: event.mint,
      readyMs: now + latencyMs,
      expireMs: now + latencyMs + (staleMs ?? 0),
      minTokens,
    });
  }

  for (const event of events) {
    quotes.set(event.mint, reserves(event));
    tryFill(event);
    if (strategy !== "copy") checkExits(event);
    signal(event);
    if (latencyMs === 0) tryFill(event);
    snapshot(event.ts);
  }

  // Expire pendings that never saw a fresh quote.
  if (staleMs != null) {
    const end = ms(events[events.length - 1].ts);
    for (const order of pending) {
      if (end > order.expireMs) {
        staleSkips += 1;
        log(events[events.length - 1].ts, `expired unfilled buy ${order.mint}`);
      }
    }
  }

  const open = [...positions.values()].map((pos) => {
    const q = quotes.get(pos.mint);
    const mark = markPosition(pos);
    const spot = q ? getPrice(q) / pos.entrySpot : null;
    return {
      mint: pos.mint,
      tokens: pos.tokens.toString(),
      entryTs: pos.entryTs,
      spentSol: lamportsToSol(pos.spentLamports),
      stuck: pos.stuck || Boolean(q?.complete),
      markSol: lamportsToSol(mark),
      printedUnrealizedSpotPnlSol: spot == null ? null : lamportsToSol(pos.spentLamports) * (spot - 1),
    };
  });

  const endEquity = equityNow();
  const net = endEquity - startCash;
  const printed = closed.reduce((s, t) => s + t.printedSpotPnlSol, 0);

  return {
    strategy,
    empirical: false,
    edgeClaim: false,
    profitClaim: false,
    interpretation: "synthetic_mechanism_check",
    solUsdAssumption: solUsd,
    equityUsdStart: equityUsd,
    startingSol: lamportsToSol(startCash),
    endingEquitySol: lamportsToSol(endEquity),
    netPnlSol: lamportsToSol(net),
    netPnlUsdAtAssumption: lamportsToSol(net) * solUsd.usd,
    maxDrawdownSol: lamportsToSol(maxDrawdown),
    printedSpotPnlSolOnCloses: printed,
    tradeCountClosed: closed.length,
    tradeCountOpen: open.length,
    attempts,
    failedAttempts,
    staleSkips,
    slippageSkips,
    overheadSolPerAttempt: lamportsToSol(OVERHEAD),
    params: {
      ...p,
      virtualSolLamportsAt100Pct: strategy === "graduation" ? "85000000000" : undefined,
      entryLatencyMs: latencyMs,
      staleMs,
      extraSlippageBps,
      failureEvery,
      slippageBps,
      exitPolicy: "live-curve-no-migration-sell",
    },
    closed,
    open,
    logs,
    equityCurve,
  };
}
