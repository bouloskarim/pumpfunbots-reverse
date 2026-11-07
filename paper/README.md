# Paper evaluation

Offline replay of the sniper, copy-trader, and graduation-sniper rules. It does not import the RPC client, the wallet loader, or the transaction builder, and it has no code path that signs or broadcasts.

Books start at $1000 of virtual equity, converted at 150 USD per SOL only inside fixtures. That rate is marked non-empirical. Each strategy has its own book. Source-code defaults are the baseline (`SNIPER_MIN_DEV_BUY` code default is 0; the `.env.example` value 0.5 is a separate profile).

```bash
npm ci --ignore-scripts
npm run paper:test
npm run paper:audit
node paper/replay.mjs paper/fixtures/fixture-flat-roundtrip.json sniper
npm run paper:forward   # exits 2; does not start a trial
```

`npm run paper:audit` writes:

- `paper/out/dashboard.html` — static snapshot, not a server
- `paper/out/report.json` — full fixture runs
- `paper/out/forward-status.json`
- `audit/results.json` — compact machine-readable summary

Fixture nets are mechanism checks. They are not observed trading results. A 24-hour forward run is not started from this package; `paper/forward.mjs` only prints the blockers.
