// Offline copies of the log parsers. Not wired into the live bots.

export const TRADE_EVENT_DISC = Buffer.from("bddb7fd34ee661ee", "hex");

export function parseSniperTradeEvent(data) {
  if (data.length < 89) return null;
  if (!data.subarray(0, 8).equals(TRADE_EVENT_DISC)) return null;
  const mint = data.subarray(8, 40);
  const solLamports = data.readBigUInt64LE(40);
  const tokenAmount = data.readBigUInt64LE(48);
  const flag56 = data[56];
  const user = data.subarray(57, 89);
  let virtualSolReserves = null;
  let virtualTokenReserves = null;
  if (data.length >= 113) {
    virtualSolReserves = data.readBigUInt64LE(97);
    virtualTokenReserves = data.readBigUInt64LE(105);
  }
  return { mint, solLamports, tokenAmount, flag56, user, virtualSolReserves, virtualTokenReserves };
}

// research/analyze.py layout after the 8-byte event discriminator:
// mint, sol, token, is_buy, user, timestamp i64, virtual sol, virtual token, real sol, real token.
export function parseResearchTradeEvent(data) {
  if (data.length < 129) return null;
  if (!data.subarray(0, 8).equals(TRADE_EVENT_DISC)) return null;
  let o = 8;
  const mint = data.subarray(o, o + 32); o += 32;
  const solLamports = data.readBigUInt64LE(o); o += 8;
  const tokenAmount = data.readBigUInt64LE(o); o += 8;
  const isBuy = data[o] === 1; o += 1;
  const user = data.subarray(o, o + 32); o += 32;
  const timestamp = data.readBigInt64LE(o); o += 8;
  const virtualSolReserves = data.readBigUInt64LE(o); o += 8;
  const virtualTokenReserves = data.readBigUInt64LE(o); o += 8;
  const realSolReserves = data.readBigUInt64LE(o); o += 8;
  const realTokenReserves = data.readBigUInt64LE(o);
  return {
    mint, solLamports, tokenAmount, isBuy, user, timestamp,
    virtualSolReserves, virtualTokenReserves, realSolReserves, realTokenReserves,
  };
}
