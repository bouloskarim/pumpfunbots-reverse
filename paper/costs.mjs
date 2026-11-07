import { SOURCE_DEFAULTS } from "./defaults.mjs";

export function priorityFeeLamports(
  cuPrice = SOURCE_DEFAULTS.cuPriceMicroLamports,
  cuLimit = SOURCE_DEFAULTS.cuLimit,
) {
  return (BigInt(cuPrice) * BigInt(cuLimit)) / 1_000_000n;
}

export function tipLamports(tipSol = SOURCE_DEFAULTS.tipSol) {
  return BigInt(Math.floor(tipSol * 1e9));
}

// Priority fee + Jito tip transfer + base signature fee. Charged per attempt,
// including attempts that do not land. Protocol fee stays inside the curve.
export function txOverheadLamports(defaults = SOURCE_DEFAULTS) {
  return (
    priorityFeeLamports(defaults.cuPriceMicroLamports, defaults.cuLimit) +
    tipLamports(defaults.tipSol) +
    BigInt(defaults.signatureFeeLamports)
  );
}

export function lamportsToSol(lamports) {
  const sign = lamports < 0n ? -1 : 1;
  const abs = lamports < 0n ? -lamports : lamports;
  const whole = abs / 1_000_000_000n;
  const frac = (abs % 1_000_000_000n).toString().padStart(9, "0");
  return sign * Number(`${whole}.${frac}`);
}
