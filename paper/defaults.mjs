// Source defaults copied from the repo. This module is intentionally free of
// network, wallet, and transaction imports.

export const SOURCE_DEFAULTS = {
  slippageBps: 500, // lib/config.mjs SLIPPAGE_BPS
  cuPriceMicroLamports: 1_500_000, // lib/config.mjs CU_PRICE
  cuLimit: 80_000, // lib/config.mjs CU_LIMIT
  tipSol: 0.0001, // lib/config.mjs TIP_SOL
  signatureFeeLamports: 5_000,
  // lib/pumpfun.mjs deducts sol/100 on the way in and on the way out.
  protocolFeeBps: 100,
  sniper: {
    buySol: 0.1,
    takeProfit: 2.0,
    stopLoss: 0.5,
    timeoutSec: 120,
    maxPositions: 3,
    // bots/sniper/sniper.mjs line 46. The file comment and .env.example say 0.5.
    minDevBuySol: 0,
    cooldownSec: 10,
    pollMs: 2000,
  },
  copy: {
    buySol: 0.05,
    sellPct: 100,
    maxPositions: 5,
    // No default wallets. Empty COPY_TARGETS exits.
    targets: [],
  },
  graduation: {
    buySol: 0.1,
    minFillPct: 92,
    takeProfit: 1.5,
    stopLoss: 0.7,
    timeoutSec: 300,
    maxPositions: 3,
    cooldownSec: 30,
    pollMs: 3000,
    virtualSolLamportsAt100Pct: 85_000_000_000n,
  },
};

export const ENV_EXAMPLE = {
  sniperMinDevBuySol: 0.5,
  copyTargetsPlaceholder: ["wallet1", "wallet2"],
};
