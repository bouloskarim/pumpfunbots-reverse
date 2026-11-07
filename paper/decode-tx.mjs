// Turn one getTransaction JSON result into quote rows. No invented reserves.

import { parseResearchTradeEvent, TRADE_EVENT_DISC } from "./parsers.mjs";

export const CREATE_INSTRUCTION_NAMES = new Set(["BondingCurveV3", "BondingCurveJupiter"]);

function instructionNames(logs) {
  const names = [];
  for (const line of logs) {
    const match = line.match(/Instruction: (\w+)/);
    if (match) names.push(match[1]);
  }
  return names;
}

export function decodeTransaction(tx, signature) {
  const logs = tx?.meta?.logMessages || [];
  const names = instructionNames(logs);
  const createVerified = names.some((name) => CREATE_INSTRUCTION_NAMES.has(name));
  const migrated = names.includes("MigrateBondingCurveCreator");
  const rows = [];
  const blockTime = tx?.blockTime;
  const ts = Number.isFinite(blockTime) ? new Date(blockTime * 1000).toISOString() : null;
  for (const line of logs) {
    if (!line.startsWith("Program data: ")) continue;
    const raw = Buffer.from(line.slice(14), "base64");
    if (raw.length < 8 || !raw.subarray(0, 8).equals(TRADE_EVENT_DISC)) continue;
    if (raw.length < 129) {
      rows.push({
        source: "public-rpc",
        synthetic: false,
        signature,
        slot: tx?.slot ?? null,
        ts,
        kind: "undecoded",
        reason: "trade_event_shorter_than_129",
        instructionNames: names,
        feeLamports: tx?.meta?.fee ?? null,
        err: tx?.meta?.err ?? null,
      });
      continue;
    }
    const parsed = parseResearchTradeEvent(raw);
    const instructionSide = names.some((name) => name.startsWith("Buy"))
      ? "buy"
      : names.some((name) => name.startsWith("Sell"))
        ? "sell"
        : null;
    const flagSide = parsed.isBuy ? "buy" : "sell";
    const sideConflict = instructionSide != null && instructionSide !== flagSide;
    const mintHex = Buffer.from(parsed.mint).toString("hex");
    rows.push({
      source: "public-rpc",
      synthetic: false,
      signature,
      slot: tx?.slot ?? null,
      ts,
      blockTime,
      mint: mintHex,
      mintEncoding: "hex",
      kind: createVerified ? "create" : "quote",
      createInstructionVerified: createVerified,
      side: sideConflict ? null : flagSide,
      sideConflict,
      user: Buffer.from(parsed.user).toString("hex"),
      virtualSol: parsed.virtualSolReserves.toString(),
      virtualToken: parsed.virtualTokenReserves.toString(),
      realSol: parsed.realSolReserves.toString(),
      realToken: parsed.realTokenReserves.toString(),
      complete: migrated ? true : false,
      instructionNames: names,
      feeLamports: tx?.meta?.fee ?? null,
      err: tx?.meta?.err ?? null,
      solAmountLamports: parsed.solLamports.toString(),
      tokenAmountRaw: parsed.tokenAmount.toString(),
    });
  }
  if (!rows.length) {
    rows.push({
      source: "public-rpc",
      synthetic: false,
      signature,
      slot: tx?.slot ?? null,
      ts,
      kind: "no_trade_event",
      instructionNames: names,
      feeLamports: tx?.meta?.fee ?? null,
      err: tx?.meta?.err ?? null,
      complete: migrated ? true : false,
    });
  }
  return rows;
}
