import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { calcBuyTokens as repoBuy, calcSellSol as repoSell, getPrice as repoPrice } from "../../lib/pumpfun.mjs";
import { txOverheadLamports, priorityFeeLamports, tipLamports } from "../costs.mjs";
import { calcBuyTokens, calcSellSol, fillPctOfVirtual85, getPrice } from "../curve.mjs";
import { runSourceBaseline } from "../baseline.mjs";
import { decodeTransaction } from "../decode-tx.mjs";
import { runScenario } from "../engine.mjs";
import { evaluateObservedSniper } from "../observed.mjs";
import { assertReadMethod } from "../public-rpc.mjs";
import { parseResearchTradeEvent, parseSniperTradeEvent, TRADE_EVENT_DISC } from "../parsers.mjs";
import { renderDashboard } from "../dashboard.mjs";
import { forwardStatus } from "../forward.mjs";
import {
  copyLookahead,
  copyTape,
  flatRoundtrip,
  graduationEarly,
  spotJump,
  staleGap,
} from "../fixtures.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const disc = (name) => createHash("sha256").update(name).digest().subarray(0, 8).toString("hex");
const initial = {
  virtualTokenReserves: 1_073_000_000_000_000n,
  virtualSolReserves: 30_000_000_000n,
};

test("paper curve matches lib/pumpfun.mjs and a flat round trip loses SOL", () => {
  assert.equal(calcBuyTokens(initial, 0.1), repoBuy(initial, 0.1));
  const tokens = calcBuyTokens(initial, 0.1);
  assert.equal(calcSellSol(initial, tokens), repoSell(initial, tokens));
  assert.equal(getPrice(initial), repoPrice(initial));
  assert.ok(calcSellSol(initial, tokens) < 100_000_000n);
});

test("default priority fee and tip match the constants in lib/config.mjs", () => {
  assert.equal(priorityFeeLamports(), 120_000n);
  assert.equal(tipLamports(), 100_000n);
  assert.equal(txOverheadLamports(), 225_000n);
});

test("instruction and event discriminators diverge from the comments", () => {
  const constants = fs.readFileSync(path.join(root, "lib/constants.mjs"), "utf8");
  const pump = fs.readFileSync(path.join(root, "lib/pumpfun.mjs"), "utf8");
  assert.match(constants, /bddb7fd34ee661ee/);
  assert.equal(disc("event:TradeEvent"), "bddb7fd34ee661ee");
  assert.equal(disc("event:DistributeFeeToHoldersEvent"), "e3bed7ceb0b4a584");
  assert.notEqual(disc("event:CreateEvent"), "1b72a94ddeef6e60");
  assert.equal(disc("global:sell"), "33e685a4017f83ad");
  assert.equal(disc("global:buy_v2"), "b817ee6167c5d33d");
  assert.match(pump, /d78f037c39e9b3b6/);
  assert.notEqual("d78f037c39e9b3b6", disc("global:buy_v2"));
  assert.match(pump, /33e685a4017f83ad/);
});

test("sniper-style parser skips the flag byte; research layout keeps it and the reserves", () => {
  const buf = Buffer.alloc(129);
  Buffer.from("bddb7fd34ee661ee", "hex").copy(buf, 0);
  buf.writeBigUInt64LE(295_279_788n, 40);
  buf[56] = 0;
  buf.writeBigInt64LE(1_700_000_000n, 89);
  buf.writeBigUInt64LE(37_301_928_430n, 97);
  buf.writeBigUInt64LE(862_958_070_379_526n, 105);
  buf.writeBigUInt64LE(7_301_928_430n, 113);
  buf.writeBigUInt64LE(583_058_070_379_526n, 121);
  const sniper = parseSniperTradeEvent(buf);
  const research = parseResearchTradeEvent(buf);
  assert.equal(sniper.flag56, 0);
  assert.equal(sniper.virtualSolReserves, 37_301_928_430n);
  assert.equal(research.isBuy, false);
  assert.equal(research.virtualSolReserves - research.realSolReserves, 30_000_000_000n);
  assert.equal(research.virtualTokenReserves - research.realTokenReserves, 279_900_000_000_000n);
});

test("flat tape: dry-run spot print is ~0 while costed round trip is negative", () => {
  const run = runScenario(flatRoundtrip, { strategy: "sniper", equityUsd: 1000 });
  assert.equal(run.empirical, false);
  assert.equal(run.profitClaim, false);
  assert.equal(run.edgeClaim, false);
  assert.equal(run.tradeCountClosed, 1);
  assert.equal(run.closed[0].reason, "timeout");
  assert.equal(run.closed[0].exitTs, "2026-01-01T00:02:01.000Z");
  assert.ok(Math.abs(run.closed[0].printedSpotPnlSol) < 1e-12);
  assert.ok(run.closed[0].pnlSol < 0);
  assert.ok(run.netPnlSol < 0);
  assert.ok(run.maxDrawdownSol > 0);
});

test("1.882x spot does not take profit at the default 2.0x, and printed spot exceeds net", () => {
  const run = runScenario(spotJump, { strategy: "sniper", equityUsd: 1000 });
  assert.equal(run.closed[0].reason, "timeout");
  assert.equal(run.closed[0].holdSec, 121);
  assert.ok(Math.abs(run.closed[0].printedSpotPnlSol - 0.0882) < 1e-6);
  assert.ok(run.closed[0].pnlSol < run.closed[0].printedSpotPnlSol);
  assert.equal(run.logs.some((l) => l.ts === "2026-01-01T00:00:03.000Z" && l.msg.startsWith("closed")), false);
});

test(".env.example min dev buy is not the code default and filters the flat create", () => {
  const code = runScenario(flatRoundtrip, { strategy: "sniper" });
  const envExample = runScenario(flatRoundtrip, { strategy: "sniper", minDevBuySol: 0.5 });
  assert.equal(code.tradeCountClosed, 1);
  assert.equal(envExample.tradeCountClosed, 0);
  assert.equal(envExample.tradeCountOpen, 0);
});

test("graduation window uses virtual SOL and cannot exit after complete", () => {
  assert.ok(fillPctOfVirtual85(80_000_000_000n) >= 92);
  assert.ok(fillPctOfVirtual85(80_000_000_000n) < 100);
  assert.ok(fillPctOfVirtual85(85_000_000_000n) >= 100);
  const below = {
    ...graduationEarly,
    events: [{ ...graduationEarly.events[0], virtualSol: "78000000000" }],
  };
  assert.equal(runScenario(below, { strategy: "graduation" }).tradeCountOpen, 0);
  const run = runScenario(graduationEarly, { strategy: "graduation" });
  assert.equal(run.tradeCountClosed, 0);
  assert.equal(run.tradeCountOpen, 1);
  assert.equal(run.open[0].stuck, true);
  assert.equal(run.open[0].markSol, 0);
  assert.ok(run.netPnlSol < -0.1);
});

test("copy requires a target list chosen before the tape and does not mix books", () => {
  assert.throws(() => runScenario(copyLookahead, { strategy: "copy" }), /lookahead/);
  const copy = runScenario(copyTape, { strategy: "copy" });
  const sniper = runScenario(copyTape, { strategy: "sniper" });
  assert.equal(copy.tradeCountClosed, 1);
  assert.equal(copy.closed[0].reason, "copy-sell");
  assert.equal(sniper.tradeCountClosed, 0);
  assert.throws(() => runScenario({ ...copyTape, empirical: true }, { strategy: "copy" }), /empirical/);
});

test("latency plus a stale window skips a quote that arrives after the window", () => {
  const fresh = runScenario(staleGap, { strategy: "sniper", entryLatencyMs: 2000, staleMs: null });
  const stale = runScenario(staleGap, { strategy: "sniper", entryLatencyMs: 2000, staleMs: 5000 });
  assert.equal(fresh.tradeCountOpen + fresh.tradeCountClosed, 1);
  assert.equal(stale.tradeCountOpen + stale.tradeCountClosed, 0);
  assert.ok(stale.staleSkips >= 1);
});

test("every second attempt failing leaves the flat sniper position open", () => {
  const run = runScenario(flatRoundtrip, { strategy: "sniper", failureEvery: 2 });
  assert.equal(run.tradeCountClosed, 0);
  assert.equal(run.tradeCountOpen, 1);
  assert.ok(run.failedAttempts >= 1);
});

test("unordered events are rejected", () => {
  const bad = {
    ...flatRoundtrip,
    events: [...flatRoundtrip.events].reverse(),
  };
  assert.throws(() => runScenario(bad, { strategy: "sniper" }), /not chronological/);
});

test("volume analyzer import fails because CREATE_EVENT_PREFIX is not exported", async () => {
  await assert.rejects(import("../../bots/volume-analyzer/analyzer.mjs"), /CREATE_EVENT_PREFIX/);
});

test("paper engine does not import network, wallet, or send paths", () => {
  const banned = ["@solana/web3.js", "lib/rpc.mjs", "lib/wallet.mjs", "lib/tx.mjs", "lib/ws.mjs", "sendRawTransaction", "Keypair", "generateKeypair"];
  const files = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) {
        if (name === "test" || name === "out" || name === "fixtures") continue;
        walk(full);
      } else if (name.endsWith(".mjs")) files.push(full);
    }
  };
  walk(path.join(root, "paper"));
  assert.ok(files.length > 5);
  for (const full of files) {
    const text = fs.readFileSync(full, "utf8");
    for (const token of banned) {
      assert.equal(text.includes(token), false, `${full} contains ${token}`);
    }
  }
});

test("advertised wallet counts do not match the research note, and no dataset is checked in", () => {
  const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
  const research = fs.readFileSync(path.join(root, "docs/strategy-research.md"), "utf8");
  const article = fs.readFileSync(path.join(root, "docs/article.md"), "utf8");
  const readmeCounts = [...readme.matchAll(/(\d+)%\s+(\d+)\s+wallets/g)].map((m) => ({
    win: Number(m[1]),
    wallets: Number(m[2]),
  }));
  assert.equal(readmeCounts.reduce((s, r) => s + r.wallets, 0), 666);
  assert.equal(readmeCounts.find((r) => r.win === 80).wallets, 89);
  const noteCounts = [...research.matchAll(/\*\*(\d+) кошельк\p{L}* \| Win rate: (\d+)%/gu)].map((m) => Number(m[1]));
  assert.equal(noteCounts.reduce((s, n) => s + n, 0), 595);
  assert.match(research, /5 кошельков \| Win rate: 80%/);
  assert.match(article, /89 wallets/);
  assert.equal(fs.existsSync(path.join(root, "data/raw")), false);
  assert.equal(fs.existsSync(path.join(root, "data/windows.json")), false);
  assert.match(fs.readFileSync(path.join(root, "docs/wallet-analysis.md"), "utf8"), /data\/raw/);
});

test("forward status does not claim a start, and the static dashboard says so", () => {
  const status = forwardStatus();
  assert.equal(status.started, false);
  assert.equal(status.start, null);
  assert.equal(status.heartbeat, null);
  const proc = spawnSync(process.execPath, ["paper/forward.mjs"], { cwd: root, encoding: "utf8" });
  assert.equal(proc.status, 2);
  assert.equal(JSON.parse(proc.stdout).started, false);
  const html = renderDashboard({
    generatedAt: "2026-01-01T00:00:00.000Z",
    forward: status,
    runs: [runScenario(flatRoundtrip, { strategy: "sniper" })],
  });
  assert.match(html, /STATIC SNAPSHOT — NOT LIVE/);
  assert.doesNotMatch(html, /fetch\(/);
});

test("dry-run still loads a keypair and the basic trader has no dry-run flag", () => {
  for (const rel of ["bots/sniper/sniper.mjs", "bots/copy-trader/watcher.mjs", "bots/graduation-sniper/graduation.mjs"]) {
    const text = fs.readFileSync(path.join(root, rel), "utf8");
    const loadAt = text.indexOf("const wallet = loadKeypair()");
    const dryAt = text.indexOf("if (DRY_RUN)");
    assert.ok(loadAt > 0 && dryAt > loadAt, rel);
  }
  const basic = fs.readFileSync(path.join(root, "bots/basic-trader/trade.mjs"), "utf8");
  assert.equal(basic.includes("--dry-run"), false);
  assert.match(basic, /loadKeypair\(\)/);
  assert.match(basic, /sendTxWithRetry/);
});

test("corrected copy ignores a mention that is not the trade user", () => {
  const mismatch = {
    ...copyTape,
    events: copyTape.events.map((event) => (
      event.side ? { ...event, user: "OtherWallet", logMention: "WalletA" } : event
    )),
  };
  const corrected = runScenario(mismatch, { strategy: "copy" });
  const sourceMention = runScenario(mismatch, { strategy: "copy", attribution: "source-mention" });
  assert.equal(corrected.tradeCountClosed, 0);
  assert.equal(corrected.tradeCountOpen, 0);
  assert.ok(corrected.rejections.some((row) => row.reason === "attribution_mismatch"));
  assert.equal(sourceMention.tradeCountClosed, 1);
  assert.equal(sourceMention.attribution, "source-mention");
});

test("missing reserves and a migration before fill do not invent a position", () => {
  const missing = runScenario({
    ...flatRoundtrip,
    events: [{ ...flatRoundtrip.events[0], virtualSol: null, virtualToken: null }],
  }, { strategy: "sniper" });
  assert.equal(missing.tradeCountClosed + missing.tradeCountOpen, 0);
  assert.ok(missing.rejections.some((row) => row.reason === "missing_reserves"));

  const migrated = runScenario({
    ...flatRoundtrip,
    id: "fixture-migrate-before-fill",
    events: [
      flatRoundtrip.events[0],
      { ...flatRoundtrip.events[1], ts: "2026-01-01T00:00:02.000Z", complete: true },
    ],
  }, { strategy: "sniper", entryLatencyMs: 2000 });
  assert.equal(migrated.tradeCountOpen, 0);
  assert.equal(migrated.tradeCountClosed, 0);
  assert.ok(migrated.netPnlSol < 0);
  assert.ok(migrated.rejections.some((row) => row.reason === "migrated_before_fill"));
  assert.equal(migrated.open.length, 0);
});

test("source baseline spot print omits costs that the corrected sniper applies", () => {
  const baseline = runSourceBaseline(spotJump);
  const corrected = runScenario(spotJump, { strategy: "sniper" });
  assert.equal(baseline.evaluationVariant, "source-baseline");
  assert.equal(baseline.costsApplied, false);
  assert.ok(Math.abs(baseline.printedSpotPnlSolOnCloses - 0.0882) < 1e-6);
  assert.equal(corrected.evaluationVariant, "corrected");
  assert.ok(corrected.netPnlSol < baseline.printedSpotPnlSolOnCloses);
  assert.equal(corrected.provenStrategy, false);
});

test("corrected copy without prior evidence is refused", () => {
  const bare = { ...copyTape, copyTargetEvidence: undefined };
  assert.throws(() => runScenario(bare, { strategy: "copy" }), /copyTargetEvidence/);
});

test("observed sniper sample without a verified create does not invent fills", () => {
  const result = evaluateObservedSniper([{
    source: "public-rpc",
    synthetic: false,
    signature: "sig",
    ts: "2026-11-07T11:37:12.000Z",
    kind: "quote",
    mint: "aa",
    virtualSol: "30000000000",
    virtualToken: "1073000000000000",
    complete: false,
    createInstructionVerified: false,
  }]);
  assert.equal(result.tradeCountClosed, 0);
  assert.equal(result.netPnlSol, null);
  assert.equal(result.profitClaim, false);
  assert.equal(result.provenStrategy, false);
  assert.equal(result.usdBudgetApplied, false);
  assert.ok(result.rejections.some((row) => row.reason === "no_verified_create_in_sample"));
  assert.throws(() => evaluateObservedSniper([{ synthetic: true, kind: "quote" }]), /synthetic/);
});

test("decoder keeps an observed sell and the RPC client refuses a broadcast method", () => {
  const raw = Buffer.alloc(129);
  TRADE_EVENT_DISC.copy(raw, 0);
  raw[56] = 0;
  raw.writeBigUInt64LE(30_000_000_000n, 97);
  raw.writeBigUInt64LE(1_073_000_000_000_000n, 105);
  raw.writeBigUInt64LE(1n, 113);
  raw.writeBigUInt64LE(1n, 121);
  const tx = {
    slot: 1,
    blockTime: 1794051432,
    meta: {
      fee: 25000,
      err: null,
      logMessages: ["Program log: Instruction: Sell", `Program data: ${raw.toString("base64")}`],
    },
  };
  const rows = decodeTransaction(tx, "sig");
  assert.equal(rows[0].kind, "quote");
  assert.equal(rows[0].side, "sell");
  assert.equal(rows[0].createInstructionVerified, false);
  assert.equal(rows[0].source, "public-rpc");
  assert.equal(parseResearchTradeEvent(raw).isBuy, false);
  assert.throws(() => assertReadMethod("sendTransaction"), /PAPER_RPC_FORBIDDEN|refuses/);
});

test("24h host plan stays unarmed without the operator phrase", () => {
  const proc = spawnSync(process.execPath, ["paper/host/run.mjs"], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, PAPER_PERSISTENT_HOST: "" },
  });
  assert.equal(proc.status, 2);
  const body = JSON.parse(proc.stdout);
  assert.equal(body.started, false);
  assert.equal(body.start, null);
  assert.equal(body.autoStopAt, null);
  assert.ok(body.requirements.length >= 5);
});

test("package.json does not declare ws, which lib/ws.mjs imports", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  assert.equal(pkg.dependencies.ws, undefined);
  assert.match(fs.readFileSync(path.join(root, "lib/ws.mjs"), "utf8"), /from "ws"/);
});
