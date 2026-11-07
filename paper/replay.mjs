#!/usr/bin/env node
// Replay one synthetic scenario JSON. Refuses empirical:true.
// node paper/replay.mjs paper/fixtures/flat-roundtrip.json sniper

import fs from "node:fs";
import { runScenario } from "./engine.mjs";

const file = process.argv[2];
const strategy = process.argv[3] || "sniper";
if (!file) {
  console.error("Usage: node paper/replay.mjs <scenario.json> <sniper|copy|graduation>");
  process.exit(1);
}
const scenario = JSON.parse(fs.readFileSync(file, "utf8"));
const result = runScenario(scenario, { strategy, equityUsd: 1000 });
process.stdout.write(`${JSON.stringify({ ...result, equityCurve: result.equityCurve, logs: result.logs }, null, 2)}\n`);
