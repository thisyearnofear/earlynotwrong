#!/usr/bin/env node
/**
 * Live demo of the Solana pre-trade safety gate.
 *
 *   npx tsx agent/scripts/solana-safety-demo.mjs
 *   npx tsx agent/scripts/solana-safety-demo.mjs <mint>
 *
 * Runs agent/lib/solana-safety.ts (vendored from solana-safe-trade-skill)
 * against a small set of canonical Solana mints — or a single mint you pass
 * on the command line — and prints a verdict table. No transactions are
 * submitted; this is purely a pre-trade gate dry-run.
 *
 * When earlynotwrong's agent grows a Solana executor (parity with
 * lib/twak-executor.ts for BSC), every prospective swap will pass through
 * checkTokenSafety() before any sign/send call.
 */

import { checkTokenSafety } from "../lib/solana-safety.ts";

const CANONICAL_MINTS = [
  { mint: "So11111111111111111111111111111111111111112", label: "Wrapped SOL" },
  { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", label: "USDC" },
  { mint: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", label: "USDT" },
  { mint: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN", label: "JUP" },
  { mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", label: "BONK" },
  { mint: "jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL", label: "JTO" },
  { mint: "HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3", label: "PYTH" },
];

const arg = process.argv[2];
const list = arg ? [{ mint: arg, label: "user-supplied" }] : CANONICAL_MINTS;

console.log(`[solana-safety-demo] checking ${list.length} mint(s)…\n`);

const rows = [];
for (const { mint, label } of list) {
  const t0 = Date.now();
  const verdict = await checkTokenSafety(mint, {});
  const ms = Date.now() - t0;
  const liq = verdict.evidence.dexLiquidity
    ? `$${Math.round(verdict.evidence.dexLiquidity.liquidityUsd).toLocaleString()}`
    : "—";
  const vol = verdict.evidence.dexLiquidity
    ? `$${Math.round(verdict.evidence.dexLiquidity.volume24hUsd).toLocaleString()}`
    : "—";
  const status = verdict.ok ? "✅ pass" : `❌ fail @ ${verdict.gateFailed}`;
  rows.push({ label, status, liq, vol, ms, reason: verdict.reason });
  const reasonSuffix = verdict.ok ? "" : `  (${verdict.reason})`;
  console.log(`  ${status.padEnd(20)}  ${label.padEnd(14)}  liq ${liq.padEnd(18)}  vol ${vol.padEnd(15)}  ${ms}ms${reasonSuffix}`);
}

const passed = rows.filter((r) => r.status.includes("pass")).length;
console.log(`\nSummary: ${passed}/${rows.length} passed.`);
