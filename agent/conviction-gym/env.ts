/**
 * Conviction Gym — the environment.
 *
 * reset(episode) → observation
 * step(action)   → { observation, reward, done, info }
 * render()       → text observation for LLM agents (Beam's 1M context can
 *                  hold an entire episode's text history if desired)
 *
 * Order of operations inside step():
 *   1. accrue the day's prices onto open positions
 *   2. assisted mode: env applies production risk tiers (auto exits)
 *   3. apply the agent's action (enter / exit_full / exit_partial / hold)
 *   4. auto-harvest when the bankroll is critical or the book is full
 *   5. settle the day, compute reward
 */

import {
  scoreTokenConviction,
  type ConvictionSignal,
} from "../lib/conviction-signal.js";
import { computeRSI14, type SosovalueKline } from "../lib/data-providers.js";
import {
  accrueAll,
  applyRiskTiers,
  autoHarvest,
  executeEntry,
  executeExit,
  initialSimState,
  maxEntryUsd,
  positionValueUsd,
  settleDay,
  totalValue,
  type SimState,
} from "./simulator.js";
import {
  DEFAULT_ENV_CONFIG,
  type EnvAction,
  type EnvConfig,
  type EnvObservation,
  type EnvStepResult,
  type EpisodeSpec,
  type GymTrade,
  type PositionObservation,
  type TokenObservation,
} from "./types.js";

export const SIZE_FRACTIONS: Record<EnvAction["size"], number> = {
  small: 0.25,
  standard: 0.5,
  max: 1.0,
};

export class ConvictionGymEnv {
  readonly config: EnvConfig;
  private episode: EpisodeSpec | null = null;
  private state: SimState | null = null;
  private stepIdx = 0;

  constructor(config: Partial<EnvConfig> = {}) {
    this.config = { ...DEFAULT_ENV_CONFIG, ...config };
  }

  get symbols(): string[] {
    return this.episode?.symbols ?? [];
  }

  /** Action space shape: MultiDiscrete([K, 4, 3]). */
  get actionSpaceShape(): [number, number, number] {
    return [this.symbols.length, 4, 3];
  }

  reset(episode: EpisodeSpec): EnvObservation {
    this.episode = episode;
    this.state = initialSimState(this.config);
    this.stepIdx = 0;
    return this.buildObservation();
  }

  step(action: EnvAction): EnvStepResult {
    if (!this.episode || !this.state) throw new Error("call reset() before step()");
    const day = this.episode.days[this.stepIdx];
    if (!day) throw new Error("episode exhausted — call reset()");

    const trades: GymTrade[] = [];
    const priceMap = new Map(day.quotes.map((q) => [q.symbol.toUpperCase(), q.price]));
    const info: EnvStepResult["info"] = {
      trades,
      totalValueUsd: 0,
      dailyReturnPercent: 0,
    };

    // 1. accrue prices
    accrueAll(this.state, priceMap);

    // 2. assisted physics
    if (this.config.mode === "assisted") {
      applyRiskTiers(this.state, this.config, priceMap, day.date, trades);
    }

    // 3. agent action
    const invalid = this.applyAction(action, priceMap, day.date, day.timestamp, trades);
    if (invalid) info.invalidAction = invalid;

    // 4. auto-harvest (bankroll physics — always on, it's a constraint of the
    //    venue the env models, not a policy)
    autoHarvest(this.state, this.config, priceMap, day.date, trades);

    // 5. settle + reward
    const value = totalValue(this.state, priceMap);
    const prev = this.state.prevValueUsd;
    const dailyReturn = prev > 0 ? Math.log(value / prev) * 100 : 0;
    settleDay(this.state, value);

    const drawdown = (this.state.peakValueUsd - value) / this.state.peakValueUsd;
    let reward = dailyReturn - this.config.drawdownPenaltyLambda * drawdown * 100;
    if (this.config.thesisBonus) reward += this.thesisBonusReward(trades);
    if (invalid) reward -= 0.05; // small invalid-action penalty

    this.stepIdx += 1;
    info.totalValueUsd = value;
    info.dailyReturnPercent = dailyReturn;

    return {
      observation: this.buildObservation(),
      reward,
      done: this.stepIdx >= this.episode.days.length,
      info,
    };
  }

  private applyAction(
    action: EnvAction,
    priceMap: Map<string, number>,
    day: string,
    timestamp: number,
    trades: GymTrade[],
  ): string | null {
    const state = this.state!;
    const symbol = this.symbols[action.symbolIndex]?.toUpperCase();
    if (!symbol) return `symbolIndex ${action.symbolIndex} out of range`;
    const price = priceMap.get(symbol) ?? 0;
    const pos = state.positions.find((p) => p.symbol.toUpperCase() === symbol);

    switch (action.op) {
      case "hold":
        return null;
      case "enter": {
        if (pos) return `${symbol} already held`;
        if (state.positions.length >= this.config.maxOpenPositions) return "book full";
        if (price <= 0) return `no price for ${symbol}`;
        const portfolioValue = totalValue(state, priceMap);
        const cap = maxEntryUsd(state, this.config, portfolioValue);
        const sizeUsd = cap * SIZE_FRACTIONS[action.size];
        const opened = executeEntry(
          state, this.config, symbol, price, sizeUsd, day,
          this.stepIdx + 1, timestamp, trades,
        );
        return opened ? null : `entry rejected (bankroll: ${cap.toFixed(2)} cap)`;
      }
      case "exit_full":
      case "exit_partial": {
        if (!pos) return `no open position in ${symbol}`;
        if (price <= 0) return `no price for ${symbol}`;
        const fraction = action.op === "exit_full" ? 1.0 : 0.33;
        executeExit(
          state, this.config, pos, price, day,
          action.op === "exit_full" ? "exit_agent" : "exit_partial",
          fraction, "agent", trades,
        );
        state.positions = state.positions.filter((p) => p.amountUsd > 0.01);
        return null;
      }
    }
  }

  /**
   * Optional thesis shaping ("early, not wrong"): a small bonus when a
   * position that weathered drawdown is now being harvested/exited in
   * profit — rewards holding behavior rather than jittery exits.
   */
  private thesisBonusReward(trades: GymTrade[]): number {
    let bonus = 0;
    for (const t of trades) {
      if (t.type === "entry" || t.pnlUsd <= 0) continue;
      bonus += 0.02;
    }
    return bonus;
  }

  // ===========================================================================
  // Observation
  // ===========================================================================

  private buildObservation(): EnvObservation {
    const episode = this.episode!;
    const state = this.state!;
    const day = episode.days[this.stepIdx] ?? episode.days[episode.days.length - 1];
    const priceMap = new Map(day.quotes.map((q) => [q.symbol.toUpperCase(), q.price]));
    const held = new Set(state.positions.map((p) => p.symbol.toUpperCase()));

    const tokens: TokenObservation[] = day.quotes.map((q) => {
      const klines = day.klines[q.symbol.toUpperCase()];
      const rsi14 = klines && klines.length >= 15 ? computeRSI14(klines) : null;
      const conviction: ConvictionSignal = scoreTokenConviction(
        q, day.regime, undefined, null, rsi14,
      );
      return {
        symbol: q.symbol.toUpperCase(),
        priceUsd: q.price,
        percentChange1h: q.percentChange1h,
        percentChange24h: q.percentChange24h,
        percentChange7d: q.percentChange7d,
        marketCap: q.marketCap,
        volume24h: q.volume24h,
        rsi14,
        conviction,
      };
    });

    const positions: PositionObservation[] = state.positions.map((p) => {
      const price = priceMap.get(p.symbol.toUpperCase()) ?? 0;
      return {
        symbol: p.symbol.toUpperCase(),
        entryPriceUsd: p.entryPriceUsd,
        currentPriceUsd: price,
        amountUsd: p.amountUsd,
        unrealizedPnLPercent:
          p.entryPriceUsd > 0 ? ((price - p.entryPriceUsd) / p.entryPriceUsd) * 100 : 0,
        drawdownFromPeakPercent:
          p.peakPriceUsd > 0 ? ((p.peakPriceUsd - price) / p.peakPriceUsd) * 100 : 0,
        cyclesHeld: p.cyclesHeld,
        partialProfitTaken: p.partialProfitTaken,
      };
    });

    const value = totalValue(state, priceMap);
    return {
      step: this.stepIdx,
      date: day.date,
      regime: day.regime,
      tokens: tokens.sort((a, b) => b.conviction.score - a.conviction.score),
      portfolio: {
        cashUsd: state.cashUsd,
        bnbUsd: state.bnbUsd,
        totalValueUsd: value,
        drawdownFromPeakPercent:
          state.peakValueUsd > 0 ? ((state.peakValueUsd - value) / state.peakValueUsd) * 100 : 0,
        positions,
        openSlots: this.config.maxOpenPositions - positions.length,
        maxEntryUsd: maxEntryUsd(state, this.config, value),
      },
    };
  }

  /** Text rendering of the current observation — the LLM-agent interface. */
  render(obs: EnvObservation): string {
    const lines: string[] = [];
    lines.push(
      `Day ${obs.step + 1} (${obs.date}) | regime: ${obs.regime.fearLevel}` +
      ` (score ${obs.regime.score}/100${obs.regime.fearGreedIndex != null ? `, FGI ${obs.regime.fearGreedIndex}` : ""})`,
    );
    lines.push(
      `Portfolio: $${obs.portfolio.totalValueUsd.toFixed(2)}` +
      ` (BNB $${obs.portfolio.bnbUsd.toFixed(2)}, dd ${obs.portfolio.drawdownFromPeakPercent.toFixed(1)}%,` +
      ` slots ${obs.portfolio.openSlots}, max entry $${obs.portfolio.maxEntryUsd.toFixed(2)})`,
    );
    if (obs.portfolio.positions.length > 0) {
      lines.push("Open positions:");
      for (const p of obs.portfolio.positions) {
        lines.push(
          `  ${p.symbol}: ${p.unrealizedPnLPercent >= 0 ? "+" : ""}${p.unrealizedPnLPercent.toFixed(1)}%` +
          ` (basis $${p.amountUsd.toFixed(2)}, held ${p.cyclesHeld}d,` +
          ` dd-from-peak ${p.drawdownFromPeakPercent.toFixed(1)}%${p.partialProfitTaken ? ", partial taken" : ""})`,
        );
      }
    }
    lines.push("Market (ranked by conviction):");
    for (const t of obs.tokens) {
      const c = t.conviction;
      lines.push(
        `  ${t.symbol} $${t.priceUsd < 1 ? t.priceUsd.toPrecision(3) : t.priceUsd.toFixed(2)}` +
        ` | 7d ${t.percentChange7d >= 0 ? "+" : ""}${t.percentChange7d.toFixed(1)}%` +
        ` 24h ${t.percentChange24h >= 0 ? "+" : ""}${t.percentChange24h.toFixed(1)}%` +
        `${t.rsi14 != null ? ` RSI ${Math.round(t.rsi14)}` : ""}` +
        ` | score ${c.score} [con ${c.breakdown.contrarian} rsi ${c.breakdown.rsi}` +
        ` qual ${c.breakdown.quality} reg ${c.breakdown.regime}` +
        `${c.breakdown.volatilityPenalty > 0 ? ` vol −${c.breakdown.volatilityPenalty}` : ""}]`,
      );
    }
    return lines.join("\n");
  }
}
