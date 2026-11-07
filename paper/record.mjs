// Bounded, paced, read-only recording from the public RPC. No synthetic rows.

import { decodeTransaction } from "./decode-tx.mjs";
import { publicRpc } from "./public-rpc.mjs";

const PUMP = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";

export async function recordBounded(opts = {}) {
  const maxCalls = opts.maxCalls ?? 12;
  const maxTransactions = opts.maxTransactions ?? 4;
  const spacingMs = opts.spacingMs ?? 800;
  const sleep = opts.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const heartbeat = [];
  const errors = [];
  const events = [];
  let calls = 0;
  const charge = () => {
    if (calls >= maxCalls) return false;
    calls += 1;
    return true;
  };
  const beat = (row) => heartbeat.push({ t: new Date().toISOString(), ...row });
  const rpc = (method, params) => publicRpc(method, params, { charge, sleep, fetchImpl: opts.fetchImpl, endpoint: opts.endpoint });

  let slot = null;
  try {
    slot = await rpc("getSlot", [{ commitment: "confirmed" }]);
    beat({ method: "getSlot", ok: true, slot });
  } catch (error) {
    errors.push({ method: "getSlot", message: error.message, code: error.code || null });
    beat({ method: "getSlot", ok: false, error: error.message, code: error.code || null });
    return { dataHealth: "rpc_unavailable", slot, events, errors, heartbeat, calls, synthetic: false };
  }

  let signatures = [];
  try {
    await sleep(spacingMs);
    signatures = await rpc("getSignaturesForAddress", [PUMP, { limit: opts.signatureLimit ?? 20, commitment: "confirmed" }]);
    beat({ method: "getSignaturesForAddress", ok: true, rows: signatures.length });
  } catch (error) {
    errors.push({ method: "getSignaturesForAddress", message: error.message, code: error.code || null });
    beat({ method: "getSignaturesForAddress", ok: false, error: error.message, code: error.code || null });
    return { dataHealth: "signatures_unavailable", slot, events, errors, heartbeat, calls, synthetic: false };
  }

  const ok = signatures.filter((row) => row && !row.err && row.signature).slice(0, maxTransactions);
  const failedInPage = signatures.filter((row) => row?.err).length;
  for (const row of ok) {
    try {
      await sleep(spacingMs);
      const tx = await rpc("getTransaction", [row.signature, { encoding: "json", maxSupportedTransactionVersion: 1, commitment: "confirmed" }]);
      const decoded = decodeTransaction(tx, row.signature);
      events.push(...decoded);
      beat({ method: "getTransaction", ok: true, signature: row.signature, rows: decoded.length });
    } catch (error) {
      errors.push({ method: "getTransaction", signature: row.signature, message: error.message, code: error.code || null });
      beat({ method: "getTransaction", ok: false, signature: row.signature, error: error.message, code: error.code || null });
      if (error.code === "PAPER_RPC_BUDGET") break;
    }
  }

  events.sort((a, b) => {
    const ta = a.blockTime ?? 0;
    const tb = b.blockTime ?? 0;
    if (ta !== tb) return ta - tb;
    return String(a.signature).localeCompare(String(b.signature));
  });

  const quotes = events.filter((event) => event.kind === "quote" || event.kind === "create").length;
  let dataHealth = "ok";
  if (!quotes) dataHealth = errors.length ? "no_quotes_with_errors" : "no_trade_events";
  if (errors.some((error) => error.code === "PAPER_RPC_429" || error.message === "429")) dataHealth = quotes ? "partial_rate_limited" : "rate_limited";

  return {
    dataHealth,
    synthetic: false,
    endpoint: "https://api.mainnet-beta.solana.com",
    slot,
    signaturePage: signatures.length,
    failedInPage,
    transactionsFetched: ok.length - errors.filter((error) => error.method === "getTransaction").length,
    events,
    errors,
    heartbeat,
    calls,
    recordedAt: new Date().toISOString(),
  };
}
