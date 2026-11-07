#!/usr/bin/env node
// Reports why a 24-hour forward paper trial is not running.
// Does not open a socket, load a key, or wait.

export function forwardStatus() {
  return {
    started: false,
    timezone: "UTC",
    start: null,
    end: null,
    autoStopAt: null,
    heartbeat: null,
    heartbeatProof: null,
    dashboard: "not-live",
    blockers: [
      {
        id: "no_persistent_runtime",
        detail:
          "This coding run is a Cursor cloud agent VM. Nothing started here keeps running after the run ends, and there is no supervisor to restart it. A 24-hour loop was not started, so there is no start time, end time, or heartbeat.",
      },
      {
        id: "data_plane_not_durable",
        detail:
          "On 2026-11-07 the public endpoint https://api.mainnet-beta.solana.com answered getSlot and a few paced getTransaction calls, then returned JSON-RPC error 429 when transactions were requested in a burst. No Helius API key is configured. A 24-hour logsSubscribe session was not opened and is not verified.",
      },
      {
        id: "no_research_dataset",
        detail:
          "The repository has no data/raw tape, no data/windows.json, and no credits ledger. The 666-wallet study cannot be replayed from checked-in observations.",
      },
    ],
  };
}

const isMain = process.argv[1] && process.argv[1].endsWith("forward.mjs");
if (isMain) {
  process.stdout.write(`${JSON.stringify(forwardStatus(), null, 2)}\n`);
  process.exit(2);
}
