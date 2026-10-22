/**
 * Conviction Gym — Beam rollout, trace recorder, and reasoning-effort sweep.
 *
 *   npx tsx agent/conviction-gym/run-beam.ts [--mode assisted]
 *     [--window 30] [--episode w4] [--out data/beam-traces.jsonl]
 *     [--sweep low,medium,high] [--no-baselines]
 *
 * Runs Beam-as-policy through eval episode(s), records every step's
 * observation text + reasoning + action + token usage into JSONL traces —
 * the expert-trajectory dataset for imitation learning — and prints the
 * result next to the heuristic baselines.
 *
 * --sweep runs Beam once per reasoning_effort level (separate trace files
 * per level) and prints the dial table: does more thinking buy better
 * trades? This is the sequential-decision counterpart to the single-turn
 * dial studies — the differentiator for the competition entry.
 *
 * Requires BEAM_API_KEY (or HF_TOKEN). $25 of free HF credits:
 *   https://huggingface.co/coupons/claim/HuggingFacexReflection-MiniHack
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { beamPolicy } from "./beam.js";
import { ConvictionGymEnv } from "./env.js";
import { loadEpisodes, windowEpisodes } from "./episodes.js";
import { runEpisode, runPolicyAcross, type EpisodeResult } from "./evaluate.js";
import { buyHoldPolicy, convictionPolicy, randomPolicy } from "./policies.js";
import type { EnvConfig, TrajectoryStep } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

for (const f of [resolve(__dirname, "../../.env.local"), resolve(__dirname, "../../.env")]) {
  if (!existsSync(f)) continue;
  for (const line of readFileSync(f, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

function arg(flag: string, dflt: string): string {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}

interface LevelStats {
  level: string;
  result: EpisodeResult;
  meanReasoningTokens: number;
  meanLatencyMs: number;
  truncations: number;
  holds: number;
}

async function runBeamLevel(
  mode: EnvConfig["mode"],
  episode: ReturnType<typeof windowEpisodes>[number],
  effort: string | undefined,
  outFile: string,
): Promise<LevelStats> {
  const env = new ConvictionGymEnv({ mode });
  const policy = beamPolicy(effort ? { reasoningEffort: effort } : {});
  const rollout = await runEpisode(env, policy, episode, { recordText: true });

  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, "");
  for (const step of rollout.trajectory) {
    appendFileSync(outFile, JSON.stringify({
      episode_id: rollout.result.episodeId,
      policy: rollout.result.policy,
      reasoning_effort: effort ?? "default",
      ...step,
    }) + "\n");
  }

  const usages = rollout.trajectory
    .map((s: TrajectoryStep) => s.usage)
    .filter((u): u is NonNullable<typeof u> => !!u);
  const reasonToks = usages.map((u) => u.reasoningTokens ?? 0);
  const latencies = usages.map((u) => u.latencyMs ?? 0);
  const truncations = rollout.trajectory.filter(
    (s) => s.reasoning?.startsWith("TRUNCATED"),
  ).length;
  const holds = rollout.trajectory.filter((s) => s.action.op === "hold").length;

  return {
    level: effort ?? "default",
    result: rollout.result,
    meanReasoningTokens: reasonToks.length ? reasonToks.reduce((a, b) => a + b) / reasonToks.length : 0,
    meanLatencyMs: latencies.length ? latencies.reduce((a, b) => a + b) / latencies.length : 0,
    truncations,
    holds,
  };
}

function printDialTable(stats: LevelStats[]): void {
  console.log(
    `\n${"effort".padEnd(10)} ${"return%".padStart(9)} ${"sharpe".padStart(8)} ` +
    `${"trades".padStart(7)} ${"holds".padStart(6)} ${"trunc".padStart(6)} ` +
    `${"reason_tok".padStart(11)} ${"lat_ms".padStart(8)} ${"invalid".padStart(8)}`,
  );
  console.log("-".repeat(80));
  for (const s of stats) {
    console.log(
      `${s.level.padEnd(10)} ${s.result.totalReturnPercent.toFixed(1).padStart(9)} ` +
      `${s.result.sharpeRatio.toFixed(2).padStart(8)} ${String(s.result.trades).padStart(7)} ` +
      `${String(s.holds).padStart(6)} ${String(s.truncations).padStart(6)} ` +
      `${Math.round(s.meanReasoningTokens).toString().padStart(11)} ` +
      `${Math.round(s.meanLatencyMs).toString().padStart(8)} ` +
      `${String(s.result.invalidActions).padStart(8)}`,
    );
  }
}

async function main() {
  const mode = arg("--mode", "assisted") as EnvConfig["mode"];
  const windowDays = parseInt(arg("--window", "30"), 10);
  const outPath = resolve(__dirname, arg("--out", "../data/beam-traces.jsonl"));
  const episodeFilter = arg("--episode", "");
  const baselines = !process.argv.includes("--no-baselines");
  const sweep = arg("--sweep", "");

  const base = loadEpisodes()[0];
  const episodes = windowEpisodes(base, windowDays, { evalWindows: 1 });
  const runEps = episodeFilter
    ? episodes.filter((e) => e.id.endsWith(episodeFilter))
    : episodes.filter((e) => e.split === "eval");

  if (runEps.length === 0) throw new Error("no matching episodes");
  console.log(`[beam] ${runEps.map((e) => e.id).join(", ")} — mode=${mode}`);

  if (sweep) {
    const levels = sweep.split(",").map((s) => s.trim()).filter(Boolean);
    const allStats: LevelStats[] = [];
    for (const ep of runEps) {
      for (const level of levels) {
        const file = outPath.replace(/\.jsonl$/, `-${level}.jsonl`);
        console.log(`[beam] effort=${level} @ ${ep.id}…`);
        const stats = await runBeamLevel(mode, ep, level, file);
        allStats.push(stats);
        console.log(
          `[beam] effort=${level}: return ${stats.result.totalReturnPercent.toFixed(1)}%, ` +
          `${stats.result.trades} trades, ${stats.truncations} truncated, ` +
          `~${Math.round(stats.meanReasoningTokens)} reasoning tok/step`,
        );
      }
      printDialTable(allStats.filter((s) => s.result.episodeId === ep.id));
    }
    return;
  }

  for (const ep of runEps) {
    const stats = await runBeamLevel(mode, ep, undefined, outPath);
    const r = stats.result;
    console.log(
      `[beam] ${r.episodeId}: return ${r.totalReturnPercent.toFixed(1)}%, ` +
      `sharpe ${r.sharpeRatio.toFixed(2)}, ${r.trades} trades, ` +
      `${r.invalidActions} invalid actions, reward ${r.cumulativeReward.toFixed(1)}`,
    );
    console.log(`[beam] wrote traces → ${outPath}`);

    if (baselines) {
      console.log(`[beam] running baselines on ${ep.id}…`);
      const conv = await runPolicyAcross({ mode }, convictionPolicy, [ep]);
      const rand = await runPolicyAcross({ mode }, () => randomPolicy(7), [ep]);
      const bh = await runPolicyAcross({ mode }, buyHoldPolicy, [ep]);
      const all = [r, ...conv, ...rand, ...bh];
      console.log(`\n${"policy".padEnd(30)} ${"return%".padStart(9)} ${"sharpe".padStart(8)} ${"trades".padStart(7)}`);
      for (const row of all) {
        console.log(
          `${row.policy.padEnd(30)} ${row.totalReturnPercent.toFixed(1).padStart(9)} ` +
          `${row.sharpeRatio.toFixed(2).padStart(8)} ${String(row.trades).padStart(7)}`,
        );
      }
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
