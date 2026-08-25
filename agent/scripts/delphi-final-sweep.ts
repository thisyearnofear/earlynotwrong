#!/usr/bin/env node
/**
 * Delphi closeout sweep — one-shot post-competition run.
 *
 * The Gensyn arena window closed 2026-08-24T00:00Z and the runner's loop
 * self-exited after the 12h redeem-only grace, so anything that settled
 * late (oracle lag) never got a final redeem pass. This script reuses the
 * runner's own closed-window cycle exactly once — redeem settled, liquidate
 * expired/failed, close tracked forecasts, resolve the all-forecasts log —
 * then prints the final bankroll and ledger state.
 *
 * Usage (on the VPS, from agent/):
 *   npx tsx scripts/delphi-final-sweep.ts
 *
 * Requires the same env as the runner (DELPHI_API_ACCESS_KEY,
 * DELPHI_WALLET_PRIVATE_KEY, AGENT_DATA_DIR), loaded from agent/.env.
 *
 * Post-competition adjustments vs. the live runner:
 *   - force-enabled — works even after DELPHI_ENABLED is flipped off
 *   - Telegram off — no summary spam for a one-off run
 *   - anchoring no-op — a 0-decision closeout record publishes nothing
 *
 * Safe to re-run: the sweep is idempotent — settled markets are already
 * redeemed and out of positions.json, and terminal forecast markets are
 * skipped by the resolution pass.
 */
// Load agent/.env BEFORE any sibling module evaluates (same rule as runner.ts).
import "../lib/env-bootstrap.js";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DelphiExecutor } from "../lib/delphi/executor.js";
import { DelphiRunner } from "../lib/delphi/runner.js";

const TST_DECIMALS = 1_000_000n; // $TST collateral is 6-dec

function fmtTst(tokens: bigint): string {
  const sign = tokens < 0n ? "-" : "";
  const abs = tokens < 0n ? -tokens : tokens;
  return `${sign}${abs / TST_DECIMALS}.${(abs % TST_DECIMALS).toString().padStart(6, "0")}`;
}

function ledgerRows(dir: string, name: string): number {
  const p = join(dir, name);
  if (!existsSync(p)) return 0;
  return readFileSync(p, "utf-8").split("\n").filter((l) => l.trim().length > 0).length;
}

function trackedPositionCount(dir: string): number {
  const p = join(dir, "positions.json");
  if (!existsSync(p)) return 0;
  try {
    return Object.keys(JSON.parse(readFileSync(p, "utf-8")) as Record<string, unknown>).length;
  } catch {
    return 0;
  }
}

function snapshotCyclesRun(dir: string): number {
  const p = join(dir, "snapshot.json");
  if (!existsSync(p)) return 0;
  try {
    return (JSON.parse(readFileSync(p, "utf-8")) as { cyclesRun?: number }).cyclesRun ?? 0;
  } catch {
    return 0;
  }
}

async function main(): Promise<void> {
  const executor = new DelphiExecutor();
  if (executor.isSimulator) {
    console.error(
      "[delphi-closeout] executor is in SIMULATOR mode — DELPHI_API_ACCESS_KEY missing?\n" +
        "Nothing to sweep on-chain; check agent/.env and re-run.",
    );
    process.exitCode = 1;
    return;
  }

  const runner = new DelphiRunner({
    executor,
    telegramEnabled: false,
    enabled: () => true,
    // Closeout publishes no thesis — the arena is over and a 0-decision
    // record has no meaning for registry consumers (and shouldn't spend gas).
    anchor: async () => [],
  });
  const dir = runner.dataDirectory;

  console.log("═══════════════════════════════════════════════════");
  console.log("  DELPHI CLOSEOUT SWEEP (one-shot, post-competition)");
  console.log(`  data dir: ${dir}`);
  console.log("═══════════════════════════════════════════════════");

  const bankrollBefore = BigInt(await executor.getTokenBalance());
  const positionsBefore = trackedPositionCount(dir);
  console.log(`\nBefore: ${fmtTst(bankrollBefore)} TST · ${positionsBefore} tracked position(s)`);

  const result = await runner.runCycle(snapshotCyclesRun(dir) + 1);

  const bankrollAfter = BigInt(await executor.getTokenBalance());
  const positionsAfter = trackedPositionCount(dir);

  console.log("\n── sweep ────────────────────────────────────────────");
  console.log(`  redeems:       attempted=${result.redeemsAttempted} succeeded=${result.redeemsSucceeded} closed-as-loss=${result.redeemsLostClosed}`);
  console.log(`  liquidates:    attempted=${result.liquidatesAttempted} succeeded=${result.liquidatesSucceeded}`);
  console.log(`  exits:         convergence=${result.exitsConvergence} stopped=${result.exitsStopped} held=${result.exitsHeld}`);
  console.log(`  bankroll:      ${fmtTst(bankrollBefore)} → ${fmtTst(bankrollAfter)} TST (Δ ${fmtTst(bankrollAfter - bankrollBefore)})`);
  console.log(`  tracked:       ${positionsBefore} → ${positionsAfter} position(s)`);

  console.log("\n── final ledger state ───────────────────────────────");
  console.log(`  trades.jsonl          ${ledgerRows(dir, "trades.jsonl")} row(s)`);
  console.log(`  forecasts.jsonl       ${ledgerRows(dir, "forecasts.jsonl")} row(s)   (traded-only calibration)`);
  console.log(`  estimates.jsonl       ${ledgerRows(dir, "estimates.jsonl")} row(s)   (every estimate, per outcome)`);
  console.log(`  forecasts-all.jsonl   ${ledgerRows(dir, "forecasts-all.jsonl")} row(s) (all-forecasts calibration)`);

  if (positionsAfter > 0) {
    console.log(`\n⚠ ${positionsAfter} position(s) still tracked — their markets were still open or`);
    console.log("  failed this pass. Re-run this script after they settle, or inspect positions.json.");
  } else {
    console.log("\nAll tracked positions closed. Remaining steps (on the VPS):");
    console.log("  pm2 delete earlynotwrong-delphi");
    console.log("  # set DELPHI_ENABLED=0 in agent/.env (already archived in config.ts)");
    console.log("  # optionally sweep remaining TST out of the competition wallet");
  }
}

main().catch((err) => {
  console.error("[delphi-closeout] fatal:", err);
  process.exit(1);
});
