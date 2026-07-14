#!/usr/bin/env node
import { runBacktest, type BacktestConfig } from "../lib/backtest.js";
import { AGENT_CONFIG } from "../lib/config.js";

const today = new Date();
const start = new Date(today.getTime() - 90 * 24 * 60 * 60 * 1000);

const cfg: BacktestConfig = {
  startDate: start.toISOString().slice(0, 10),
  endDate: today.toISOString().slice(0, 10),
  initialBnbUsd: 9,
  initialCashUsd: 70,
  symbols: AGENT_CONFIG.competition.eligibleTokens.slice(0, 20),
  adaptiveWeights: true,
  honeypotGate: true,
  slippageBps: 100,
  gasUsd: 1.5,
  maxOpenPositions: AGENT_CONFIG.trading.maxOpenPositions,
  minConvictionScore: 60,
  maxTradeFractionOfBnb: AGENT_CONFIG.trading.bankroll.maxTradeFractionOfBnb,
  minBnbReserveUsd: AGENT_CONFIG.trading.bankroll.minBnbReserveUsd,
  stopLossPercent: AGENT_CONFIG.trading.stopLossPercent,
  partialProfitGainPercent: AGENT_CONFIG.trading.partialProfitGainPercent,
  trailingActivationGainPercent: AGENT_CONFIG.trading.trailingActivationGainPercent,
  trailingStopPercent: AGENT_CONFIG.trading.trailingStopPercent,
};

runBacktest(cfg)
  .then((results) => {
    const dataSource = (results[0] as any).dataSource ?? "unknown";
    console.log("\n═══════════════════════════════════════════════════");
    console.log("  BACKTEST RESULTS");
    console.log(`  Data source: ${dataSource}`);
    if (dataSource === "synthetic") {
      console.log("  ⚠ SYNTHETIC DATA — results demonstrate mechanics");
      console.log("    only, not returns");
    }
    console.log("═══════════════════════════════════════════════════\n");
    for (const r of results) {
      console.log(`Variant:        ${r.variant}`);
      console.log(`Period:         ${r.startDate} → ${r.endDate}`);
      console.log(`Initial value:  $${r.initialValueUsd.toFixed(2)}`);
      console.log(`Final value:    $${r.finalValueUsd.toFixed(2)}`);
      console.log(`Total return:   ${r.totalReturnPercent.toFixed(2)}%`);
      console.log(`Max drawdown:   ${r.maxDrawdownPercent.toFixed(2)}%`);
      console.log(`Win rate:       ${(r.winRate * 100).toFixed(1)}%`);
      console.log(`Profit factor:  ${r.profitFactor.toFixed(2)}`);
      console.log(`Sharpe ratio:   ${r.sharpeRatio.toFixed(2)}`);
      console.log(`Trades:         ${r.trades}`);
      console.log(`Gas spent:      $${r.gasUsd.toFixed(2)}`);
      console.log("───────────────────────────────────────────────────\n");
    }
  })
  .catch((err) => {
    console.error("Backtest failed:", err);
    process.exit(1);
  });
