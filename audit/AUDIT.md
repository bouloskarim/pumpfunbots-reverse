# Paper audit — pumpfunbots-reverse

Scope is paper-only. No keypair was generated, no secret was read, no transaction was signed or broadcast, and no paid RPC was used. Work is on `bouloskarim/pumpfunbots-reverse`, not upstream `zostaff/pumpfunbots-reverse`.

## Repair status (simulator fixed, strategy not proven)

The corrected paper engine now:

- Pays the 225,000-lamport overhead when an attempt is submitted, including a buy that later misses, fails slippage, or finds the curve already complete. No tokens are granted in those cases.
- Rejects a quote with missing or non-positive reserves instead of inventing a fill.
- Attributes copy trades to `event.user` only. A log mention of the target with a different user is `attribution_mismatch`. The old mention-only behavior remains available as `attribution: "source-mention"` and is labeled as the source baseline, not the evaluation.
- Leaves a failed sell open. A completed or unknown curve is stuck and marked at 0. That mark is a valuation, not a sale, and no other venue is assumed.
- Keeps the sniper dry-run spot print as `paper/baseline.mjs` (`costsApplied: false`), separate from the corrected net.

The market runner tests **only the sniper**, at the code defaults (0.1 SOL, take-profit 2.0x, stop-loss 0.5x, timeout 120s, dev-buy filter 0). Copy is excluded: no wallet was qualified before the tape, and the README's 80% list is not a prospective list. Graduation is excluded: the virtual-SOL gauge is not a verified migration signal, and the code cannot sell after `complete`.

`npm run paper:test` — 25 passed, 0 failed.

Public RPC smoke at **2026-11-07T11:59:38.460Z**, endpoint `https://api.mainnet-beta.solana.com`, slot 466504267. Data health `ok`. Page of 20 signatures, 4 failed, 4 transactions fetched, 6 read calls, 0 errors. Instructions seen included `Buy`, `Sell`, `SellV2`, `BuyExactQuoteInV3`. **No `BondingCurveV3` or `BondingCurveJupiter`.** The sniper therefore rejected the sample (`no_verified_create_in_sample`): 3 quote rows, 0 creates, 0 attempts, **net SOL not published**. `provenStrategy: false`. `profitClaim: false`. The $1000 budget was not converted because these rows have no SOL/USD print.

The 24-hour clock is **not** armed. `start`, `end`, `autoStopAt`, and the trial heartbeat are null. Smoke heartbeats are per-call logs for this bounded read only. The host package is `paper/host/README.md`. `node paper/host/run.mjs` exits 2 without `--persistent-host` and `PAPER_PERSISTENT_HOST=I_CONTROL_THIS_MACHINE`. This VM is not a persistent host. No server was purchased or provisioned.

Synthetic corrected sniper, still not observed profits: flat tape spot print 0 SOL, corrected net **-0.003082624 SOL**. Made-up 1.882x tape spot print +0.0882 SOL, corrected net +0.0827954 SOL, exit by the 120s timeout rather than a 3-second take-profit. That positive figure is the fixture's arithmetic.

Status at generation time is in `audit/results.json` (`label: STATIC_AS_OF`). The HTML dashboard is a file, not a process.

## 24-hour forward trial

Not started.

| Field | Value |
|---|---|
| Timezone | UTC |
| Start | none |
| Planned end | none |
| Heartbeat | none |

Blockers, also in `paper/out/forward-status.json`:

1. This cloud-agent VM does not keep processes after the run. There is no supervisor to restart one. A loop started here would not be a 24-hour trial.
2. Public `https://api.mainnet-beta.solana.com` answered `getSlot` and a few paced `getTransaction` calls on 2026-11-07, then returned JSON-RPC error 429 on a burst. No Helius key is configured. A 24-hour `logsSubscribe` was not opened.
3. `data/raw/`, `data/windows.json`, and the credits ledger are not in the repo. The advertised wallet study cannot be replayed.

`node paper/forward.mjs` prints that status and exits 2. It does not open a socket.

## What was actually observed on chain

Read-only probes against the public RPC, saved in `audit/chain-probe.json`. This is not a backtest and not a win rate.

- `getSlot` returned slot 466497940.
- Of the newest 100 signatures on pump.fun `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P`, 69 had errors. A later batch of 20 had 11 errors. That is program-wide traffic, including other people's failed transactions.
- One successful transaction (`41D3pMCp…`, slot 466498020, block time 2026-11-07T11:37:12Z) logged `Instruction: SellV3` and `Program data` of 391 bytes starting `bddb7fd34ee661ee`. That prefix is `sha256("event:TradeEvent")[:8]`, the ordinary Anchor event discriminator. It is not evidence that a previous trade prefix "died."
- On that event, byte 56 was 0, virtual SOL minus real SOL was exactly 30 SOL, and virtual token minus real token was exactly 279,900,000 UI tokens. Offsets 56 / 97 / 105 / 113 / 121 match `research/analyze.py`.
- Four later trade events (lengths 390 and 391) kept the same 279,900,000 token gap, but the SOL gap was 3.708, 0.483, 12.567, and 0.240 SOL. A fixed 30 SOL virtual offset does not describe every current curve.
- Those four events had network fees of 25,000 lamports. The SellV3 sample paid 1,005,000 lamports. The bots' default overhead (priority 120,000 + tip 100,000 + signature 5,000 = 225,000 lamports) is the config constant, not a fit to these fees.
- Instruction names in the paced sample were `Sell`, `Buy`, `GetFeesWithQuoteMint`, and `TransferChecked`. `BondingCurveV3` was not in this small successful sample. That does not prove the name is unused.
- No `logsSubscribe` session was opened.

## 666 wallets / 80% win rate

The claim is not reproducible from this tree.

| Source | "80% direct high-freq" | Wallet counts |
|---|---|---|
| `README.md` bars | 89 wallets | Seven bars sum to 666 |
| `docs/article.md` | 89 wallets | Same marketing split |
| `docs/strategy-research.md` | **5 wallets**, +1.26 SOL | Seven categories sum to **595**, not 666 |

The research note's own table shows three truncated addresses for that 80% bucket, not 89. Win rate is not defined (per trade, per wallet, or per token). It says 571 of 666 wallets traded one token in the window, so most "wins" are single-window outcomes. Sell-only PnL ignores buys outside the window. Buy-only is scored as 0% because no sell was seen. `docs/wallet-analysis.md` is a different, five-wallet Helius note dated 2026-11-06. Its conclusion is that the profitable pattern is launch-and-dump and that snipers are the side that loses. The raw files it names (`data/raw/`) are gitignored and absent. No historical backtest was run. Fixtures below are not that study.

The README dry-run card ("+88.2% in 3 seconds", "3 trades, 2W/1L") has no log file. The sniper prints `take-profit ${ratio.toFixed(1)}x` only when `ratio >= SNIPER_TAKE_PROFIT`. The code default is 2.0x. A move of 1.882x formats as "1.9x" but does not cross 2.0x, so that card does not match the default exit rule.

## Seven bots

| Bot | Network | Dry-run isolation | Strategy actually implemented |
|---|---|---|---|
| Basic trader | Sends via `sendTxWithRetry` | No dry-run flag. Always `loadKeypair()` | Manual buy/sell. No paper mode |
| Monitor | `logsSubscribe` on the pump program | No key, but live socket only | Prints creates/trades. Create name and trade user come from the same log batch |
| Sniper | Socket + `getAccountInfo` even with `--dry-run` | `--dry-run` skips `sendRawTransaction` only. `loadKeypair()` is unconditional | Buy every create (dev-buy filter off unless env is set). Exit on spot ratio 2.0x / 0.5x / 120s |
| Copy trader | One `logsSubscribe` per target, plus curve fetches | Same: key required, send skipped only behind the flag | Mirrors every pump trade in a mentioned transaction. Does not require `trade.user === target`. No default wallets |
| Analytics | Socket + HTTP `0.0.0.0:3000`, CORS `*` | No key. Not a paper trader | Live event counters. Not started |
| Volume analyzer | Would call `getSignaturesForAddress` | Does not start | Import throws: `CREATE_EVENT_PREFIX` is not exported (`CREATE_EVENT_PREFIX_V2` is, and it is not `sha256("event:CreateEvent")`) |
| Graduation sniper | Socket + curve fetches | Same dry-run gap as the sniper | Buys when virtual SOL / 85 SOL is in [92, 100). Does not watch `MigrateBondingCurveCreator` |

Shared libraries:

- `lib/rpc.mjs` `sendRawTransaction` is the only send path. Sniper, copy, and graduation call it with `skipPreflight: true`.
- `lib/tx.mjs` puts a system transfer to a random Jito tip account inside the same transaction. Nothing calls a Jito `sendBundle` endpoint. The guide's bundle API is not implemented.
- `lib/wallet.mjs` can write a secret key. It was not executed. `keys/` and `.env` are gitignored.
- `lib/ws.mjs` imports `ws`, which `package.json` does not declare. npm hoists it from `@solana/web3.js`; a non-hoisted install can fail the socket bots before any trade.
- `lib/pumpfun.mjs` `buyIx` data starts with `d78f037c39e9b3b6`. The comment says that is `sha256("global:buy_v2")[:8]`. The hash is `b817ee6167c5d33d`. `sellIx` uses `33e685a4017f83ad`, which is `sha256("global:sell")`, not `sell_v2`. `PUMP_FEE_RECIPIENT` is never passed into the instruction account list. Live buys were not sent, and this audit does not supply a corrected instruction.
- Curve math charges a flat 1% each way (`sol/100`). Fee config is not read. Cashback and holder fees from the docs are not in the formula.
- `getPrice` is raw lamports / raw token units. The log label "SOL/tok" is 1000x the SOL-per-UI-token price. Ratios of two prices still cancel the unit.

Runtime destinations in bot code are the RPC URL (default `https://api.mainnet-beta.solana.com`, WebSocket scheme swapped) and, only if `.env` sets it, Helius. No other bot HTTP endpoints. Research scripts can download transaction JSON and program ELF into `data/`; they were not run. `docs/covers/render.sh` launches local Chrome and was not run. Git hooks in the repo are `.sample` files. Dependencies were installed with `npm ci --ignore-scripts` because `bigint-buffer`, `bufferutil`, and `utf-8-validate` ship install scripts. Lockfile URLs are `registry.npmjs.org`.

## Dry-run fills vs the cost model

The dry-run path stores the pre-trade spot and later prints `(laterSpot / entrySpot - 1)`. It does not subtract the 1% fee, the buy/sell impact, the 0.0001 SOL tip, the default priority fee (0.00012 SOL), or the signature fee. It does not fail transactions. Sniper dry-run will still print a spot PnL when `getBondingCurveState` returns an account, including when that account is already `complete`. The live sell path refuses a completed curve and has no PumpSwap sell. Graduation, on `complete`, returns without selling and waits for an AMM exit that is not implemented.

Harness baseline (code defaults, entry latency 0 because the code fetches immediately, live exit rule, overhead charged every attempt):

| Book | Closed | Open | Dry-run spot SOL | Modeled net SOL | Notes |
|---|---:|---:|---:|---:|---|
| Sniper, flat curve | 1 | 0 | 0 | -0.003082624 | Timeout at 121s. Spot print hides fees and impact |
| Sniper, synthetic 1.882x quote | 1 | 0 | +0.088200000 | +0.082795400 | Not observed. Default 2.0x does not fire at 3s; exit is the 121s timeout. Modeled net is lower than the spot print and is not a profit claim |
| Sniper, 1.882x, decision delayed 2s | 0 | 0 | 0 | -0.000225000 | Fill quote moved more than the 5% slippage cap. Overhead is paid, no position |
| Sniper, `.env.example` dev-buy 0.5, flat create with 0 dev buy | 0 | 0 | 0 | 0 | Code default is 0, so this profile is not the baseline |
| Graduation, virtual SOL at 80 of the 85 SOL gauge, then `complete` | 0 | 1 stuck | 0 | -0.100225000 | Marked at 0 because the live path cannot sell. 80 virtual SOL is 94% of the bot's gauge and is not "just before" an 85 real-SOL migration |
| Copy, synthetic target chosen before the tape, 0.05 SOL | 1 | 0 | +0.044100000 | +0.041474061 | Mechanism check only. Not a researched wallet |

Starting cash is `floor(1000/150 * 1e9)` lamports (6.666666666 SOL) per book. USD columns in the dashboard multiply by the same unobserved 150. Max drawdown on the flat sniper book is 0.003082624 SOL. Failing every second attempt on the flat book leaves the position open and pays a second overhead (net -0.003307624 SOL). A 2s entry delay plus a 5s stale window on a tape whose next quote is 30s later skips the buy.

The positive modeled nets exist only because the fixture prints a higher spot. They were not seen on chain. One day of paper fills, even with costs, would not establish an edge.

## Commands

```bash
npm ci --ignore-scripts
npm run paper:test
npm run paper:audit
node paper/replay.mjs paper/fixtures/fixture-flat-roundtrip.json sniper
npm run paper:forward
```

`paper:test` is 18 offline tests (curve parity with `lib/pumpfun.mjs`, discriminator hashes, parser offsets, fixture economics, missing export, claim-count mismatch, forward exit code). `paper:audit` refreshes `paper/out/dashboard.html` and `audit/results.json`.

## Still required for a real paper trial

- A host that stays up for 24 hours after this run, with a recorded UTC start and an automatic stop 24 hours later, plus a heartbeat file that outlives this VM.
- A websocket or polling source that survives longer than the public RPC's 429s, without a paid key unless that spend is explicitly in scope.
- A checked-in tape of timestamped quotes if the goal is a historical replay: mint, slot, time, virtual and real reserves, instruction name, success/failure, fee, and tip. Target wallets for copy would have to be chosen before the tape, not from the winners inside it.
- Do not point that trial at the three J7Tracker deployers in `docs/wallet-analysis.md`. That note is a different system, and it describes them as the side that sells into snipers.
