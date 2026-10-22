/**
 * Conviction Gym — evaluation harness.
 *
 * Runs a Policy through an episode and scores the trajectory with the same
 * metrics vocabulary as the agent's backtest/edge-report (return, Sharpe,
 * max drawdown, win rate, profit factor) so policy comparisons are honest.
 */

import { ConvictionGymEnv } from "./env.js";
import type { Policy } from "./policies.js";
import type {
  EnvConfig,
  EnvStepResult,
  EpisodeSpec,
  GymTrade,
  TrajectoryStep,
} from "./types.js";

export interface EpisodeResult {
  episodeId: string;
  policy: string;
  startDate: string;
  endDate: string;
  initialValueUsd: number;
  finalValueUsd: number;
  totalReturnPercent: number;
  maxDrawdownPercent: number;
  sharpeRatio: number;
  winRate: number;
  profitFactor: number;
  trades: number;
  gasUsd: number;
  cumulativeReward: number;
  invalidActions: number;
  tradeLog: GymTrade[];
  steps: number;
}

export interface Rollout {
  result: EpisodeResult;
  trajectory: TrajectoryStep[];
}

export async function runEpisode(
  env: ConvictionGymEnv,
  policy: Policy,
  episode: EpisodeSpec,
  opts: { recordText?: boolean; reasoningForStep?: (i: number) => string | undefined } = {},
): Promise<Rollout> {
  let obs = env.reset(episode);
  const trajectory: TrajectoryStep[] = [];
  let cumulativeReward = 0;
  let invalidActions = 0;
  const value0 = obs.portfolio.totalValueUsd;
  const dailyValues: number[] = [];
  const tradeLog: GymTrade[] = [];

  for (let i = 0; i < episode.days.length; i++) {
    const text = opts.recordText ? env.render(obs) : "";
    const action = await policy.act(obs, env);
    const step: EnvStepResult = env.step(action);
    cumulativeReward += step.reward;
    if (step.info.invalidAction) invalidActions += 1;
    tradeLog.push(...step.info.trades);
    trajectory.push({
      step: i,
      date: obs.date,
      observationText: text,
      observation: opts.recordText ? undefined : obs,
      reasoning: policy.lastReasoning ?? opts.reasoningForStep?.(i),
      action,
      reward: step.reward,
      portfolioValueUsd: step.info.totalValueUsd,
      usage: policy.lastUsage,
    });
    obs = step.observation;
    dailyValues.push(step.info.totalValueUsd);
    if (step.done) break;
  }

  const final = dailyValues[dailyValues.length - 1] ?? value0;
  const returns = dailyValues.map((v) => (v / value0) - 1);
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + Math.pow(r - mean, 2), 0) / returns.length;
  const sharpe = variance === 0 ? 0 : (mean / Math.sqrt(variance)) * Math.sqrt(365);

  let peak = value0;
  const maxDrawdown = dailyValues.reduce((max, v) => {
    if (v > peak) peak = v;
    return Math.max(max, (peak - v) / peak);
  }, 0);

  const exits = tradeLog.filter((t) => t.type !== "entry");
  const wins = exits.filter((t) => t.pnlUsd > 0);
  const losses = exits.filter((t) => t.pnlUsd < 0);
  const grossProfit = wins.reduce((s, t) => s + t.pnlUsd, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnlUsd, 0));

  return {
    result: {
      episodeId: episode.id,
      policy: policy.name,
      startDate: episode.days[0].date,
      endDate: episode.days[episode.days.length - 1].date,
      initialValueUsd: value0,
      finalValueUsd: final,
      totalReturnPercent: ((final - value0) / value0) * 100,
      maxDrawdownPercent: maxDrawdown * 100,
      sharpeRatio: sharpe,
      winRate: exits.length > 0 ? wins.length / exits.length : 0,
      profitFactor: grossLoss === 0 ? (grossProfit === 0 ? 0 : grossProfit) : grossProfit / grossLoss,
      trades: tradeLog.length,
      gasUsd: tradeLog.length * env.config.gasUsd,
      cumulativeReward,
      invalidActions,
      tradeLog,
      steps: dailyValues.length,
    },
    trajectory,
  };
}

/** Run a policy across episodes and average the headline metrics. */
export async function runPolicyAcross(
  envConfig: Partial<EnvConfig>,
  makePolicy: () => Policy,
  episodes: EpisodeSpec[],
): Promise<EpisodeResult[]> {
  const out: EpisodeResult[] = [];
  for (const ep of episodes) {
    out.push((await runEpisode(new ConvictionGymEnv(envConfig), makePolicy(), ep)).result);
  }
  return out;
}
