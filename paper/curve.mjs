// Bonding-curve formulas copied from lib/pumpfun.mjs so this harness does not
// load the RPC connection module.

export function getPrice(state) {
  return Number(state.virtualSolReserves) / Number(state.virtualTokenReserves);
}

export function calcBuyTokens(state, solAmount) {
  const solLamports = BigInt(Math.floor(solAmount * 1e9));
  const fee = solLamports / 100n;
  const netSol = solLamports - fee;
  const tokens =
    (state.virtualTokenReserves * netSol) / (state.virtualSolReserves + netSol);
  return tokens;
}

export function calcSellSol(state, tokenAmount) {
  const sol =
    (state.virtualSolReserves * tokenAmount) / (state.virtualTokenReserves + tokenAmount);
  const fee = sol / 100n;
  return sol - fee;
}

export function fillPctOfVirtual85(virtualSolReserves) {
  return (Number(virtualSolReserves) / Number(85_000_000_000n)) * 100;
}
