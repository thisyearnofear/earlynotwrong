/**
 * Telegram Dispatch Module
 *
 * Sends cycle summaries, startup notifications, and error alerts
 * to the Telegram channel configured in manifest.json.
 *
 * Uses Node's built-in fetch (18+) — no extra dependencies.
 * Reads TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID from env.
 * Gracefully no-ops when env vars are not set (simulator mode).
 */

import { getBscExplorerTxUrl } from "./mantle.js";
import type { SwapResult } from "./twak-executor.js";

const TELEGRAM_API = "https://api.telegram.org/bot";

/**
 * Check if Telegram is configured.
 */
function isConfigured(): boolean {
  return !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
}

/**
 * Send a raw text message to the Telegram channel.
 * Silently skips if env vars are not set.
 */
async function sendMessage(text: string): Promise<void> {
  if (!isConfigured()) return;

  const token = process.env.TELEGRAM_BOT_TOKEN!;
  const chatId = process.env.TELEGRAM_CHAT_ID!;

  try {
    const res = await fetch(`${TELEGRAM_API}${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "(no body)");
      console.error(`[telegram] sendMessage failed (${res.status}): ${body}`);
    }
  } catch (err) {
    // Network errors are non-fatal — log and continue
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[telegram] sendMessage error: ${message}`);
  }
}

/**
 * Send a formatted cycle summary to Telegram.
 */
export async function sendCycleSummary(params: {
  cycle: number;
  duration: string;
  status: string;
  tradesSucceeded: number;
  tradesFailed: number;
  totalVolumeUsd: number;
  portfolioValueUsd: number;
  drawdownPercent: number;
  regimeScore: number | null;
  sentimentLabel: string | null;
  anchoring: {
    mode: string;
    blockNumber?: number;
    gasUsed?: string;
    hash?: string;
  } | null;
  executedTrades: SwapResult[];
  errors: string[];
  positionLedgerUsd?: number;
  positionsHeld?: number;
  topSignals?: Array<{
    symbol: string;
    score: number;
    rationale: string;
    holderCount: number | null;
    holderGrowthPercent: number | null;
  }>;
}): Promise<void> {
  if (!isConfigured()) return;

  const statusEmoji =
    params.status === "error" ? "🔴" : params.anchoring?.mode === "on-chain" ? "🟢" : "🟡";

  const displayStatus = params.status === "idle" ? "completed" : params.status;
  const lines: string[] = [
    `${statusEmoji} <b>Cycle #${params.cycle} — ${params.duration}</b>`,
    `Status: ${displayStatus}`,
    ``,
  ];

  // Conviction regime
  if (params.regimeScore !== null && params.sentimentLabel) {
    lines.push(`<b>Regime</b>`);
    lines.push(`  ${params.regimeScore}/100 — ${params.sentimentLabel}`);
    lines.push(``);
  }

  // Top conviction signals
  if (params.topSignals && params.topSignals.length > 0) {
    lines.push(`<b>Top Signals</b>`);
    for (const s of params.topSignals.slice(0, 5)) {
      let holderInfo = "";
      if (s.holderCount != null) {
        holderInfo = ` · ${s.holderCount.toLocaleString()} holders`;
        if (s.holderGrowthPercent != null) {
          const sign = s.holderGrowthPercent >= 0 ? "+" : "";
          holderInfo += ` (${sign}${s.holderGrowthPercent.toFixed(1)}%)`;
        }
      }
      lines.push(`  <b>${s.symbol}</b> ${s.score}/100${holderInfo}`);
      lines.push(`    <i>${s.rationale}</i>`);
    }
    lines.push(``);
  }

  // Trades
  if (params.tradesSucceeded > 0 || params.tradesFailed > 0) {
    lines.push(`<b>Trades</b>`);
    lines.push(`  ✅ ${params.tradesSucceeded} succeeded`);
    if (params.tradesFailed > 0) lines.push(`  ❌ ${params.tradesFailed} failed`);
    if (params.totalVolumeUsd > 0) lines.push(`  Vol: $${params.totalVolumeUsd.toFixed(2)}`);
    lines.push(``);

    for (const trade of params.executedTrades) {
      const icon = trade.success ? "✅" : "❌";
      const out = trade.amountOut ? `$${trade.amountOut}` : trade.success ? "✓" : "✗";
      let line = `${icon} ${trade.tokenIn} → ${trade.tokenOut}: $${trade.amountIn} → ${out}`;
      if (trade.txHash) {
        const url = `https://bscscan.com/tx/${trade.txHash}`;
        line += `\n    <a href="${url}">${url}</a>`;
      }
      lines.push(line);
    }
    lines.push(``);
  }

  // Portfolio
  lines.push(`<b>Portfolio</b>`);
  lines.push(`  On-chain: $${params.portfolioValueUsd.toFixed(2)}`);
  if (params.positionLedgerUsd) {
    lines.push(`  Positions: $${params.positionLedgerUsd.toFixed(2)} (${params.positionsHeld ?? "?"} held)`);
  }
  lines.push(`  Drawdown: ${params.drawdownPercent.toFixed(1)}%`);
  lines.push(``);

  // Anchoring
  if (params.anchoring) {
    const modeIcon =
      params.anchoring.mode === "on-chain" ? "✅" :
      params.anchoring.mode === "simulator" ? "🔄" :
      "⚠️";
    lines.push(`<b>Anchoring</b>`);
    lines.push(`  ${modeIcon} ${params.anchoring.mode}`);
    if (params.anchoring.blockNumber) lines.push(`  Block: ${params.anchoring.blockNumber}`);
    if (params.anchoring.gasUsed) lines.push(`  Gas: ${params.anchoring.gasUsed}`);
    if (params.anchoring.hash) {
      const mantleUrl = `https://explorer.sepolia.mantle.xyz/tx/${params.anchoring.hash}`;
      lines.push(`  <a href="${mantleUrl}">Verify on Mantle Explorer</a>`);
    }
    lines.push(``);
  }

  // Verification footer
  lines.push(`<i>Wallet: <a href="https://bscscan.com/address/0xA1Dd482E4D6C8cf6f5f7BF80FEc6Bd3F11F5888a">0xA1Dd...888a</a> · BSC Mainnet</i>`);

  // Errors
  if (params.errors.length > 0) {
    lines.push(`<b>Errors (${params.errors.length})</b>`);
    for (const err of params.errors.slice(0, 3)) {
      lines.push(`  ⚠️ ${err.slice(0, 200)}`);
    }
    if (params.errors.length > 3) lines.push(`  ... and ${params.errors.length - 3} more`);
    lines.push(``);
  }

  await sendMessage(lines.join("\n"));
}

/**
 * Send a startup notification to Telegram.
 */
export async function sendStartup(params: {
  twakMode: string;
  cmcConnected: boolean;
  walletAddress: string | null;
  isTestnet: boolean;
  topK: number;
  intervalMinutes: number;
  maxDrawdown: number;
}): Promise<void> {
  if (!isConfigured()) return;

  const lines: string[] = [
    `🤖 <b>Early, Not Wrong — Agent Started</b>`,
    ``,
    `TWAK: ${params.twakMode}`,
    `CMC: ${params.cmcConnected ? "✅ connected" : "❌ unavailable"}`,
    `Network: ${params.isTestnet ? "BSC Testnet 🧪" : "BSC Mainnet 🚀"}`,
    ``,
    `Top-K: ${params.topK}`,
    `Interval: ${params.intervalMinutes} min`,
    `Max drawdown: ${params.maxDrawdown}%`,
  ];

  if (params.walletAddress) {
    lines.push(`Wallet: ${params.walletAddress.slice(0, 10)}...${params.walletAddress.slice(-4)}`);
  }

  await sendMessage(lines.join("\n"));
}

/**
 * Send an error alert to Telegram.
 */
export async function sendErrorAlert(params: {
  cycle: number;
  error: string;
  stack?: string;
}): Promise<void> {
  if (!isConfigured()) return;

  const lines: string[] = [
    `🔴 <b>Cycle #${params.cycle} Failed</b>`,
    ``,
    `<code>${escapeHtml(params.error.slice(0, 500))}</code>`,
  ];

  if (params.stack) {
    const shortStack = params.stack.split("\n").slice(0, 5).join("\n");
    lines.push(``);
    lines.push(`<pre>${escapeHtml(shortStack)}</pre>`);
  }

  await sendMessage(lines.join("\n"));
}

/**
 * Escape HTML special characters for Telegram's parse_mode=HTML.
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
