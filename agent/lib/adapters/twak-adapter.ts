/**
 * Crypto Trade Executor — TWAK Adapter
 *
 * Wraps the existing `twak-executor.ts` (Trust Wallet Agent Kit CLI on BSC)
 * to implement the harness TradeExecutor interface. This is the "crypto"
 * domain's executor adapter. The existing swap/portfolio logic is unchanged.
 *
 * The adapter delegates to `twakExecutor.executeSwap()` and
 * `twakExecutor.getPortfolio()` — the same methods the cycle-runner calls.
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
import { twakExecutor } from "../twak-executor.js";
import { AGENT_CONFIG, AGENT_MODE } from "../config.js";
import { getBnbUsd, computeBankrollCap } from "../agent-state.js";

/**
 * Create a TWAK-backed TradeExecutor adapter.
 */
export function createTwakAdapter(): TradeExecutor {
  return {
    async placeOrder(
      signal: SignalWithScore,
      position: PositionConfig,
    ): Promise<TradeResult> {
      const meta = position.metadata ?? {};
      const tokenOut = signal.signal.symbol;
      const tokenIn = (meta.tokenIn as string) ?? "BNB";

      // Convert USD size to token amount string (TWAK expects string amount).
      // For BNB in, we use the current BNB price. For other tokens, use the
      // signal's price.
      const price = signal.signal.price > 0 ? signal.signal.price : 1;
      const amount = position.sizeUsd / price;

      const result = await twakExecutor.executeSwap({
        tokenIn,
        tokenOut,
        amountIn: amount.toFixed(8),
        slippageBps: position.slippageBps ?? AGENT_CONFIG.trading.defaultSlippageBps,
      });

      return {
        success: result.success,
        orderId: result.txHash,
        symbol: tokenOut,
        executedPrice: result.amountOut
          ? parseFloat(result.amountOut) > 0
            ? position.sizeUsd / parseFloat(result.amountOut)
            : undefined
          : undefined,
        executedQuantity: result.amountOut ? parseFloat(result.amountOut) : undefined,
        executedValueUsd: result.success ? position.sizeUsd : undefined,
        error: result.error,
        timestamp: result.timestamp,
      };
    },

    async closePosition(symbol: string, _positionId: string): Promise<TradeResult> {
      // Closing a crypto position = swap the token back to BNB.
      const result = await twakExecutor.executeSwap({
        tokenIn: symbol,
        tokenOut: "BNB",
        amountIn: "0", // TWAK swaps the full balance when amountIn is 0/all
      });

      return {
        success: result.success,
        orderId: result.txHash,
        symbol,
        executedValueUsd: result.success && result.amountOut
          ? parseFloat(result.amountOut) * (result.feeUsd ?? 0)
          : undefined,
        error: result.error,
        timestamp: result.timestamp,
      };
    },

    manageRisk(signal: SignalWithScore, portfolio: Portfolio): RiskCheck {
      const t = AGENT_CONFIG.trading;
      const cfg = t.bankroll;

      // Drawdown guard.
      if (portfolio.totalValueUsd > 0 && portfolio.totalValueUsd < portfolio.totalValueUsd * (1 - t.maxDrawdownPercent / 100)) {
        return { approved: false, reason: `Max drawdown (${t.maxDrawdownPercent}%) exceeded` };
      }

      // Position concentration.
      const symbol = signal.signal.symbol;
      const existingPosition = portfolio.positions.find(
        (p) => p.symbol.toUpperCase() === symbol.toUpperCase(),
      );
      if (existingPosition && portfolio.totalValueUsd > 0) {
        const concentration = (existingPosition.valueUsd / portfolio.totalValueUsd) * 100;
        if (concentration >= t.maxPositionConcentrationPercent) {
          return {
            approved: false,
            reason: `Position concentration (${concentration.toFixed(1)}%) would exceed limit (${t.maxPositionConcentrationPercent}%)`,
          };
        }
      }

      // Daily trade count.
      // (The in-memory guardrail state tracks this; the adapter does a
      // simplified check — the full guardrail logic lives in risk-guardrails.ts.)

      // Bankroll cap.
      const bnbUsd = getBnbUsd(null); // null triggers the fallback path
      const cap = computeBankrollCap(bnbUsd);
      if (!cap.canTrade) {
        return { approved: false, reason: cap.reason };
      }

      const maxPositionUsd = Math.min(
        t.maxPerTradeUsd,
        cap.maxByBnb,
        portfolio.totalValueUsd * (t.bankroll.maxTradeFractionOfBnb ?? 0.5),
      );

      return {
        approved: true,
        maxPositionUsd,
        marginAvailable: cap.tradeableBnb,
      };
    },

    async healthCheck(): Promise<ExecutorHealth> {
      const health = await twakExecutor.healthCheck();
      return {
        healthy: health.available,
        mode: health.mode,
        details: {
          agentAddress: health.agentAddress,
          testnet: health.testnet,
          diagnostics: health.diagnostics,
        },
      };
    },
  };
}

let _instance: TradeExecutor | null = null;
export function getTwakAdapter(): TradeExecutor {
  if (!_instance) _instance = createTwakAdapter();
  return _instance;
}
