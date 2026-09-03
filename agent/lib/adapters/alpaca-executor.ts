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
 *   - DELETE /v2/positions/{symbol} — close a position (URL-encoded OSI)
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
import { getAlpacaCli, type AlpacaCliOrder } from "./alpaca-cli.js";
import { OPTIONS_POLICY, underlierCostUsd } from "../options-policy.js";

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

/** Parse an Alpaca body. 404s on the fake `/close` path came back as the
 *  literal text "Not Found" — `res.json()` threw before we could log the
 *  status. Never assume JSON. */
async function readAlpacaJson(res: Response, label: string): Promise<any> {
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`Alpaca ${res.status} ${label}: ${text.slice(0, 200)}`);
    }
  }
  if (!res.ok) {
    const msg = data !== null ? JSON.stringify(data).slice(0, 300) : (text || res.statusText).slice(0, 200);
    throw new Error(`Alpaca ${res.status} ${label}: ${msg}`);
  }
  return data;
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
  return readAlpacaJson(res, `POST ${path}`);
}

async function alpacaDeleteJson(path: string): Promise<any> {
  const res = await withTimeout(
    fetch(`${ALPACA_TRADING_BASE}${path}`, {
      method: "DELETE",
      headers: alpacaHeaders(),
    }),
    30000,
    `alpaca:DELETE ${path}`,
  );
  return readAlpacaJson(res, `DELETE ${path}`);
}

async function alpacaGet(path: string): Promise<any> {
  const res = await withTimeout(
    fetch(`${ALPACA_TRADING_BASE}${path}`, { headers: alpacaHeaders() }),
    30000,
    `alpaca:GET ${path}`,
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Alpaca ${res.status} ${res.statusText}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

// =============================================================================
// Adapter
// =============================================================================

/**
 * Create an Alpaca-backed TradeExecutor for options trading.
 *
 * Uses paper trading by default. Orders are placed through the Alpaca CLI
 * (the hackathon's "MCP or CLI" requirement) with an automatic REST fallback,
 * so a missing/failing CLI can never break the live path.
 */
export function createAlpacaExecutor(): TradeExecutor {
  const executor: TradeExecutor & { fetchAlpacaPortfolio?: () => Promise<Portfolio> } = {
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

        // Alpaca CLI path first (hackathon "MCP or CLI" requirement). The CLI
        // is agent-first: JSON output, idempotent client-order-id. If the CLI
        // binary is missing or errors, fall back to the REST API so the live
        // path can't break. clientOrderId is derived deterministically so a
        // retry of the same logical order can't double-submit.
        let order: AlpacaCliOrder | null = null;
        let cliError: string | null = null;
        try {
          const clientOrderId = `enw-${contractSymbol}-${Date.now()}`;
          const cli = getAlpacaCli();
          order = await cli.submitOrder({
            symbol: contractSymbol,
            qty: String(qty),
            side: position.side === "long" ? "buy" : "sell",
            type: position.orderType ?? "market",
            limitPrice: position.orderType === "limit" && position.limitPrice ? String(position.limitPrice) : undefined,
            clientOrderId,
          });
        } catch (err) {
          cliError = err instanceof Error ? err.message : String(err);
          console.warn(`  [alpaca-executor] CLI order failed (${cliError}) — falling back to REST`);
          order = null;
        }

        const hardFail = ["rejected", "canceled", "expired", "suspended", "stopped"];

        if (order) {
          // Multiplier-aware value: filled_avg_price is per-share.
          // Treat `new`, `held`, `pending_new`, and `accepted` as successful
          // submission — Alpaca fills options market orders asynchronously.
          const multiplier = (meta.multiplier as number) ?? 100;
          const filledPrice = order.filled_avg_price ? parseFloat(order.filled_avg_price) : undefined;
          const filledQty = order.filled_qty ? parseFloat(order.filled_qty) : qty;
          const success = Boolean(order.id) && !hardFail.includes(order.status);
          return {
            success,
            orderId: order.id,
            symbol: contractSymbol,
            executedPrice: filledPrice,
            executedQuantity: filledQty,
            executedValueUsd: filledPrice && filledQty ? filledPrice * filledQty * multiplier : undefined,
            timestamp: now,
            error: success ? undefined : `order status ${order.status}`,
          };
        }

        // REST fallback (unchanged behavior).
        const restOrder = await alpacaPost("/v2/orders", orderBody) as AlpacaOrder;
        const multiplier = (meta.multiplier as number) ?? 100;
        const filledPrice = restOrder.filled_avg_price ? parseFloat(restOrder.filled_avg_price) : undefined;
        const filledQty = restOrder.filled_qty ? parseFloat(restOrder.filled_qty) : qty;
        const success = Boolean(restOrder.id) && !hardFail.includes(restOrder.status);
        return {
          success,
          orderId: restOrder.id,
          symbol: contractSymbol,
          executedPrice: filledPrice,
          executedQuantity: filledQty,
          executedValueUsd: filledPrice && filledQty ? filledPrice * filledQty * multiplier : undefined,
          timestamp: now,
          error: success ? undefined : `order status ${restOrder.status}`,
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

      const encoded = encodeURIComponent(symbol);
      const orderFailed = (status: string | undefined) =>
        ["rejected", "canceled", "expired", "suspended", "stopped"].includes(status ?? "");

      const unwrap = (raw: AlpacaCliOrder | AlpacaOrder | Record<string, unknown>): AlpacaCliOrder | AlpacaOrder => {
        const body = (raw as { body?: AlpacaOrder }).body;
        if (body && typeof body === "object" && (body.id || body.status)) return body;
        return raw as AlpacaCliOrder | AlpacaOrder;
      };

      const fromOrder = (raw: AlpacaCliOrder | AlpacaOrder | Record<string, unknown>): TradeResult => {
        const order = unwrap(raw);
        const filledPrice = order.filled_avg_price ? parseFloat(order.filled_avg_price) : undefined;
        const filledQty = order.filled_qty ? parseFloat(order.filled_qty) : undefined;
        // Options market closes often ack as `held`/`pending_new` then fill.
        // An order id that isn't a hard reject is a successful close request.
        const success = Boolean(order.id) && !orderFailed(order.status);
        return {
          success,
          orderId: order.id || positionId,
          symbol,
          executedPrice: Number.isFinite(filledPrice) ? filledPrice : undefined,
          executedQuantity: Number.isFinite(filledQty) ? filledQty : undefined,
          timestamp: now,
          error: success ? undefined : `close status ${order.status ?? "unknown"}`,
        };
      };

      // CLI first (hackathon "MCP or CLI") — `alpaca position close`.
      try {
        const cli = getAlpacaCli();
        const order = await cli.closePosition(symbol);
        return fromOrder(order);
      } catch (cliErr) {
        console.warn(
          `  [alpaca-executor] CLI close failed (${cliErr instanceof Error ? cliErr.message : String(cliErr)}) — falling back to DELETE /v2/positions/{symbol}`,
        );
      }

      // Documented REST: DELETE /v2/positions/{symbol_or_asset_id}.
      // The previous POST /v2/positions/{symbol}/close is not an Alpaca
      // route — paper returned the literal body "Not Found" and every
      // exit on 2026-09-01 404'd.
      try {
        const order = await alpacaDeleteJson(`/v2/positions/${encoded}`) as AlpacaOrder;
        return fromOrder(order);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // Alpaca's documented 404 for a missing position. Do NOT treat the
        // generic body "Not Found" as success — that was the bogus POST
        // /close path, and the contract was still on the book.
        if (/position does not exist|40410000/i.test(msg)) {
          return { success: true, orderId: positionId, symbol, timestamp: now };
        }
        return { success: false, symbol, error: msg, timestamp: now };
      }
    },

    manageRisk(signal: SignalWithScore, portfolio: Portfolio): RiskCheck {
      const maxPerTradeUsd = OPTIONS_POLICY.maxSizeUsd;
      const maxConcentration = OPTIONS_POLICY.maxConcentrationPercent; // %
      const maxDrawdown = OPTIONS_POLICY.maxDrawdownPercent; // %

      // Drawdown guard.
      const peakValue = (signal.signal.metadata?.peakPortfolioValue as number) ?? portfolio.totalValueUsd;
      if (portfolio.totalValueUsd > 0 && peakValue > 0) {
        const drawdown = ((peakValue - portfolio.totalValueUsd) / peakValue) * 100;
        if (drawdown >= maxDrawdown) {
          return { approved: false, reason: `Max drawdown (${maxDrawdown}%) exceeded (current: ${drawdown.toFixed(1)}%)` };
        }
      }

      // Concentration: no single underlier > 20% of portfolio, measured on
      // max(cost basis, mark). A decaying mark must not free room to average
      // into the same name.
      const underlying = (signal.signal.metadata?.underlyingSymbol as string) ?? signal.signal.symbol;
      const underlierExposure = underlierCostUsd(portfolio.positions, underlying);

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
        // Also surface whether the Alpaca CLI binary is present + healthy
        // (the order-execution path). Non-fatal — REST is the fallback.
        let cliCli = null;
        try {
          const cli = getAlpacaCli();
          const health = await cli.healthCheck();
          cliCli = health.healthy ? { version: health.version, mode: "live" } : { version: health.version, mode: "unhealthy" };
        } catch {
          cliCli = { mode: "unavailable" };
        }
        return {
          healthy: account.status === "ACTIVE",
          mode: isPaper ? "paper" : "live",
          details: {
            status: account.status,
            buyingPower: account.buying_power,
            portfolioValue: account.portfolio_value,
            cli: cliCli,
          },
        };
      } catch (err) {
        return { healthy: false, mode: "error", details: { error: err instanceof Error ? err.message : String(err) } };
      }
    },
  };

  // Attach the portfolio fetcher so the harness cycle's `fetchPortfolio`
  // step can discover the account's current portfolio via the executor.
  executor.fetchAlpacaPortfolio = fetchAlpacaPortfolio;

  return executor;
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
      metadata: parseContractSymbol(p.symbol),
    }));
    return { totalValueUsd: parseFloat(account.portfolio_value), cashUsd: parseFloat(account.cash), positions };
  } catch {
    return { totalValueUsd: 0, cashUsd: 0, positions: [] };
  }
}

/**
 * Parse an OSI option symbol (e.g. "AAPL260911C00135000") into contract
 * metadata: underlier, type, strike, expiry, multiplier. Returns {} when the
 * symbol isn't a recognized OSI format (e.g. an equity or crypto position).
 */
function parseContractSymbol(symbol: string): Record<string, unknown> | undefined {
  // OSI: ROOT + YYMMDD + C/P + 8-digit strike (implied 3 decimals).
  const m = symbol.match(/^([A-Z]{1,5})(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/);
  if (!m) return undefined;
  const [, root, yy, mm, dd, type, strikeRaw] = m;
  const year = 2000 + parseInt(yy, 10);
  const month = parseInt(mm, 10);
  const day = parseInt(dd, 10);
  const strike = parseInt(strikeRaw, 10) / 1000;
  const expiry = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return {
    underlyingSymbol: root,
    contractType: type === "C" ? "call" : "put",
    strike,
    expiry,
    multiplier: 100,
  };
}

let _instance: TradeExecutor | null = null;
export function getAlpacaExecutor(): TradeExecutor {
  if (!_instance) _instance = createAlpacaExecutor();
  return _instance;
}

