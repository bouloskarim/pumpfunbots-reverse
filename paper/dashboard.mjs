// Static HTML snapshot. No fetch, no websocket, no refresh.

function esc(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function plain(value, digits = 6) {
  if (value == null || Number.isNaN(Number(value))) return "—";
  return Number(value).toFixed(digits);
}

function signed(value) {
  if (value == null || Number.isNaN(Number(value))) return "—";
  const n = Number(value);
  const body = n.toFixed(6);
  return n > 0 ? `+${body}` : body;
}

function smokeBlock(smoke) {
  if (!smoke) return "";
  const rej = (smoke.evaluation?.rejections || []).map((row) => row.reason).join(", ");
  return `<section>
    <h2>Public RPC smoke — data health ${esc(smoke.dataHealth)}</h2>
    <p class="meta">Recorded ${esc(smoke.recording?.recordedAt || "")}. Endpoint ${esc(smoke.recording?.endpoint || "")}. This is not a 24-hour trial. provenStrategy=${smoke.provenStrategy}. profitClaim=${smoke.profitClaim}.</p>
    <dl>
      <div><dt>Slot</dt><dd>${esc(smoke.recording?.slot ?? "—")}</dd></div>
      <div><dt>Signature page</dt><dd>${esc(smoke.recording?.signaturePage ?? "—")}</dd></div>
      <div><dt>Failed signatures in page</dt><dd>${esc(smoke.recording?.failedInPage ?? "—")}</dd></div>
      <div><dt>Transactions decoded</dt><dd>${esc(smoke.recording?.transactionsFetched ?? "—")}</dd></div>
      <div><dt>Sniper closes</dt><dd>${esc(smoke.evaluation?.tradeCountClosed ?? "—")}</dd></div>
      <div><dt>Sniper opens</dt><dd>${esc(smoke.evaluation?.tradeCountOpen ?? "—")}</dd></div>
      <div><dt>Modeled net SOL</dt><dd>${smoke.evaluation?.netPnlSol == null ? "not published" : signed(smoke.evaluation.netPnlSol)}</dd></div>
      <div><dt>RPC calls</dt><dd>${esc(smoke.recording?.calls ?? "—")}</dd></div>
    </dl>
    <p class="sub">Rejections: ${esc(rej || "none")}. ${esc(smoke.evaluation?.note || "")}</p>
  </section>`;
}

function baselineBlock(baselines) {
  if (!baselines?.length) return "";
  const body = baselines.map((row) => `<tr><td>${esc(row.scenarioId)}</td><td>${esc(row.variant)}</td><td>${signed(row.printedSpotPnlSol)}</td><td>${row.netPnlSol == null ? "—" : signed(row.netPnlSol)}</td><td>${esc(row.costsApplied)}</td></tr>`).join("");
  return `<section>
    <h2>Sniper source baseline versus corrected costs</h2>
    <p class="meta">Synthetic tapes. Source baseline is the dry-run spot ratio. Corrected applies curve fees, impact, and 0.000225 SOL overhead per submitted attempt.</p>
    <table>
      <caption>SOL, synthetic sniper only</caption>
      <thead><tr><th>Tape</th><th>Variant</th><th>Spot print SOL</th><th>Corrected net SOL</th><th>Costs applied</th></tr></thead>
      <tbody>${body}</tbody>
    </table>
  </section>`;
}

function polyline(curve) {
  if (!curve?.length) return "";
  const xs = curve.map((_, i) => i);
  const ys = curve.map((p) => p.equitySol);
  const min = Math.min(...ys);
  const max = Math.max(...ys);
  const span = max - min || 1;
  const w = 640;
  const h = 160;
  return curve
    .map((p, i) => {
      const x = (xs[i] / Math.max(xs.length - 1, 1)) * (w - 8) + 4;
      const y = h - 4 - ((p.equitySol - min) / span) * (h - 8);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

export function renderDashboard(report) {
  const rows = report.runs
    .map((run) => {
      const points = polyline(run.equityCurve);
      return `<section>
        <h2>${esc(run.scenarioId)} · ${esc(run.strategy)} · ${esc(run.variant)}</h2>
        <p class="meta">Synthetic mechanism check. SOL/USD ${esc(run.solUsdAssumption.usd)} is ${esc(run.solUsdAssumption.note)}</p>
        <dl>
          <div><dt>Closed trades</dt><dd>${run.tradeCountClosed}</dd></div>
          <div><dt>Open trades</dt><dd>${run.tradeCountOpen}</dd></div>
          <div><dt>Net PnL SOL (synthetic)</dt><dd>${signed(run.netPnlSol)}</dd></div>
          <div><dt>USD at assumed 150 rate</dt><dd>${signed(run.netPnlUsdAtAssumption)}</dd></div>
          <div><dt>Max drawdown SOL</dt><dd>${plain(run.maxDrawdownSol)}</dd></div>
          <div><dt>Dry-run spot PnL on closes</dt><dd>${signed(run.printedSpotPnlSolOnCloses)}</dd></div>
          <div><dt>Ending equity SOL</dt><dd>${plain(run.endingEquitySol)}</dd></div>
          <div><dt>Failed attempts</dt><dd>${run.failedAttempts}</dd></div>
        </dl>
        <svg viewBox="0 0 640 160" role="img" aria-label="Synthetic equity in SOL">
          <title>Synthetic equity, SOL, ${esc(run.scenarioId)} ${esc(run.strategy)} ${esc(run.variant)}</title>
          <polyline fill="none" stroke="#9a3412" stroke-width="2" points="${points}" />
        </svg>
        <table>
          <caption>Closed trades</caption>
          <thead><tr><th>Mint</th><th>Entry</th><th>Exit</th><th>Reason</th><th>Net SOL</th><th>Printed spot SOL</th><th>Hold sec</th></tr></thead>
          <tbody>
            ${run.closed.length ? run.closed.map((t) => `<tr><td>${esc(t.mint)}</td><td>${esc(t.entryTs)}</td><td>${esc(t.exitTs)}</td><td>${esc(t.reason)}</td><td>${signed(t.pnlSol)}</td><td>${signed(t.printedSpotPnlSol)}</td><td>${esc(t.holdSec)}</td></tr>`).join("") : `<tr><td colspan="7">No closed trades</td></tr>`}
          </tbody>
        </table>
        <table>
          <caption>Open trades at end of tape</caption>
          <thead><tr><th>Mint</th><th>Entry</th><th>Spent SOL</th><th>Mark SOL</th><th>Stuck after migration</th></tr></thead>
          <tbody>
            ${run.open.length ? run.open.map((t) => `<tr><td>${esc(t.mint)}</td><td>${esc(t.entryTs)}</td><td>${plain(t.spentSol)}</td><td>${plain(t.markSol)}</td><td>${t.stuck ? "yes" : "no"}</td></tr>`).join("") : `<tr><td colspan="5">No open trades</td></tr>`}
          </tbody>
        </table>
      </section>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Paper evaluation snapshot (static)</title>
<style>
  body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 24px; color: #1c1917; background: #fafaf9; }
  h1 { font-size: 1.4rem; margin-bottom: 0.2rem; }
  .banner { background: #7f1d1d; color: #fff; padding: 12px 16px; font-weight: 700; }
  .sub { color: #44403c; }
  section { background: #fff; border: 1px solid #e7e5e4; padding: 16px; margin: 16px 0; }
  dl { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
  dt { font-size: 0.75rem; color: #57534e; }
  dd { margin: 0; font-variant-numeric: tabular-nums; }
  table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 0.85rem; }
  th, td { border-bottom: 1px solid #e7e5e4; text-align: left; padding: 4px 6px; }
  svg { width: 100%; height: 160px; background: #f5f5f4; margin-top: 8px; }
  code { font-family: ui-monospace, monospace; }
</style>
</head>
<body>
  <p class="banner">STATIC SNAPSHOT — NOT LIVE. As of ${esc(report.generatedAt)}. Fixed simulator, not a proven strategy. No server, no wallet, no transaction path.</p>
  <h1>Sniper paper evaluation</h1>
  <p class="sub">The market runner tests one strategy: the sniper, at the code defaults. Copy is not run on market data because no wallet was qualified before the tape. Graduation is not run on market data because a completed curve has no implemented sell. Synthetic rows for those two strategies are mechanism checks and are not added into the sniper book.</p>
  <p class="sub">$1000 virtual capital is converted at an unobserved 150 USD/SOL only on synthetic fixtures. A positive synthetic number is not an observed profit. Public RPC rows do not include a SOL/USD print, so the smoke sample does not publish a dollar result.</p>
  <p class="sub">24-hour trial started: no. ${esc((report.forward.blockers || []).map((b) => b.id).join(", "))}</p>
  ${smokeBlock(report.smoke)}
  ${baselineBlock(report.baselines)}
  ${rows}
  <section>
    <h2>How this file was produced</h2>
    <p><code>node paper/run-all.mjs</code> writes this HTML from in-memory fixture replays. It does not listen on a port.</p>
  </section>
</body>
</html>
`;
}
