/**
 * RYO-CHAN Paper Executor (Harness Domain: ryo)
 *
 * Practice-trade executor for the hackathon. No real funds — every "fill"
 * is an append to the hash-chained reasoning ledger (`ryo-ledger.ts`),
 * so judges can replay and audit every decision the agent made.
 *
 * Position bookkeeping is local (agent/data/ryo-state.json); prices are
 * live marks from analyze_token at decision time.
 */

import type { TradeExecutor } from "./executor.js";
import type {
  ExecutorHealth,
  Portfolio,
  PositionConfig,
  RiskCheck,
  SignalWithScore,
  TradeResult,
} from "./types.js";
import { RyoClient } from "./ryo-client.js";
import {
  record,
  loadState,
  saveState,
  verifyChain,
  LEDGER_PATH,
  type PaperPosition,
} from "./ryo-ledger.js";

const STARTING_CASH_USD = 10_000;
const MAX_POSITIONS = 3;
const MAX_TRADE_FRACTION = 0.15;

function num(obj: unknown, ...keys: string[]): number | undefined {
  if (obj == null || typeof obj !== "object") return undefined;
  const stack: unknown[] = [obj];
  while (stack.length) {
    const cur = stack.pop();
    if (cur && typeof cur === "object" && !Array.isArray(cur)) {
      for (const [k, v] of Object.entries(cur as Record<string, unknown>)) {
        if (keys.some((f) => k.toLowerCase().includes(f)) && typeof v === "number") return v;
        if (v && typeof v === "object") stack.push(v);
      }
    }
  }
  return undefined;
}

export function createRyoExecutor(client: RyoClient = new RyoClient()): TradeExecutor {
  return {
    async placeOrder(signal: SignalWithScore, position: PositionConfig): Promise<TradeResult> {
      const state = loadState();
      state.cycle += 1;
      const symbol = signal.signal.symbol;
      const price = signal.signal.price;

      // Never fill at a fabricated mark — a missing price is a SKIP with the
      // gap named, not a $1 entry (null ≠ 0, and ≠ $1 either).
      if (!price || price <= 0) {
        const reason = "entry price unavailable — refusing to record a fill at a fabricated mark";
        record(state.cycle, symbol, "SKIP", signal.conviction.score, reason, {
          signal: signal.signal.metadata?.evidence,
          missingFields: signal.signal.metadata?.missingFields,
        });
        return { success: false, symbol, error: reason, timestamp: Date.now() };
      }

      const sizeUsd = Math.min(position.sizeUsd, state.cashUsd);

      if (sizeUsd < 10) {
        const reason = `insufficient paper cash ($${state.cashUsd.toFixed(0)})`;
        record(state.cycle, symbol, "SKIP", signal.conviction.score, reason, { signal: signal.signal.metadata?.evidence });
        return { success: false, symbol, error: reason, timestamp: Date.now() };
      }

      const pos: PaperPosition = {
        symbol,
        entryPriceUsd: price,
        sizeUsd,
        openedAt: new Date().toISOString(),
        peakPriceUsd: price,
      };
      state.positions.push(pos);
      state.cashUsd -= sizeUsd;
      saveState(state);

      record(state.cycle, symbol, "BUY", signal.conviction.score, signal.conviction.rationale, {
        signal: signal.signal.metadata?.evidence,
        breakdown: signal.conviction.breakdown.map((b) => `${b.name}:${b.score}/${b.maxScore}`),
        ...(signal.signal.metadata?.decisionTrace ? { decisionTrace: signal.signal.metadata.decisionTrace } : {}),
      }, { sizeUsd, priceUsd: price });

      return {
        success: true,
        orderId: `ryo-paper-${state.cycle}-${symbol}`,
        symbol,
        executedPrice: price,
        executedQuantity: sizeUsd / price,
        executedValueUsd: sizeUsd,
        timestamp: Date.now(),
      };
    },

    async closePosition(symbol: string): Promise<TradeResult> {
      const state = loadState();
      state.cycle += 1;
      const pos = state.positions.find((p) => p.symbol === symbol);
      if (!pos) return { success: false, symbol, error: "no open position", timestamp: Date.now() };

      const a = await client.tool("analyze_token", { symbol });
      const livePx = num(a.data, "price_usd", "price", "usd");
      // Exit even when the mark is unavailable (don't strand the paper book),
      // but say so — the recorded pnl is then flat-by-fallback, disclosed.
      const px = livePx ?? pos.entryPriceUsd;
      const priceFallback = livePx === undefined;
      const pnl = ((px - pos.entryPriceUsd) / pos.entryPriceUsd) * 100;
      const valueUsd = pos.sizeUsd * (1 + pnl / 100);

      state.cashUsd += valueUsd;
      state.positions = state.positions.filter((p) => p.symbol !== symbol);
      saveState(state);

      record(state.cycle, symbol, "EXIT", 0, `exit at ${pnl.toFixed(1)}% pnl${priceFallback ? " (live mark unavailable — recorded at entry)" : ""}`, {
        analyze: `analyze_token:${a.transport}`,
        ...(priceFallback ? { price_source: "entry-fallback — analyze_token returned no price" } : {}),
      }, { priceUsd: px });
      return {
        success: true,
        orderId: `ryo-paper-exit-${state.cycle}-${symbol}`,
        symbol,
        executedPrice: px,
        executedQuantity: pos.sizeUsd / pos.entryPriceUsd,
        executedValueUsd: valueUsd,
        timestamp: Date.now(),
      };
    },

    manageRisk(signal: SignalWithScore, portfolio: Portfolio): RiskCheck {
      if (portfolio.positions.length >= MAX_POSITIONS) {
        return { approved: false, reason: `max ${MAX_POSITIONS} open paper positions` };
      }
      const maxPositionUsd = Math.min(portfolio.cashUsd * MAX_TRADE_FRACTION, 1500);
      if (maxPositionUsd < 10) return { approved: false, reason: "insufficient paper cash" };
      if (signal.conviction.score <= 0) return { approved: false, reason: "safety veto or zero conviction" };
      return { approved: true, maxPositionUsd };
    },

    async healthCheck(): Promise<ExecutorHealth> {
      const chain = verifyChain();
      return {
        healthy: chain.ok,
        mode: "paper",
        details: { ledger: LEDGER_PATH, ledgerEntries: chain.entries, chainIntact: chain.ok, startingCashUsd: STARTING_CASH_USD },
      };
    },
  };
}

let _instance: TradeExecutor | null = null;
export function getRyoExecutor(): TradeExecutor {
  if (!_instance) _instance = createRyoExecutor();
  return _instance;
}
