# Persistent-host package

This directory is the paper runner for a machine that stays up. The cloud agent VM is not that machine. Nothing in this repo starts the 24-hour clock.

## What it will do when armed

- Read `https://api.mainnet-beta.solana.com` only. `RPC_URL` is ignored. No API key.
- Record real transaction logs with a small call budget and backoff on HTTP 429.
- Paper-trade **one** strategy: the sniper, corrected costs, code defaults (`0.1` SOL, take-profit `2.0x`, stop-loss `0.5x`, timeout `120s`, dev-buy filter `0`).
- Enter only when a log contains `BondingCurveV3` or `BondingCurveJupiter` and a 129-byte `TradeEvent` with reserves. Otherwise the signal is rejected and no fill is invented.
- Value a position at `0` after migration or when the curve state is unknown. No PumpSwap exit is assumed.
- Write `status.json`, `heartbeat.jsonl`, `events.jsonl`.
- Set `start` only after `getSlot` succeeds. Set `autoStopAt` to that start plus 24 hours. Stop then.

## What the host must already have

1. A process that keeps running after this cloud agent exits.
2. A supervisor you already operate. This package does not install systemd, buy a server, or open a port.
3. Node.js 22+.
4. A writable state directory.
5. Outbound HTTPS to `api.mainnet-beta.solana.com`.
6. A clock close to UTC.

## Arming

From the repo root, on that host only:

```bash
npm ci --ignore-scripts
export PAPER_PERSISTENT_HOST=I_CONTROL_THIS_MACHINE
node paper/host/run.mjs --persistent-host --state ./paper-state
```

Without both the flag and the environment phrase, the process prints the requirements and exits 2. `start` stays null.

Copy and graduation are not part of this runner. There is no qualified copy-wallet list, and graduation cannot sell after the bonding curve completes.

## Smoke, which is not the 24-hour trial

```bash
npm run paper:smoke
```

That writes `paper/out/smoke-status.json` from a bounded read. It does not arm the clock.
