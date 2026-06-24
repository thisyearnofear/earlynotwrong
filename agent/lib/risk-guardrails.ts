/**
 * Risk Guardrails
 *
 * Enforces hard limits on the agent's trading behavior. Every proposed trade
 * must pass all checks before execution. The guardrails are the last line of
 * defense — they cannot be overridden by the trading loop.
 *
 * Hard rules (from AGENT_CONFIG.trading):
 *   - Max drawdown: 25% (trips before the 30% competition disqual line)
 *   - Max per trade: $1,000 USD
 *   - Max daily trades: 10
 *   - Max position concentration: 20% of portfolio
 *   - Min conviction score: 60
 *   - Token allowlist: 149 BEP-20 tokens
 *
 * The module is pure (no side effects) and maintains cumulative state
 * (daily counter, peak portfolio value) in memory.
 */

import { AGENT_CONFIG } from "./config.js";
import { isEligibleToken } from "./constants.js";


// =============================================================================
// Types
// =============================================================================

export interface TradeProposal {
  tokenIn: string;
  tokenOut: string;
  amountInUsd: number;
  expectedAmountOut: number;
  convictionScore: number;
  portfolioValue: number;
}

export type GuardrailCode =
  | "OK"
  | "DRAWDOWN_EXCEEDED"
  | "TOKEN_NOT_ALLOWED"
  | "PER_TRADE_LIMIT"
  | "DAILY_TRADE_LIMIT"
  | "CONCENTRATION_LIMIT"
  | "CONVICTION_TOO_LOW"
  | "PORTFOLIO_TOO_LOW"
  | "TRADING_WINDOW_CLOSED";

export interface GuardrailResult {
  allowed: boolean;
  code: GuardrailCode;
  message: string;
  /** For warnings only (trading can proceed but condition is close) */
  warning?: string;
}

export interface GuardrailStatus {
  drawdownPercent: number;
  peakValueUsd: number;
  tradesToday: number;
  dailyLimitExceeded: boolean;
  drawdownExceeded: boolean;
  tokensTradedToday: number;
  allOk: boolean;
}

// =============================================================================
// Guardrails Class
// =============================================================================

export class RiskGuardrails {
  private config: {
    maxDrawdownPercent: number;
    maxPerTradeUsd: number;
    maxDailyTrades: number;
    maxPositionConcentrationPercent: number;
    minConvictionScore: number;
    competitionDrawdownDisqual: number;
    tradingWindowStart: number;
    tradingWindowEnd: number;
    portfolioMinUsd: number;
  };

  // Cumulative state
  private peakValueUsd: number = 0;
  private tradesToday: number = 0;
  private tradeDate: string = ""; // YYYY-MM-DD — resets when the date changes
  private totalTradesExecuted: number = 0;
  private totalVolumeUsd: number = 0;
  private lastTradeAt: number | null = null;

  constructor(
    initialPortfolioValue: number = 0,
    overrides?: Partial<typeof AGENT_CONFIG.trading>
  ) {
    const t = { ...AGENT_CONFIG.trading, ...overrides };
    this.config = {
      maxDrawdownPercent: t.maxDrawdownPercent,
      maxPerTradeUsd: t.maxPerTradeUsd,
      maxDailyTrades: t.maxDailyTrades,
      maxPositionConcentrationPercent: t.maxPositionConcentrationPercent,
      minConvictionScore: t.minConvictionScore,
      competitionDrawdownDisqual: 30, // Hard rule from hackathon
      tradingWindowStart: new Date("2026-01-01T00:00:00Z").getTime(),
      tradingWindowEnd: new Date("2027-01-01T00:00:00Z").getTime(),
      portfolioMinUsd: 1, // Sub-$1 = no capital at work
    };

    this.peakValueUsd = initialPortfolioValue;
    this.resetDailyCounter();
  }

  // ===========================================================================
  // Main Check
  // ===========================================================================

  /**
   * Check if a proposed trade is allowed against all guardrails.
   * This must pass before the trade is submitted to TWAK.
   *
   * @returns GuardrailResult — if `allowed` is false, the trade is rejected
   *          with a human-readable reason and a machine-readable code.
   */
  checkTrade(proposal: TradeProposal): GuardrailResult {
    // 1. Trading window check
    const windowCheck = this.checkTradingWindow();
    if (!windowCheck.allowed) return windowCheck;

    // 2. Portfolio minimum check (sub-$1 = no capital at work)
    const portfolioCheck = this.checkPortfolioMinimum(proposal);
    if (!portfolioCheck.allowed) return portfolioCheck;

    // 3. Drawdown check (hard stop at 25%)
    const drawdownCheck = this.checkDrawdown(proposal.portfolioValue);
    if (!drawdownCheck.allowed) return drawdownCheck;

    // 4. Token allowlist check (both sides of the trade)
    const tokenCheck = this.checkTokenAllowlist(proposal.tokenIn, proposal.tokenOut);
    if (!tokenCheck.allowed) return tokenCheck;

    // 5. Per-trade size limit
    const sizeCheck = this.checkPerTradeLimit(proposal.amountInUsd);
    if (!sizeCheck.allowed) return sizeCheck;

    // 6. Daily trade count limit
    const dailyCheck = this.checkDailyTradeLimit();
    if (!dailyCheck.allowed) return dailyCheck;

    // 7. Position concentration limit
    const concentrationCheck = this.checkConcentration(proposal);
    if (!concentrationCheck.allowed) return concentrationCheck;

    // 8. Minimum conviction score
    const convictionCheck = this.checkConvictionScore(proposal.convictionScore);
    if (!convictionCheck.allowed) return convictionCheck;

    // All checks passed — collect any warnings
    const warnings: string[] = [];
    if (drawdownCheck.warning) warnings.push(drawdownCheck.warning);
    if (dailyCheck.warning) warnings.push(dailyCheck.warning);

    return {
      allowed: true,
      code: "OK",
      message: warnings.length > 0 ? `Trade allowed with warnings: ${warnings.join("; ")}` : "Trade allowed",
      warning: warnings.length > 0 ? warnings.join("; ") : undefined,
    };
  }

  /**
   * Record a completed trade. Updates cumulative state (daily counter,
   * total volume, peak value tracking).
   */
  recordTrade(amountInUsd: number, success: boolean): void {
    this.ensureDailyReset();
    if (success) {
      this.tradesToday++;
      this.totalTradesExecuted++;
      this.totalVolumeUsd += amountInUsd;
      this.lastTradeAt = Date.now();
    }
  }

  /**
   * Update the peak portfolio value (for drawdown calculation).
   * Called after each portfolio snapshot.
   */
  updatePeakValue(currentValue: number): void {
    if (currentValue > this.peakValueUsd) {
      this.peakValueUsd = currentValue;
    }
  }

  /**
   * Get the current guardrail status for logging and monitoring.
   * Requires the current portfolio value to compute accurate drawdown.
   */
  getStatus(currentPortfolioValue: number): GuardrailStatus {
    this.ensureDailyReset();

    const drawdownPercent =
      this.peakValueUsd > 0
        ? ((this.peakValueUsd - currentPortfolioValue) / this.peakValueUsd) * 100
        : 0;

    return {
      drawdownPercent: Math.max(0, drawdownPercent),
      peakValueUsd: this.peakValueUsd,
      tradesToday: this.tradesToday,
      dailyLimitExceeded: this.tradesToday >= this.config.maxDailyTrades,
      drawdownExceeded: drawdownPercent >= this.config.maxDrawdownPercent,
      tokensTradedToday: this.tradesToday,
      allOk: this.tradesToday < this.config.maxDailyTrades && drawdownPercent < this.config.maxDrawdownPercent,
    };
  }

  /**
   * Get peak value for use by the trading loop.
   */
  getPeakValue(): number {
    return this.peakValueUsd;
  }

  /**
   * Get total trade metrics.
   */
  getTotals(): { totalTrades: number; totalVolumeUsd: number } {
    return {
      totalTrades: this.totalTradesExecuted,
      totalVolumeUsd: this.totalVolumeUsd,
    };
  }

  // ===========================================================================
  // Individual Checks
  // ===========================================================================

  private checkTradingWindow(): GuardrailResult {
    const now = Date.now();
    const { tradingWindowStart, tradingWindowEnd } = this.config;

    if (now < tradingWindowStart) {
      return {
        allowed: false,
        code: "TRADING_WINDOW_CLOSED",
        message: `Trading window hasn't opened yet. Opens ${new Date(tradingWindowStart).toISOString()}`,
      };
    }

    if (now > tradingWindowEnd) {
      return {
        allowed: false,
        code: "TRADING_WINDOW_CLOSED",
        message: `Trading window has closed. Closed ${new Date(tradingWindowEnd).toISOString()}`,
      };
    }

    return { allowed: true, code: "OK", message: "Trading window is open" };
  }

  private checkPortfolioMinimum(proposal: TradeProposal): GuardrailResult {
    if (proposal.portfolioValue < this.config.portfolioMinUsd) {
      return {
        allowed: false,
        code: "PORTFOLIO_TOO_LOW",
        message: `Portfolio value ($${proposal.portfolioValue}) below minimum ($${this.config.portfolioMinUsd}). No capital at work.`,
      };
    }

    return { allowed: true, code: "OK", message: "Portfolio above minimum" };
  }

  private checkDrawdown(portfolioValue: number): GuardrailResult {
    // Peak value is set explicitly at end of cycle (post-trade). Until it's
    // been set at least once, drawdown is reported as 0 — we don't want
    // the FIRST checkDrawdown call (which sees a pre-trade portfolio value)
    // to lock the peak at that pre-trade number and flag the subsequent
    // deployment of capital as a phantom drawdown.

    const drawdownPercent =
      this.peakValueUsd > 0
        ? ((this.peakValueUsd - portfolioValue) / this.peakValueUsd) * 100
        : 0;

    if (drawdownPercent >= this.config.competitionDrawdownDisqual) {
      return {
        allowed: false,
        code: "DRAWDOWN_EXCEEDED",
        message: `Drawdown ${drawdownPercent.toFixed(1)}% exceeds competition disqual threshold (${this.config.competitionDrawdownDisqual}%). Agent must stop trading.`,
      };
    }

    if (drawdownPercent >= this.config.maxDrawdownPercent) {
      return {
        allowed: false,
        code: "DRAWDOWN_EXCEEDED",
        message: `Drawdown ${drawdownPercent.toFixed(1)}% exceeds agent limit (${this.config.maxDrawdownPercent}%). Trading halted.`,
      };
    }

    // Warning zone: within 5% of the hard limit
    const warningThreshold = this.config.maxDrawdownPercent - 5;
    const warning =
      drawdownPercent >= warningThreshold
        ? `Drawdown at ${drawdownPercent.toFixed(1)}% — within 5% of the ${this.config.maxDrawdownPercent}% limit`
        : undefined;

    return {
      allowed: true,
      code: "OK",
      message: warning ?? `Drawdown ${drawdownPercent.toFixed(1)}% within limits`,
      warning,
    };
  }

  private checkTokenAllowlist(tokenIn: string, tokenOut: string): GuardrailResult {
    // Only validate tokenOut — the target token must be a hackathon-eligible token.
    // tokenIn can be BNB (native gas token) or any stablecoin the wallet holds.
    if (!isEligibleToken(tokenOut)) {
      return {
        allowed: false,
        code: "TOKEN_NOT_ALLOWED",
        message: `${tokenOut} is not in the competition token allowlist`,
      };
    }

    return { allowed: true, code: "OK", message: "Target token in allowlist" };
  }

  private checkPerTradeLimit(amountInUsd: number): GuardrailResult {
    if (amountInUsd > this.config.maxPerTradeUsd) {
      return {
        allowed: false,
        code: "PER_TRADE_LIMIT",
        message: `Trade size $${amountInUsd.toFixed(2)} exceeds max per-trade limit ($${this.config.maxPerTradeUsd})`,
      };
    }

    return {
      allowed: true,
      code: "OK",
      message: `Trade size $${amountInUsd.toFixed(2)} within limit`,
    };
  }

  private checkDailyTradeLimit(): GuardrailResult {
    this.ensureDailyReset();

    if (this.tradesToday >= this.config.maxDailyTrades) {
      return {
        allowed: false,
        code: "DAILY_TRADE_LIMIT",
        message: `Daily trade limit reached: ${this.tradesToday}/${this.config.maxDailyTrades}`,
      };
    }

    // Warning: at 80% of daily limit
    const warningThreshold = this.config.maxDailyTrades * 0.8;
    const warning =
      this.tradesToday >= warningThreshold
        ? `${this.tradesToday} trades today — approaching daily limit (${this.config.maxDailyTrades})`
        : undefined;

    return {
      allowed: true,
      code: "OK",
      message:
        warning ??
        `${this.config.maxDailyTrades - this.tradesToday} trades remaining today (${this.tradesToday}/${this.config.maxDailyTrades})`,
      warning,
    };
  }

  private checkConcentration(proposal: TradeProposal): GuardrailResult {
    if (proposal.portfolioValue <= 0) {
      return { allowed: true, code: "OK", message: "No portfolio to check concentration against" };
    }

    const concentrationPercent =
      (proposal.amountInUsd / proposal.portfolioValue) * 100;

    if (concentrationPercent > this.config.maxPositionConcentrationPercent) {
      return {
        allowed: false,
        code: "CONCENTRATION_LIMIT",
        message: `Trade would be ${concentrationPercent.toFixed(1)}% of portfolio, exceeding ${this.config.maxPositionConcentrationPercent}% concentration limit`,
      };
    }

    return {
      allowed: true,
      code: "OK",
      message: `Trade ${concentrationPercent.toFixed(1)}% of portfolio within concentration limit`,
    };
  }

  private checkConvictionScore(score: number): GuardrailResult {
    if (score < this.config.minConvictionScore) {
      return {
        allowed: false,
        code: "CONVICTION_TOO_LOW",
        message: `Conviction score ${score} below minimum (${this.config.minConvictionScore})`,
      };
    }

    return {
      allowed: true,
      code: "OK",
      message: `Conviction score ${score} meets minimum`,
    };
  }

  // ===========================================================================
  // Internal State Management
  // ===========================================================================

  /**
   * Reset the daily trade counter if the date has changed.
   */
  private ensureDailyReset(): void {
    const today = new Date().toISOString().split("T")[0];
    if (this.tradeDate !== today) {
      this.tradeDate = today;
      this.tradesToday = 0;
    }
  }

  /**
   * Initialize the daily counter on construction.
   */
  private resetDailyCounter(): void {
    this.tradeDate = new Date().toISOString().split("T")[0];
    this.tradesToday = 0;
  }
}

// =============================================================================
// Singleton
// =============================================================================

/** Default guardrails instance with config from AGENT_CONFIG.trading. */
export const guardrails = new RiskGuardrails();
