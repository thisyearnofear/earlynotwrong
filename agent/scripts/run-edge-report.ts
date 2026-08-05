#!/usr/bin/env node
/**
 * Edge report — does the conviction signal beat a naive baseline?
 *
 * Runs the conviction strategy (adaptive weights) alongside a naive
 * random-entry baseline on the same price paths, then prints a head-to-head
 * verdict with factor attribution. This is the answer to the buyer-agent
 * question: "does the signal have demonstrable edge, or would any
 * disciplined exit policy do as well?"
 *
 * Usage:
 *   npm run edge-report
 *   npm run edge-report -- --start 2026-04-01 --end 2026-07-01
 */
import { runEdgeReport, type BacktestConfig } from "../lib/backtest.js";
import { AGENT_CONFIG } from "../lib/config.js";

const args = process.argv.slice(2);
function flag(name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

const today = new Date();
const defaultStart = new Date(today.getTime() - 90 * 24 * 60 * 60 * 1000);

const cfg: BacktestConfig = {
  startDate: flag("start") ?? defaultStart.toISOString().slice(0, 10),
  endDate: flag("end") ?? today.toISOString().slice(0, 10),
  initialBnbUsd: 9,
  initialCashUsd: 70,
  symbols: AGENT_CONFIG.competition.eligibleTokens.slice(0, 20),
  adaptiveWeights: true,
  honeypotGate: false,
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

console.log(`\n  EDGE REPORT — conviction vs naive baseline`);
console.log(`  ${cfg.startDate} → ${cfg.endDate}`);
console.log(`  symbols: ${cfg.symbols?.length ?? "default"}  data: live SoSoValue klines (synthetic fallback)\n`);

const report = await runEdgeReport(cfg);

const c = report.conviction;
const n = report.naive;
const e = report.edge;

const fmt = (x: number, suffix = "") => `${x >= 0 ? "+" : ""}${x.toFixed(2)}${suffix}`;
const pct = (x: number) => `${x.toFixed(1)}%`;

console.log("  ┌──────────────────────────┬──────────────┬──────────────┬──────────────┐");
console.log("  │ Metric                   │ Conviction   │ Naive        │ Edge         │");
console.log("  ├──────────────────────────┼──────────────┼──────────────┼──────────────┤");
console.log(`  │ Total return             │ ${pct(c.totalReturnPercent).padStart(12)} │ ${pct(n.totalReturnPercent).padStart(12)} │ ${fmt(e.totalReturnPercent, "pp").padStart(12)} │`);
console.log(`  │ Sharpe ratio             │ ${c.sharpeRatio.toFixed(2).padStart(12)} │ ${n.sharpeRatio.toFixed(2).padStart(12)} │ ${fmt(e.sharpeRatio).padStart(12)} │`);
console.log(`  │ Max drawdown             │ ${pct(c.maxDrawdownPercent).padStart(12)} │ ${pct(n.maxDrawdownPercent).padStart(12)} │ ${fmt(e.maxDrawdownPercent, "pp").padStart(12)} │`);
console.log(`  │ Win rate                 │ ${pct(c.winRate * 100).padStart(12)} │ ${pct(n.winRate * 100).padStart(12)} │ ${fmt(e.winRate * 100, "pp").padStart(12)} │`);
console.log(`  │ Profit factor            │ ${c.profitFactor.toFixed(2).padStart(12)} │ ${n.profitFactor.toFixed(2).padStart(12)} │ ${fmt(e.profitFactor).padStart(12)} │`);
console.log(`  │ Trades                   │ ${String(c.trades).padStart(12)} │ ${String(n.trades).padStart(12)} │              │`);
console.log("  └──────────────────────────┴──────────────┴──────────────┴──────────────┘");

console.log(`\n  VERDICT: ${report.hasEdge ? "✅ EDGE CONFIRMED" : "❌ NO EDGE"} — ${report.verdict}`);

if (report.factorAttribution.length > 0) {
  console.log("\n  FACTOR ATTRIBUTION (winning exits by leading factor):");
  console.log("  ┌────────────────────┬──────────────┬────────────────┬────────────────┐");
  console.log("  │ Factor             │ Winning exits│ Realized P&L   │ Mean entry score│");
  console.log("  ├────────────────────┼──────────────┼────────────────┼────────────────┤");
  for (const a of report.factorAttribution) {
    console.log(
      `  │ ${a.factor.padEnd(18)} │ ${String(a.winningExits).padStart(12)} │ $${a.realizedPnlUsd.toFixed(2).padStart(13)} │ ${String(a.meanEntryScore).padStart(14)} │`,
    );
  }
  console.log("  └────────────────────┴──────────────┴────────────────┴────────────────┘");
} else {
  console.log("\n  FACTOR ATTRIBUTION: no winning exits to attribute (no edge to decompose).");
}

if (report.dataSource === "synthetic") {
  console.log("\n  ⚠ SYNTHETIC DATA — results demonstrate mechanics only, not live edge.");
  console.log("    Set SOSOVALUE_API_KEY to run against live historical klines.\n");
} else {
  console.log("\n  DATA: live SoSoValue historical klines.\n");
}

process.exit(report.hasEdge ? 0 : 1);
