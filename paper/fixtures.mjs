// Synthetic tapes. empirical is false on purpose. These are not market observations.

const SOL_USD = {
  usd: 150,
  empirical: false,
  note: "Arbitrary SOL/USD conversion so a book can start at $1000. Not a market print.",
};

const INITIAL = {
  virtualSol: "30000000000",
  virtualToken: "1073000000000000",
  realSol: "0",
  realToken: "793100000000000",
  complete: false,
};

// Same token reserve, virtual SOL scaled by 1.882. Spot ratio is exactly 1.882.
// This is a printed quote, not a constant-product path and not the README session.
const JUMP = {
  virtualSol: "56460000000",
  virtualToken: "1073000000000000",
  realSol: "26460000000",
  realToken: "793100000000000",
  complete: false,
};

function ev(partial) {
  return { logMention: null, devBuySol: 0, side: null, user: "nobody", ...partial };
}

export const flatRoundtrip = {
  id: "fixture-flat-roundtrip",
  empirical: false,
  provenance: "Synthetic unchanged curve. Not observed on chain. Not a profitability result.",
  solUsd: SOL_USD,
  events: [
    ev({ ts: "2026-01-01T00:00:00.000Z", slot: 1, mint: "MintFlat", kind: "create", user: "Creator", ...INITIAL }),
    ev({ ts: "2026-01-01T00:00:03.000Z", slot: 2, mint: "MintFlat", kind: "quote", ...INITIAL }),
    ev({ ts: "2026-01-01T00:02:01.000Z", slot: 3, mint: "MintFlat", kind: "quote", ...INITIAL }),
  ],
};

export const spotJump = {
  id: "fixture-spot-jump-1_882x",
  empirical: false,
  provenance: "Synthetic spot path shaped like the README's +88.2% print. The README sample is not a log file and this tape is not that session.",
  solUsd: SOL_USD,
  events: [
    ev({ ts: "2026-01-01T00:00:00.000Z", slot: 1, mint: "MintJump", kind: "create", user: "Creator", devBuySol: 0.6, ...INITIAL }),
    ev({ ts: "2026-01-01T00:00:03.000Z", slot: 10, mint: "MintJump", kind: "quote", ...JUMP }),
    ev({ ts: "2026-01-01T00:02:01.000Z", slot: 40, mint: "MintJump", kind: "quote", ...JUMP }),
  ],
};

export const graduationEarly = {
  id: "fixture-graduation-virtual-fill",
  empirical: false,
  provenance: "Synthetic reserves inside the bot's 92-100 virtual-SOL window, then a complete curve. Not an observed graduation.",
  solUsd: SOL_USD,
  events: [
    ev({
      ts: "2026-01-01T00:00:00.000Z",
      slot: 1,
      mint: "MintGrad",
      kind: "quote",
      virtualSol: "80000000000",
      virtualToken: "400000000000000",
      realSol: "50000000000",
      realToken: "120100000000000",
      complete: false,
    }),
    ev({
      ts: "2026-01-01T00:00:10.000Z",
      slot: 5,
      mint: "MintGrad",
      kind: "quote",
      virtualSol: "115000000000",
      virtualToken: "280000000000000",
      realSol: "85000000000",
      realToken: "100000000000",
      complete: true,
    }),
  ],
};

export const copyTape = {
  id: "fixture-copy-mechanism",
  empirical: false,
  provenance: "Synthetic target prints. Targets were named before the first event. Not a wallet study.",
  solUsd: SOL_USD,
  copyTargets: ["WalletA"],
  copyTargetsSelectedAt: "2025-12-31T23:00:00.000Z",
  events: [
    ev({ ts: "2026-01-01T00:00:00.000Z", slot: 1, mint: "MintCopy", kind: "quote", ...INITIAL }),
    ev({ ts: "2026-01-01T00:00:01.000Z", slot: 2, mint: "MintCopy", kind: "trade", side: "buy", user: "WalletA", logMention: "WalletA", ...INITIAL }),
    ev({ ts: "2026-01-01T00:00:04.000Z", slot: 8, mint: "MintCopy", kind: "trade", side: "sell", user: "WalletA", logMention: "WalletA", ...JUMP }),
  ],
};

export const copyLookahead = {
  ...copyTape,
  id: "fixture-copy-lookahead",
  copyTargetsSelectedAt: "2026-01-01T00:00:05.000Z",
};

export const staleGap = {
  id: "fixture-stale-gap",
  empirical: false,
  provenance: "Synthetic create followed by a quote 30s later. Not observed.",
  solUsd: SOL_USD,
  events: [
    ev({ ts: "2026-01-01T00:00:00.000Z", slot: 1, mint: "MintGap", kind: "create", user: "Creator", ...INITIAL }),
    ev({ ts: "2026-01-01T00:00:30.000Z", slot: 9, mint: "MintGap", kind: "quote", ...INITIAL }),
  ],
};
