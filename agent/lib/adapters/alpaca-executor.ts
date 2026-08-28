/**
 * Alpaca Trade Executor — Options Order Adapter
 *
 * Implements the harness TradeExecutor interface for the "options" domain
 * using Alpaca's Trading API. All operations use the paper trading
 * environment (free, no card required).
 *
 * Alpaca Trading API:
 *   - POST /v2/orders          — place an order
 *   - DELETE /v2/orders/{id}   — cancel an order
 *   - POST /v2/positions/{id}/close — close a position
 *   - GET  /v2/account         — account info (buying power, status)
 *   - GET  /v2/positions       — open positions
 */

import type { TradeExecutor } from "./executor.js";
import type {
  AdapterPosition,
  ExecutorHealth,
  Portfolio,
  PositionConfig,
  RiskCheck,
  SignalWithScore,
  TradeResult,
} from "./types.js";
import { withTimeout } from "../delphi/executor.js";

const ALPACA_TRADING_BASE =
  process.env.ALPACA_API_BASE_URL ??
  (process.env.ALPACA_PAPER !== "0" ? "https://paper-api.alpaca.markets" : "https://api.alpaca.markets");

function alpacaHeaders(): Record<string, string> {
  return {
    "APCA-API-KEY-ID": process.env.ALPACA_API_KEY_ID ?? "",
    "APCA-API-SECRET-KEY": process.env.ALPACA_API_SECRET_KEY ?? "",
    "Content-Type": "application/json",
  };
}

function isConfigured(): boolean {
  return !!(process.env.ALPACA_API_KEY_ID && process.env.ALPACA_API_SECRET_KEY);
}

interface AlpacaAccount {
  status: string;
  buying_power: string;
  cash: string;
  portfolio_value: string;
}

interface AlpacaPosition {
  symbol: string;
  qty: string;
  avg_entry_price: string;
  current_price: string;
  market_value: string;
  unrealized_pl: string;
  unrealized_plpc: string;
}

interface AlpacaOrder {
  id: string;
  status: string; // "filled", "pending", "rejected", ...
  filled_avg_price: string | null;
  filled_qty: string | null;
  symbol: string;
}

async function alpacaPost(path: string, body: unknown): Promise<any> {
  const res = await withTimeout(
    fetch(`${ALPACA_TRADING_BASE}${path}`, {
      method: "POST",
      headers: alpacaHeaders(),
      body: JSON.stringify(body),
    }),
    30000,
    `alpaca:POST ${path}`,
  );
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Alpaca ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
  }
  return data;
}

async function alpacaDelete(path: string): Promise<any> {
  const res = await withTimeout(
    fetch(`${ALPACA_TRADING_BASE}${path}`, {
      method: "DELETE",
      headers: alpacaHeaders(),
    }),
    30000,
    `alpaca:DELETE ${path}`,
  );
  return res.ok;
}

async function alpacaGet(path: string): Promise<any> {
  const res = await withTimeout(
    fetch(`${ALPACA_TRADING_BASE}${path}`, { headers: alpacaHeaders() }),
    30000,
    `alpaca:GET ${path}`,
  );
  return res.json();
}

// =============================================================================
// Adapter
// =============================================================================

/**
 * Create an Alpaca-backed TradeExecutor for options trading.
 *
 * Uses paper trading by default. CLI and MCP server are alternatives — the
 * executor picks the REST API path (most reliable for programmatic agents).
 */
export function createAlpacaExecutor(): TradeExecutor {
  return {
    async placeOrder(signal: SignalWithScore, position: PositionConfig): Promise<TradeResult> {
      const now = Date.now();
      if (!isConfigured()) {
        return { success: false, symbol: signal.signal.symbol, error: "Alpaca API keys not configured", timestamp: now };
      }

      const meta = position.metadata ?? {};
      const contractSymbol = signal.signal.symbol;
      const qty = (meta.quantity as number) ?? Math.max(1, Math.floor(position.sizeUsd / (signal.signal.price || 1)));

      try {
        const orderBody: Record<string, unknown> = {
          symbol: contractSymbol,
          qty: String(qty),
          side: position.side === "long" ? "buy" : "sell",
          type: position.orderType ?? "market",
          time_in_force: "day",
        };
        if (position.orderType === "limit" && position.limitPrice) {
          orderBody.limit_price = String(position.limitPrice);
        }

        const order = await alpacaPost("/v2/orders", orderBody) as AlpacaOrder;

        return {
          success: ["filled", "pending", "accepted"].includes(order.status),
          orderId: order.id,
          symbol: contractSymbol,
          executedPrice: order.filled_avg_price ? parseFloat(order.filled_avg_price) : undefined,
          executedQuantity: order.filled_qty ? parseFloat(order.filled_qty) : qty,
          executedValueUsd: order.filled_avg_price && order.filled_qty
            ? parseFloat(order.filled_avg_price) * parseFloat(order.filled_qty) : undefined,
          timestamp: now,
        };
      } catch (err) {
        return { success: false, symbol: contractSymbol, error: err instanceof Error ? err.message : String(err), timestamp: now };
      }
    },

    async closePosition(symbol: string, positionId: string): Promise<TradeResult> {
      const now = Date.now();
      if (!isConfigured()) {
        return { success: false, symbol, error: "Alpaca API keys not configured", timestamp: now };
      }
      try {
        await alpacaPost(`/v2/positions/${symbol}/close`, {});
        return { success: true, orderId: positionId, symbol, timestamp: now };
      } catch (err) {
        return { success: false, symbol, error: err instanceof Error ? err.message : String(err), timestamp: now };
      }
    },

    manageRisk(signal: SignalWithScore, portfolio: Portfolio): RiskCheck {
      const maxPerTradeUsd = 1000;
      const maxConcentration = 20; // %
      const maxDrawdown = 25; // %

      // Drawdown guard.
      const peakValue = (signal.signal.metadata?.peakPortfolioValue as number) ?? portfolio.totalValueUsd;
      if (portfolio.totalValueUsd > 0 && peakValue > 0) {
        const drawdown = ((peakValue - portfolio.totalValueUsd) / peakValue) * 100;
        if (drawdown >= maxDrawdown) {
          return { approved: false, reason: `Max drawdown (${maxDrawdown}%) exceeded (current: ${drawdown.toFixed(1)}%)` };
        }
      }

      // Concentration: no single underlier > 20% of portfolio.
      const underlying = (signal.signal.metadata?.underlyingSymbol as string) ?? signal.signal.symbol;
      const underlierExposure = portfolio.positions
        .filter((p) => {
          const pUnderlying = p.metadata?.underlyingSymbol as string | undefined;
          return pUnderlying === underlying || p.symbol.startsWith(underlying);
        })
        .reduce((sum, p) => sum + p.valueUsd, 0);

      if (portfolio.totalValueUsd > 0) {
        const concentration = (underlierExposure / portfolio.totalValueUsd) * 100;
        if (concentration >= maxConcentration) {
          return { approved: false, reason: `Underlier ${underlying} concentration (${concentration.toFixed(1)}%) exceeds limit (${maxConcentration}%)` };
        }
      }

      // Buying power check.
      const cashUsd = portfolio.cashUsd;
      const maxPositionUsd = Math.min(maxPerTradeUsd, cashUsd * 0.25);

      if (maxPositionUsd < signal.signal.price) {
        return { approved: false, reason: `Insufficient buying power ($${cashUsd.toFixed(2)}) for this trade` };
      }

      return { approved: true, maxPositionUsd, marginAvailable: cashUsd };
    },

    async healthCheck(): Promise<ExecutorHealth> {
      if (!isConfigured()) {
        return { healthy: false, mode: "unconfigured", details: { reason: "ALPACA_API_KEY_ID / ALPACA_API_SECRET_KEY not set" } };
      }
      try {
        const account = await alpacaGet("/v2/account") as AlpacaAccount;
        const isPaper = ALPACA_TRADING_BASE.includes("paper-api");
        return {
          healthy: account.status === "ACTIVE",
          mode: isPaper ? "paper" : "live",
          details: { status: account.status, buyingPower: account.buying_power, portfolioValue: account.portfolio_value },
        };
      } catch (err) {
        return { healthy: false, mode: "error", details: { error: err instanceof Error ? err.message : String(err) } };
      }
    },
  };
}

/** Fetch the current portfolio from Alpaca (used by the adapter loop). */
export async function fetchAlpacaPortfolio(): Promise<Portfolio> {
  if (!isConfigured()) return { totalValueUsd: 0, cashUsd: 0, positions: [] };
  try {
    const [account, positionsRes] = await Promise.all([
      alpacaGet("/v2/account") as Promise<AlpacaAccount>,
      alpacaGet("/v2/positions") as Promise<AlpacaPosition[]>,
    ]);
    const positions: AdapterPosition[] = (positionsRes ?? []).map((p) => ({
      symbol: p.symbol, positionId: p.symbol,
      quantity: parseFloat(p.qty), avgEntryPrice: parseFloat(p.avg_entry_price),
      currentPrice: parseFloat(p.current_price), valueUsd: parseFloat(p.market_value),
      unrealizedPnlUsd: parseFloat(p.unrealized_pl), unrealizedPnlPercent: parseFloat(p.unrealized_plpc) * 100,
    }));
    return { totalValueUsd: parseFloat(account.portfolio_value), cashUsd: parseFloat(account.cash), positions };
  } catch {
    return { totalValueUsd: 0, cashUsd: 0, positions: [] };
  }
}

let _instance: TradeExecutor | null = null;
export function getAlpacaExecutor(): TradeExecutor {
  if (!_instance) _instance = createAlpacaExecutor();
  return _instance;
}

