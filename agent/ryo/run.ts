/**
 * RYO-CHAN practice agent runner — drives the same adapter triple the
 * production harness resolves with HARNESS_DOMAIN=ryo
 * (DOMAIN_PROFILES.ryo → dataSource/convictionFactors/executor = ryo).
 *
 *   RYO_MCP_KEY=... npx tsx agent/ryo/run.ts              # one cycle
 *   RYO_MCP_KEY=... npx tsx agent/ryo/run.ts --cycles 5 --interval 60
 *   npx tsx agent/ryo/run.ts --verify                     # audit the ledger chain
 */
import { getRyoDataAdapter } from "../lib/adapters/ryo-data.js";
import { getRyoConvictionAdapter } from "../lib/adapters/ryo-conviction.js";
import { createRyoExecutor } from "../lib/adapters/ryo-executor.js";
import { DOMAIN_PROFILES } from "../lib/harness-config.js";
import { verifyChain, loadState, saveState, record, LEDGER_PATH } from "../lib/adapters/ryo-ledger.js";
import type { Portfolio } from "../lib/adapters/types.js";

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(n);
const opt = (n: string, d: number) => {
  const i = args.indexOf(n);
  return i >= 0 ? Number(args[i + 1]) : d;
};

if (flag("--verify")) {
  const r = verifyChain();
  console.log(`${LEDGER_PATH}: ${r.entries} entries — chain ${r.ok ? "INTACT" : `BROKEN at entry ${r.brokenAt}`}`);
  process.exit(r.ok ? 0 : 1);
}

const ENTRY_MIN_CONVICTION = 55;
const EXIT_INVALIDATION_PCT = -35;
const TRAIL_GIVEBACK_PCT = 30;
const TAKE_PROFIT_PCT = 50;

const dataSource = getRyoDataAdapter();
const factors = getRyoConvictionAdapter();
const executor = createRyoExecutor();

async function portfolio(): Promise<Portfolio> {
  const s = loadState();
  return {
    totalValueUsd: s.cashUsd + s.positions.reduce((a, p) => a + p.sizeUsd, 0),
    cashUsd: s.cashUsd,
    positions: s.positions.map((p) => ({
      symbol: p.symbol,
      quantity: p.sizeUsd / p.entryPriceUsd,
      avgEntryPrice: p.entryPriceUsd,
      currentPrice: p.peakPriceUsd,
      valueUsd: p.sizeUsd,
      unrealizedPnlUsd: 0,
      unrealizedPnlPercent: 0,
    })),
  };
}

async function cycle(): Promise<void> {
  const state = loadState();
  console.log(`\n=== cycle ${state.cycle + 1} — ${new Date().toISOString()} ===`);

  // 1. Manage open paper positions: re-price and exit on thesis break / trail.
  const open = [...state.positions];
  for (const pos of open) {
    const marks = await dataSource.fetchSignals({ symbols: [pos.symbol], limit: 1 }).catch(() => []);
    const px = marks[0]?.price ?? pos.entryPriceUsd;
    pos.peakPriceUsd = Math.max(pos.peakPriceUsd, px);
    const pnl = ((px - pos.entryPriceUsd) / pos.entryPriceUsd) * 100;
    const giveback = ((px - pos.peakPriceUsd) / pos.peakPriceUsd) * 100;
    if (pnl <= EXIT_INVALIDATION_PCT || (giveback <= -TRAIL_GIVEBACK_PCT && pnl > TAKE_PROFIT_PCT)) {
      const res = await executor.closePosition(pos.symbol, "");
      console.log(`  EXIT ${pos.symbol} ${res.success ? `at ${pnl.toFixed(1)}%` : `failed: ${res.error}`}`);
    } else {
      console.log(`  HOLD ${pos.symbol} — pnl ${pnl.toFixed(1)}%`);
    }
  }
  const current = loadState();
  saveState({ ...current, positions: current.positions.map((p) => open.find((o) => o.symbol === p.symbol) ?? p) });

  // 2. Fetch the tradable universe + score.
  const signals = await dataSource.fetchSignals({ limit: 12 });
  console.log(`  universe: ${signals.map((s) => s.symbol).join(", ") || "(empty)"}`);
  const scored = [];
  for (const signal of signals) {
    const klines = await dataSource.fetchHistorical(signal.symbol, 14).catch(() => []);
    const conviction = await factors.score(signal, klines);
    scored.push({ signal, conviction });
    console.log(`  ${signal.symbol}: ${conviction.score} ${conviction.breakdown.map((b) => `${b.name}=${b.score}`).join(" ")}`);
  }
  scored.sort((a, b) => b.conviction.score - a.conviction.score);

  // 3. Enter the best candidate if conviction clears the bar.
  const top = scored[0];
  const stateNow = loadState();
  if (top && top.conviction.score >= ENTRY_MIN_CONVICTION && !stateNow.positions.some((p) => p.symbol === top.signal.symbol)) {
    const pf = await portfolio();
    const risk = executor.manageRisk(top, pf);
    if (risk.approved) {
      const res = await executor.placeOrder(top, { sizeUsd: risk.maxPositionUsd ?? 0, side: "long" });
      console.log(`  BUY ${top.signal.symbol} $${res.executedValueUsd?.toFixed(0)} — ${top.conviction.rationale}`);
    } else {
      record(stateNow.cycle + 1, top.signal.symbol, "SKIP", top.conviction.score, `risk veto: ${risk.reason}`, {});
      console.log(`  SKIP ${top.signal.symbol} — ${risk.reason}`);
    }
  } else if (top) {
    record(stateNow.cycle + 1, top.signal.symbol, "SKIP", top.conviction.score, `conviction below ${ENTRY_MIN_CONVICTION}`, {});
    console.log(`  SKIP — best conviction ${top.conviction.score} < ${ENTRY_MIN_CONVICTION}`);
  }
}

const cycles = opt("--cycles", 1);
const intervalSec = opt("--interval", 60);
console.log(`domain: ${DOMAIN_PROFILES.ryo.domain} → ${JSON.stringify(DOMAIN_PROFILES.ryo.adapters)}`);
if (!(await dataSource.healthCheck())) console.warn("warning: RYO data source health check failed — results may be stale/empty");

for (let i = 0; i < cycles; i++) {
  try {
    await cycle();
  } catch (e) {
    console.error("cycle error:", e);
  }
  if (i < cycles - 1) await new Promise((r) => setTimeout(r, intervalSec * 1000));
}
console.log(`\ndone — ledger at ${LEDGER_PATH} (--verify to audit)`);
