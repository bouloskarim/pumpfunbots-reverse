# Paper evaluation

Corrected sniper accounting, separate from the bot's dry-run spot print. The evaluator cannot sign or broadcast. Live bot files are unchanged.

Market data, when recorded, is sniper-only. Copy needs a wallet list chosen before the tape; the advertised 80% list is not that list. Graduation is not a market trial: a completed curve has no sell in this code, so the position is marked at 0 instead of assuming another venue.

Synthetic fixtures stay in `paper/fixtures/` and are labeled synthetic. They are not mixed into smoke results.

```bash
npm ci --ignore-scripts
npm run paper:test
npm run paper:smoke
npm run paper:audit
node paper/replay.mjs paper/fixtures/fixture-flat-roundtrip.json sniper
npm run paper:host
```

`paper:host` exits 2 unless you are on a persistent machine and you arm it. See `paper/host/README.md`.

Outputs:

- `paper/out/dashboard.html` — static, not a server
- `paper/out/smoke-status.json` — bounded public RPC read
- `audit/results.json` — machine-readable summary
- `audit/AUDIT.md` — narrative
