/**
 * Minimal backtest harness for the Early, Not Wrong conviction strategy.
 *
 * Replays historical daily SoSoValue klines through the scoring engine and a
 * simple execution simulator. Compares strategy variants:
 *   - baseline fixed weights
 *   - adaptive weights
 *   - adaptive weights + honeypot gate
 */

import { AGENT_CONFIG } from "./config.js";
import {
  scoreMarketRegime,
  scoreTokenConviction,
  evaluatePosition,
  openPosition,
  accruePosition,
  type ConvictionSignal,
  type HeldPosition,
  type MarketRegime,
  type PositionVerdict,
} from "./conviction-signal.js";
import { sosovalueClient, computeRSI14, type TokenQuote, type SosovalueKline, type GlobalMetrics, type DerivativesMetrics } from "./data-providers.js";

export interface BacktestDay {
  date: string;
  timestamp: number;
  quotes: TokenQuote[];
  regime: MarketRegime;
}

export interface BacktestConfig {
  startDate: string;
  endDate: string;
  initialBnbUsd: number;
  initialCashUsd: number;
  symbols?: string[];
  adaptiveWeights: boolean;
  honeypotGate: boolean;
  /** Fraction of candidates rejected by the simulated honeypot gate (0-1). */
  honeypotRate?: number;
  slippageBps: number;
  gasUsd: number;
  maxOpenPositions: number;
  minConvictionScore: number;
  maxTradeFractionOfBnb: number;
  minBnbReserveUsd: number;
  stopLossPercent: number;
  partialProfitGainPercent: number;
  trailingActivationGainPercent: number;
  trailingStopPercent: number;
}

export interface BacktestTrade {
  day: string;
  symbol: string;
  type: "entry" | "exit_stop" | "exit_partial" | "exit_trail" | "exit_harvest";
  amountUsd: number;
  pnlUsd: number;
  priceUsd: number;
}

export interface BacktestResult {
  variant: string;
  startDate: string;
  endDate: string;
  initialValueUsd: number;
  finalValueUsd: number;
  totalReturnPercent: number;
  maxDrawdownPercent: number;
  winRate: number;
  profitFactor: number;
  trades: number;
  gasUsd: number;
  sharpeRatio: number;
  tradeLog: BacktestTrade[];
}

interface SimState {
  cashUsd: number;
  bnbUsd: number;
  positions: HeldPosition[];
  trades: BacktestTrade[];
  gasSpentUsd: number;
  realizedPnlUsd: number;
  peakValueUsd: number;
  dailyValues: number[];
}

const DEFAULT_CONFIG: Partial<BacktestConfig> = {
  slippageBps: 100,
  gasUsd: 1.5,
  honeypotRate: 0.05,
};

function makeQuote(symbol: string, price: number, change7d: number): TokenQuote {
  return {
    id: 0,
    name: symbol,
    symbol: symbol.toUpperCase(),
    slug: symbol.toLowerCase(),
    price,
    volume24h: 0,
    marketCap: 0,
    percentChange1h: 0,
    percentChange24h: 0,
    percentChange7d: change7d,
    lastUpdated: "",
  };
}

function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function toGlobalMetrics(fgi: number): GlobalMetrics {
  return {
    fearGreedIndex: Math.round(fgi),
    totalMarketCapUsd: 2_000_000_000_000,
    btcDominance: 50,
    ethDominance: 15,
    totalVolumeUsd: 50_000_000_000,
    lastUpdated: Date.now(),
  };
}

function toDerivativesMetrics(): DerivativesMetrics {
  return {
    totalOpenInterestUsd: 0,
    totalVolume24hUsd: 0,
    btcFundingRate: 0.001,
    ethFundingRate: 0.001,
    liquidationData: null,
    lastUpdated: Date.now(),
  };
}

function synthesizeRegime(quotes: TokenQuote[]): MarketRegime {
  const returns = quotes.map((q) => q.percentChange7d).sort((a, b) => a - b);
  const median = returns.length > 0 ? returns[Math.floor(returns.length / 2)] : 0;
  const fgi = Math.max(0, Math.min(100, 50 - median * 2.5));
  return scoreMarketRegime(toGlobalMetrics(fgi), toDerivativesMetrics(), 0);
}

/**
 * Generate synthetic daily klines for backtesting when live SoSoValue data is
 * unavailable or for quick strategy comparisons. Prices follow a mean-reverting
 * random walk with occasional "fear" and "greed" regimes.
 */
export function generateSyntheticData(
  config: Pick<BacktestConfig, "startDate" | "endDate" | "symbols">
): BacktestDay[] {
  const symbols = config.symbols ?? AGENT_CONFIG.competition.eligibleTokens.slice(0, 50);
  const start = new Date(config.startDate);
  const end = new Date(config.endDate);
  const msPerDay = 24 * 60 * 60 * 1000;
  const dayCount = Math.max(1, Math.floor((end.getTime() - start.getTime()) / msPerDay) + 1);

  // Fixed seedable PRNG so the same run produces the same path.
  let seed = 42;
  const rnd = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };

  const klinesBySymbol = new Map<string, SosovalueKline[]>();
  for (const symbol of symbols) {
    const basePrice = 0.01 + rnd() * 5;
    const klines: SosovalueKline[] = [];
    let price = basePrice;
    for (let i = -30; i < dayCount; i++) {
      const ts = Math.floor((start.getTime() + i * msPerDay) / 1000);
      // Add regime drift: every ~20 days flip between fear (down drift) and greed.
      const regimeDrift = Math.floor(i / 20) % 2 === 0 ? -0.005 : 0.005;
      const dailyReturn = regimeDrift + (rnd() - 0.5) * 0.08;
      const open = price;
      price = price * (1 + dailyReturn);
      const high = Math.max(open, price) * (1 + rnd() * 0.02);
      const low = Math.min(open, price) * (1 - rnd() * 0.02);
      klines.push({ timestamp: ts, open, high, low, close: price, volume: 1_000_000 });
    }
    klinesBySymbol.set(symbol.toUpperCase(), klines);
  }

  return buildDaysFromKlines(start, dayCount, klinesBySymbol);
}

function buildDaysFromKlines(
  start: Date,
  dayCount: number,
  klinesBySymbol: Map<string, SosovalueKline[]>
): BacktestDay[] {
  const msPerDay = 24 * 60 * 60 * 1000;
  const days: BacktestDay[] = [];
  for (let i = 0; i < dayCount; i++) {
    const ts = start.getTime() + i * msPerDay;
    const d = new Date(ts);
    const quotes: TokenQuote[] = [];
    for (const [symbol, klines] of klinesBySymbol) {
      const idx = klines.findIndex((k) => k.timestamp * 1000 >= ts);
      if (idx > 0) {
        const today = klines[idx];
        const weekAgo = klines[Math.max(0, idx - 7)];
        const change7d = weekAgo.close ? ((today.close - weekAgo.close) / weekAgo.close) * 100 : 0;
        const klineSlice = klines.slice(Math.max(0, idx - 29), idx + 1);
        quotes.push(makeQuote(symbol, today.close, change7d));
        (quotes[quotes.length - 1] as any).klines = klineSlice;
      }
    }
    if (quotes.length > 0) {
      days.push({
        date: dateKey(d),
        timestamp: ts,
        quotes,
        regime: synthesizeRegime(quotes),
      });
    }
  }
  return days;
}

export async function loadHistoricalData(
  config: Pick<BacktestConfig, "startDate" | "endDate" | "symbols">
): Promise<BacktestDay[]> {
  const symbols = config.symbols ?? AGENT_CONFIG.competition.eligibleTokens.slice(0, 50);
  const start = new Date(config.startDate);
  const end = new Date(config.endDate);
  const msPerDay = 24 * 60 * 60 * 1000;
  const dayCount = Math.max(1, Math.floor((end.getTime() - start.getTime()) / msPerDay) + 1);

  const klinesBySymbol = new Map<string, SosovalueKline[]>();
  for (const symbol of symbols) {
    try {
      const klines = await sosovalueClient.fetchKlinesBySymbol(symbol, "1d", dayCount + 20);
      if (klines.length >= 15) {
        klinesBySymbol.set(symbol.toUpperCase(), klines.slice().sort((a, b) => a.timestamp - b.timestamp));
      }
    } catch {
      // Ignore individual-symbol failures; fall through to synthetic data if none load.
    }
  }

  if (klinesBySymbol.size === 0) {
    throw new Error("No historical klines could be loaded from SoSoValue");
  }

  return buildDaysFromKlines(start, dayCount, klinesBySymbol);
}

function cloneRegimeForWeights(regime: MarketRegime, adaptive: boolean): MarketRegime {
  if (adaptive) return regime;
  // Force neutral regime so computeAdaptiveWeights returns fixed/default weights.
  const neutral = scoreMarketRegime(
    toGlobalMetrics(50),
    { ...toDerivativesMetrics(), btcFundingRate: 0, ethFundingRate: 0 },
    0,
  );
  return { ...neutral, score: 50, fearLevel: "neutral" };
}

function totalValue(state: SimState): number {
  return state.cashUsd + state.bnbUsd + state.positions.reduce((s, p) => s + p.amountUsd, 0);
}

function sellPosition(
  state: SimState,
  p: HeldPosition,
  price: number,
  day: string,
  type: BacktestTrade["type"],
  fraction: number,
  gasUsd: number,
  slippageBps: number,
): number {
  const sellValue = p.amountUsd * fraction * (1 - slippageBps / 10000);
  const costBasisSold = p.amountUsd * fraction;
  const pnl = sellValue - costBasisSold;
  state.cashUsd += sellValue;
  state.realizedPnlUsd += pnl;
  state.gasSpentUsd += gasUsd;
  state.trades.push({
    day,
    symbol: p.symbol,
    type,
    amountUsd: sellValue,
    pnlUsd: pnl,
    priceUsd: price,
  });
  // Reduce the position's tracked cost basis and amount proportionally.
  p.amountUsd *= 1 - fraction;
  return pnl;
}

function runBacktestVariant(
  days: BacktestDay[],
  cfg: BacktestConfig,
  variant: string,
): BacktestResult {
  const state: SimState = {
    cashUsd: cfg.initialCashUsd,
    bnbUsd: cfg.initialBnbUsd,
    positions: [],
    trades: [],
    gasSpentUsd: 0,
    realizedPnlUsd: 0,
    peakValueUsd: cfg.initialCashUsd + cfg.initialBnbUsd,
    dailyValues: [],
  };

  const initialValue = totalValue(state);
  let cycle = 0;

  for (const day of days) {
    cycle += 1;
    const priceMap = new Map(day.quotes.map((q) => [q.symbol.toUpperCase(), q.price]));

    // 1. Accrue price history onto positions and evaluate exits.
    for (const p of state.positions) {
      const price = priceMap.get(p.symbol.toUpperCase()) ?? 0;
      if (price > 0) {
        Object.assign(p, accruePosition(p, price));
      }
    }

    const toExit: { pos: HeldPosition; verdict: PositionVerdict }[] = [];
    for (const pos of state.positions) {
      const price = priceMap.get(pos.symbol.toUpperCase()) ?? 0;
      if (price <= 0) continue;
      const verdict = evaluatePosition(pos, price);
      if (verdict.action !== "HOLD") {
        toExit.push({ pos, verdict });
      }
    }

    for (const { pos, verdict } of toExit) {
      const price = priceMap.get(pos.symbol.toUpperCase()) ?? 0;
      if (price <= 0) continue;
      const type: BacktestTrade["type"] =
        verdict.action === "EXIT_STOP" ? "exit_stop" :
        verdict.action === "EXIT_TRAIL" ? "exit_trail" : "exit_partial";
      sellPosition(state, pos, price, day.date, type, verdict.sellFraction, cfg.gasUsd, cfg.slippageBps);
      if (type === "exit_partial") {
        pos.partialProfitTaken = true;
      }
    }
    state.positions = state.positions.filter((p) => p.amountUsd > 0.01);

    // 2. Score candidates and enter the best one if we have room + BNB.
    const reserve = cfg.minBnbReserveUsd;
    const tradeableBnb = Math.max(0, state.bnbUsd - reserve);
    const portfolioValue = totalValue(state);
    const maxTradeSize = Math.min(
      portfolioValue * 0.15,
      tradeableBnb * cfg.maxTradeFractionOfBnb,
    );

    if (state.positions.length < cfg.maxOpenPositions && maxTradeSize > 1) {
      const regime = cloneRegimeForWeights(day.regime, cfg.adaptiveWeights);

      const rsiBySymbol = new Map<string, number>();
      for (const q of day.quotes) {
        const klines = (q as any).klines as SosovalueKline[] | undefined;
        if (klines && klines.length >= 15) {
          rsiBySymbol.set(q.symbol.toUpperCase(), computeRSI14(klines));
        }
      }

      const signals: ConvictionSignal[] = day.quotes
        .filter((q) => !state.positions.some((p) => p.symbol.toUpperCase() === q.symbol.toUpperCase()))
        .map((q) => {
          if (cfg.honeypotGate && Math.random() < (cfg.honeypotRate ?? 0)) {
            return { ...scoreTokenConviction(q, regime, undefined, null, rsiBySymbol.get(q.symbol.toUpperCase()) ?? null), score: 0 };
          }
          return scoreTokenConviction(q, regime, undefined, null, rsiBySymbol.get(q.symbol.toUpperCase()) ?? null);
        })
        .sort((a, b) => b.score - a.score);

      const top = signals[0];
      if (top && top.score >= cfg.minConvictionScore) {
        const price = priceMap.get(top.symbol.toUpperCase()) ?? 0;
        if (price > 0) {
          const entryUsd = Math.min(maxTradeSize, Math.max(2, state.bnbUsd - reserve));
          const pos = openPosition({
            symbol: top.symbol,
            entryPriceUsd: price,
            amountUsd: entryUsd,
            cycle,
            now: day.timestamp,
          });
          state.positions.push(pos);
          state.bnbUsd -= entryUsd;
          state.gasSpentUsd += cfg.gasUsd;
          state.trades.push({
            day: day.date,
            symbol: top.symbol,
            type: "entry",
            amountUsd: entryUsd,
            pnlUsd: 0,
            priceUsd: price,
          });
        }
      }
    }

    // 3. Harvest smallest position if BNB is critically low or at cap.
    if ((state.bnbUsd < cfg.initialBnbUsd * 0.25 || state.positions.length >= cfg.maxOpenPositions) && state.positions.length > 0) {
      const candidates = [...state.positions].sort((a, b) => a.amountUsd - b.amountUsd);
      const victim = candidates[0];
      if (victim) {
        const price = priceMap.get(victim.symbol.toUpperCase()) ?? 0;
        if (price > 0) {
          sellPosition(state, victim, price, day.date, "exit_harvest", 1, cfg.gasUsd, cfg.slippageBps);
          state.positions = state.positions.filter((p) => p.symbol !== victim.symbol);
        }
      }
    }

    const value = totalValue(state);
    state.dailyValues.push(value);
    if (value > state.peakValueUsd) state.peakValueUsd = value;
  }

  const finalValue = totalValue(state);
  const returns = state.dailyValues.map((v) => (v / initialValue) - 1);
  const avgReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
  const variance = returns.length > 0 ? returns.reduce((s, r) => s + Math.pow(r - avgReturn, 2), 0) / returns.length : 0;
  const sharpe = variance === 0 ? 0 : (avgReturn / Math.sqrt(variance)) * Math.sqrt(365);
  const maxDrawdown = state.dailyValues.reduce((max, v) => {
    const dd = (state.peakValueUsd - v) / state.peakValueUsd;
    return Math.max(max, dd);
  }, 0);

  const exitTrades = state.trades.filter((t) => t.type !== "entry");
  const winningTrades = exitTrades.filter((t) => t.pnlUsd > 0).length;
  const losingTrades = exitTrades.filter((t) => t.pnlUsd <= 0).length;
  const winRate = exitTrades.length > 0 ? winningTrades / exitTrades.length : 0;
  const grossProfit = exitTrades.filter((t) => t.pnlUsd > 0).reduce((s, t) => s + t.pnlUsd, 0);
  const grossLoss = Math.abs(exitTrades.filter((t) => t.pnlUsd < 0).reduce((s, t) => s + t.pnlUsd, 0));
  const profitFactor = grossLoss === 0 ? (grossProfit === 0 ? 0 : grossProfit) : grossProfit / grossLoss;

  return {
    variant,
    startDate: days[0]?.date ?? "",
    endDate: days[days.length - 1]?.date ?? "",
    initialValueUsd: initialValue,
    finalValueUsd: finalValue,
    totalReturnPercent: initialValue > 0 ? ((finalValue - initialValue) / initialValue) * 100 : 0,
    maxDrawdownPercent: maxDrawdown * 100,
    winRate,
    profitFactor,
    trades: state.trades.length,
    gasUsd: state.gasSpentUsd,
    sharpeRatio: sharpe,
    tradeLog: state.trades,
  };
}

export async function runBacktest(config: BacktestConfig): Promise<BacktestResult[]> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  let days: BacktestDay[];
  let dataSource = "live";
  try {
    days = await loadHistoricalData(cfg);
  } catch {
    console.warn("[backtest] Live SoSoValue klines unavailable — falling back to synthetic data");
    days = generateSyntheticData(cfg);
    dataSource = "synthetic";
  }
  if (days.length === 0) throw new Error("No historical data loaded");

  const results = [
    runBacktestVariant(days, { ...cfg, adaptiveWeights: false, honeypotGate: false }, "baseline_fixed"),
    runBacktestVariant(days, { ...cfg, adaptiveWeights: true, honeypotGate: false }, "adaptive"),
    runBacktestVariant(days, { ...cfg, adaptiveWeights: true, honeypotGate: true }, "adaptive_honeypot"),
  ];
  for (const r of results) (r as any).dataSource = dataSource;
  return results;
}
