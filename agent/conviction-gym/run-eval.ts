/**
 * Conviction Gym — baseline evaluation.
 *
 *   npx tsx agent/conviction-gym/run-eval.ts [--mode assisted|full-control]
 *                                             [--window 30] [--episodes data/episodes.json]
 *
 * Runs the reference policies over the eval windows and prints a comparison
 * table — the benchmark artifact for the Beam competition entry.
 */

import { ConvictionGymEnv } from "./env.js";
import { loadEpisodes, windowEpisodes } from "./episodes.js";
import { runPolicyAcross, type EpisodeResult } from "./evaluate.js";
import { buyHoldPolicy, convictionPolicy, randomPolicy } from "./policies.js";
import type { EnvConfig } from "./types.js";

function arg(flag: string, dflt: string): string {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}

function fmt(n: number, d = 1): string {
  return n.toFixed(d);
}

function printTable(rows: EpisodeResult[][]) {
  const flat = rows.flat();
  const byPolicy = new Map<string, EpisodeResult[]>();
  for (const r of flat) {
    const arr = byPolicy.get(r.policy) ?? [];
    arr.push(r);
    byPolicy.set(r.policy, arr);
  }
  console.log(
    `\n${"policy".padEnd(16)} ${"episodes".padStart(8)} ${"return%".padStart(9)} ` +
    `${"sharpe".padStart(8)} ${"maxDD%".padStart(8)} ${"winRate".padStart(8)} ` +
    `${"PF".padStart(6)} ${"trades".padStart(7)} ${"reward".padStart(8)}`,
  );
  console.log("-".repeat(88));
  for (const [name, rs] of [...byPolicy.entries()].sort(
    (a, b) => avg(b[1].map((r) => r.totalReturnPercent)) - avg(a[1].map((r) => r.totalReturnPercent)),
  )) {
    console.log(
      `${name.padEnd(16)} ${String(rs.length).padStart(8)} ` +
      `${fmt(avg(rs.map((r) => r.totalReturnPercent))).padStart(9)} ` +
      `${fmt(avg(rs.map((r) => r.sharpeRatio)), 2).padStart(8)} ` +
      `${fmt(avg(rs.map((r) => r.maxDrawdownPercent))).padStart(8)} ` +
      `${fmt(avg(rs.map((r) => r.winRate)), 2).padStart(8)} ` +
      `${fmt(avg(rs.map((r) => r.profitFactor)), 2).padStart(6)} ` +
      `${fmt(avg(rs.map((r) => r.trades)), 0).padStart(7)} ` +
      `${fmt(avg(rs.map((r) => r.cumulativeReward))).padStart(8)}`,
    );
  }
}

function avg(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

async function main() {
  const mode = arg("--mode", "assisted") as EnvConfig["mode"];
  const windowDays = parseInt(arg("--window", "30"), 10);
  const dataPath = arg("--episodes", "");

  const specs = loadEpisodes(dataPath || undefined);
  const base = specs[0];
  const episodes = windowEpisodes(base, windowDays, { evalWindows: 1 });
  const allWindows = process.argv.includes("--all");
  const evalEps = episodes.filter((e) => e.split === "eval");
  const runEps = allWindows ? episodes : evalEps.length > 0 ? evalEps : episodes;

  console.log(`[eval] ${base.id}: ${base.days.length} days, ${base.symbols.length} symbols, mode=${mode}`);
  console.log(`[eval] ${episodes.length} × ${windowDays}d windows — evaluating on ${runEps.length}${allWindows ? " (all)" : ""}`);

  const rows: EpisodeResult[][] = [];
  for (const [name, make] of [
    ["conviction", convictionPolicy],
    ["random", () => randomPolicy(7)],
    ["buy_and_hold", buyHoldPolicy],
  ] as const) {
    const rs = await runPolicyAcross({ mode }, make, runEps);
    rows.push(rs);
    for (const r of rs) {
      console.log(`[eval] ${name} @ ${r.episodeId}: return ${r.totalReturnPercent.toFixed(1)}%, sharpe ${r.sharpeRatio.toFixed(2)}, ${r.trades} trades`);
    }
  }
  printTable(rows);
}

main();
