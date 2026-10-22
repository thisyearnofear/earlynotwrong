/**
 * Conviction Gym — shared types.
 *
 * An RL environment built from the Early, Not Wrong conviction trading
 * harness. Unlike the backtest (where the policy is baked into the sim
 * loop), the environment here owns ONLY the physics: mark-to-market,
 * slippage, gas, bankroll constraints. Every decision — enter, exit,
 * partial, hold — is an agent action.
 *
 * Designed for two agent classes:
 *   - RL policies (structured observation → discrete action)
 *   - LLM agents like Beam (text-rendered observation → JSON action)
 */

import type { TokenQuote, SosovalueKline } from "../lib/data-providers.js";
import type { MarketRegime, ConvictionSignal, HeldPosition } from "../lib/conviction-signal.js";

// =============================================================================
// Episodes — packaged market data the env replays
// =============================================================================

/** One trading day in one episode. */
export interface EpisodeDay {
  date: string;
  timestamp: number;
  quotes: TokenQuote[];
  /** 30-day kline slices per symbol, keyed by SYMBOL. Used for real RSI(14). */
  klines: Record<string, SosovalueKline[]>;
  /** Precomputed regime for this day (score + fearLevel + FGI). */
  regime: MarketRegime;
  /** Fear & Greed index actually observed that day (from alternative.me). */
  fearGreedIndex: number | null;
}

/** A replayable episode: a contiguous window of market days. */
export interface EpisodeSpec {
  id: string;
  symbols: string[];
  days: EpisodeDay[];
  /** Where the price history came from. */
  source: "coingecko" | "sosovalue" | "synthetic";
  /** Optional split label so train/eval episodes don't overlap. */
  split?: "train" | "eval" | string;
}

// =============================================================================
// Actions
// =============================================================================

/** Operation applied to a symbol on a given day. */
export type EnvOp = "hold" | "enter" | "exit_full" | "exit_partial";

/** Size bucket for `enter` ops (fraction of max allowed entry size). */
export type EnvSize = "small" | "standard" | "max";

/**
 * Flat action: one decision per step.
 *
 * Gym-space mapping (MultiDiscrete([K, 4, 3])):
 *   symbolIndex ∈ [0, K)   op ∈ {hold, enter, exit_full, exit_partial}
 *   size ∈ {small=0.25, standard=0.5, max=1.0} of the max allowed entry
 */
export interface EnvAction {
  symbolIndex: number;
  op: EnvOp;
  size: EnvSize;
}

// =============================================================================
// Observation
// =============================================================================

export interface TokenObservation {
  symbol: string;
  priceUsd: number;
  percentChange1h: number;
  percentChange24h: number;
  percentChange7d: number;
  marketCap: number;
  volume24h: number;
  rsi14: number | null;
  /** Deterministic conviction score + factor breakdown (0 when held). */
  conviction: ConvictionSignal;
}

export interface PositionObservation {
  symbol: string;
  entryPriceUsd: number;
  currentPriceUsd: number;
  amountUsd: number;
  unrealizedPnLPercent: number;
  drawdownFromPeakPercent: number;
  cyclesHeld: number;
  partialProfitTaken: boolean;
}

export interface EnvObservation {
  step: number;
  date: string;
  regime: MarketRegime;
  tokens: TokenObservation[];
  portfolio: {
    cashUsd: number;
    bnbUsd: number;
    totalValueUsd: number;
    drawdownFromPeakPercent: number;
    positions: PositionObservation[];
    openSlots: number;
    /** Max USD that could be deployed into a new position this step. */
    maxEntryUsd: number;
  };
}

// =============================================================================
// Config + step result
// =============================================================================

export interface EnvConfig {
  /** "full-control": agent makes every exit decision.
   *  "assisted": env auto-applies the production risk tiers
   *  (stop −35%, partial +50%/33%, trail +100% peak/30% give-back) each
   *  step before the agent's action. */
  mode: "assisted" | "full-control";
  initialBnbUsd: number;
  initialCashUsd: number;
  slippageBps: number;
  gasUsd: number;
  maxOpenPositions: number;
  /** Fraction of portfolio value a single entry may consume. */
  maxPositionFraction: number;
  /** Fraction of (bnb − reserve) a single entry may consume. */
  maxTradeFractionOfBnb: number;
  minBnbReserveUsd: number;
  /** Auto-harvest weakest position when bnb < harvestBelowFraction × initial. */
  harvestBelowFraction: number;
  /** Reward shaping: λ × daily drawdown from running peak subtracted. */
  drawdownPenaltyLambda: number;
  /** When true, adds a small thesis bonus for holding through recovered
   *  drawdown ("early, not wrong" shaping). */
  thesisBonus: boolean;
}

export const DEFAULT_ENV_CONFIG: EnvConfig = {
  mode: "assisted",
  initialBnbUsd: 1000,
  initialCashUsd: 0,
  slippageBps: 100,
  gasUsd: 1.5,
  maxOpenPositions: 5,
  maxPositionFraction: 0.15,
  maxTradeFractionOfBnb: 0.5,
  minBnbReserveUsd: 20,
  harvestBelowFraction: 0.25,
  drawdownPenaltyLambda: 0.1,
  thesisBonus: false,
};

export interface EnvStepResult {
  observation: EnvObservation;
  /** Daily log return of portfolio value × 100, minus drawdown penalty. */
  reward: number;
  done: boolean;
  info: {
    trades: GymTrade[];
    invalidAction?: string;
    totalValueUsd: number;
    dailyReturnPercent: number;
  };
}

export interface GymTrade {
  day: string;
  symbol: string;
  type: "entry" | "exit_stop" | "exit_partial" | "exit_trail" | "exit_harvest" | "exit_agent";
  amountUsd: number;
  pnlUsd: number;
  priceUsd: number;
  /** "env" = applied by assisted-mode physics; "agent" = the policy's action. */
  actor: "env" | "agent";
}

/** Serialized trajectory step for Beam trace datasets. */
export interface TrajectoryStep {
  step: number;
  date: string;
  observationText: string;
  observation?: EnvObservation;
  reasoning?: string;
  action: EnvAction;
  reward: number;
  portfolioValueUsd: number;
  /** Token usage for LLM policies (dial/cost analysis). */
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    reasoningTokens?: number;
    latencyMs?: number;
  };
}
