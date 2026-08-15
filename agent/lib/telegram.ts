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

import type { SwapResult } from "./twak-executor.js";
import { getSubscriberChatIds } from "./telegram-subscribers.js";
import { crooStoreUrl, dashboardHireUrl, integrationGuideUrl } from "./marketing-urls.js";

const TELEGRAM_API = "https://api.telegram.org/bot";

/** Small delay between subscriber sends — stays well under Telegram's ~30 msg/s. */
const SUBSCRIBER_SEND_DELAY_MS = 50;

/**
 * Check if Telegram is configured (operator channel).
 */
function isConfigured(): boolean {
  return !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
}

/**
 * Check if the bot token alone is set — enough to broadcast to /start
 * subscribers even without an operator TELEGRAM_CHAT_ID.
 */
function hasToken(): boolean {
  return !!process.env.TELEGRAM_BOT_TOKEN;
}

/**
 * Send a raw text message to a Telegram chat (defaults to the operator
 * channel). Silently skips if the token or target chat is not set.
 */
async function sendMessage(
  text: string,
  chatId: string | undefined = process.env.TELEGRAM_CHAT_ID
): Promise<void> {
  if (!hasToken() || !chatId) return;

  const token = process.env.TELEGRAM_BOT_TOKEN!;

  try {
    const res = await fetch(`${TELEGRAM_API}${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Telegram's API is usually fast, but a stalled connection here would
      // hang the runner's loop — hard cap, non-fatal on abort.
      signal: AbortSignal.timeout(10_000),
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
 * Broadcast a PUBLIC trade message: operator channel (existing behavior)
 * plus fan-out to every /start subscriber. Sequential with a small delay so
 * we stay politely under Telegram's rate limits. Only entry/exit alerts go
 * through here — operator-only messages (errors, guardrails, cycle
 * summaries, startup) must keep using sendMessage directly.
 */
async function broadcastMessage(text: string): Promise<void> {
  await sendMessage(text);

  if (!hasToken()) return;

  const operatorChatId = process.env.TELEGRAM_CHAT_ID;
  for (const chatId of getSubscriberChatIds()) {
    // The operator may have DM'd /start too — don't double-send.
    if (chatId === operatorChatId) continue;
    await sendMessage(text, chatId);
    await new Promise((r) => setTimeout(r, SUBSCRIBER_SEND_DELAY_MS));
  }
}

/**
 * Send a formatted cycle summary to Telegram.
 *
 * Splits into 3 structured messages for readability:
 *   1. Cycle header + regime scoring
 *   2. Conviction signals + trades + market narrative
 *   3. Portfolio + P&L + anchoring
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
  gasSpentThisCycle?: number;
  totalGasSpent?: number;
  realizedPnl?: number;
  topSignals?: Array<{
    symbol: string;
    score: number;
    rationale: string;
    holderCount: number | null;
    holderGrowthPercent: number | null;
  }>;
  /** Market narrative generated from SoSoValue feeds + conviction data. */
  narrative?: {
    headline: string | null;
    summary: string;
    newsCount: number;
    macroEventCount: number;
  } | null;
  /** Whether any trades used SoDEX execution this cycle. */
  usedSodex?: boolean;
  /** BSC wallet address to link in the footer. */
  walletAddress?: string;
}): Promise<void> {
  if (!isConfigured()) return;

  const displayStatus = params.status === "idle" ? "completed" : params.status;
  const gas = params.gasSpentThisCycle ?? 0;

  // =========================================================================
  // Message 1 — Cycle Header + Regime
  // =========================================================================
  const msg1: string[] = [
    `📊 <b>Cycle #${params.cycle}</b> — <code>${params.duration}</code> — ${displayStatus}`,
    `───`,
  ];

  // Regime box
  if (params.regimeScore !== null && params.sentimentLabel) {
    const fgiLine = params.regimeScore >= 60 ? "🟢" : params.regimeScore <= 30 ? "🔴" : "🟡";
    msg1.push(`${fgiLine} Regime: <b>${params.regimeScore}/100</b> — ${params.sentimentLabel}`);
    msg1.push(`   Drawdown: <code>${params.drawdownPercent.toFixed(1)}%</code>`);
  }

  await sendMessage(msg1.join("\n"));

  // =========================================================================
  // Message 2 — Signals + Trades + Narrative
  // =========================================================================
  const msg2: string[] = [`📈 <b>Signals &amp; Trades</b>`];

  // Top signals in a code block
  if (params.topSignals && params.topSignals.length > 0) {
    msg2.push(``);
    msg2.push(`<pre>${params.topSignals.slice(0, 5).map((s) => {
      const h = s.holderCount != null
        ? `  ${s.holderCount.toLocaleString().padStart(9)} holders`
        : "";
      const scoreStr = s.score.toString().padStart(3);
      return `${s.symbol.padEnd(7)} ${scoreStr}/100${h}`;
    }).join("\n")}</pre>`);
  }

  // Per-trade lines in a code block
  if (params.executedTrades.length > 0) {
    msg2.push(``);
    const tradeParts: string[] = [];
    if (params.tradesSucceeded > 0) tradeParts.push(`✅${params.tradesSucceeded}`);
    if (params.tradesFailed > 0) tradeParts.push(`❌${params.tradesFailed}`);
    let tradeLine = `Trades: ${tradeParts.join(" ")}`;
    if (params.totalVolumeUsd > 0) tradeLine += ` · vol <code>$${params.totalVolumeUsd.toFixed(0)}</code>`;
    if (params.usedSodex) tradeLine += ` · SoDEX`;
    if (gas > 0) tradeLine += ` · gas <code>~$${gas.toFixed(2)}</code>`;
    msg2.push(tradeLine);

    const tradeLines = params.executedTrades.map((trade) => {
      const icon = trade.success ? "✅" : "❌";
      const out = trade.amountOut ? `$${trade.amountOut}` : trade.success ? "✓" : "✗";
      const venue = trade.txHash?.startsWith("0xSODEX_") ? "SoDEX" : "TWAK";
      let line = `${icon} [<code>${venue}</code>] ${trade.tokenIn}→${trade.tokenOut} <code>$${trade.amountIn}→${out}</code>`;
      if (trade.txHash) {
        const explorerUrl = trade.txHash.startsWith("0xSODEX_")
          ? `https://testnet.sodex.dev/order/${trade.txHash.slice(8)}`
          : `https://bscscan.com/tx/${trade.txHash}`;
        line += ` <a href="${explorerUrl}">tx</a>`;
      }
      return line;
    });
    msg2.push(`<pre>${tradeLines.join("\n")}</pre>`);
  }

  // Market narrative
  if (params.narrative) {
    msg2.push(``);
    const n = params.narrative;
    if (n.headline) {
      msg2.push(`📰 <b>Headline</b>`);
      msg2.push(`<pre>${escapeHtml(n.headline)}</pre>`);
    }
    const meta = [];
    if (n.newsCount > 0) meta.push(`<code>${n.newsCount} news</code>`);
    if (n.macroEventCount > 0) meta.push(`<code>${n.macroEventCount} macro events</code>`);
    if (meta.length > 0) msg2.push(`  Sources: ${meta.join(" · ")}`);
  }

  await sendMessage(msg2.join("\n"));

  // =========================================================================
  // Message 3 — Portfolio + P&L + Anchoring
  // =========================================================================
  const msg3: string[] = [`💰 <b>Portfolio &amp; P&amp;L</b>`];

  const invested = params.positionLedgerUsd ?? 0;
  const realized = params.realizedPnl ?? 0;
  const totalGas = params.totalGasSpent ?? 0;
  const unrealized = params.portfolioValueUsd - invested;
  const netPnl = unrealized + realized - totalGas;
  const pnlSign = netPnl >= 0 ? "+" : "";

  msg3.push(`<pre>Invested:    $${invested.toFixed(2).padStart(9)} (${params.positionsHeld ?? 0} pos)`);
  msg3.push(`On-chain:    $${params.portfolioValueUsd.toFixed(2).padStart(9)}`);
  msg3.push(`Gas spent:   $${totalGas.toFixed(2).padStart(9)}`);
  if (realized !== 0) msg3.push(`Realized:    ${realized >= 0 ? "+" : ""}$${realized.toFixed(2).padStart(8)}`);
  msg3.push(`<b>Net P&amp;L:    ${pnlSign}$${netPnl.toFixed(2).padStart(8)}</b></pre>`);

  if (params.anchoring) {
    const modeIcon = params.anchoring.mode === "on-chain" ? "⚓" : params.anchoring.mode === "simulator" ? "🔄" : "⚠";
    let anchorLine = `${modeIcon} <b>Anchor</b>: ${params.anchoring.mode}`;
    if (params.anchoring.blockNumber) anchorLine += ` · block <code>${params.anchoring.blockNumber}</code>`;
    if (params.anchoring.hash) {
      anchorLine += ` · <a href="https://explorer.sepolia.mantle.xyz/tx/${params.anchoring.hash}">verify</a>`;
    }
    msg3.push(anchorLine);
  }

  const walletAddress = params.walletAddress ?? process.env.AGENT_WALLET_KEY ?? process.env.AGENT_WALLET_ADDRESS;
  if (typeof walletAddress === "string" && /^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
    const short = `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`;
    msg3.push(`<i>👛 <a href="https://bscscan.com/address/${walletAddress}">${short}</a> · BSC Mainnet</i>`);
  }

  await sendMessage(msg3.join("\n"));
}

/**
 * Send a startup notification to Telegram.
 */
export async function sendStartup(params: {
  twakMode: string;
  cmcConnected: boolean;
  sosovalueConnected: boolean;
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
    `SoSoValue: ${params.sosovalueConnected ? "✅ connected" : "❌ offline — CMC fallback"}`,
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
 * Send a position-entry alert — the agent's public trade narrative.
 * Broadcast to the operator channel AND all /start subscribers.
 */
export async function sendEntryAlert(params: {
  cycle: number;
  symbol: string;
  amountUsd: number;
  convictionScore: number;
  rationale: string;
  txHash?: string;
}): Promise<void> {
  if (!hasToken()) return;

  const lines: string[] = [
    `🟢 <b>ENTRY</b> ${escapeHtml(params.symbol)} — cycle #${params.cycle}`,
    `<code>$${params.amountUsd.toFixed(2)} · conviction ${params.convictionScore}/100</code>`,
    `<i>${escapeHtml(params.rationale)}</i>`,
  ];
  if (params.txHash) {
    const url = params.txHash.startsWith("0xSODEX_")
      ? `https://testnet.sodex.dev/order/${params.txHash.slice(8)}`
      : `https://bscscan.com/tx/${params.txHash}`;
    lines.push(`<a href="${url}">tx</a>`);
  }

  await broadcastMessage(lines.join("\n"));
}

/**
 * Send a position-exit alert. One message per closed (or partially closed)
 * position so judges can see live decisions in the Telegram timeline.
 * Broadcast to the operator channel AND all /start subscribers.
 */
export async function sendExitAlert(params: {
  cycle: number;
  symbol: string;
  action: "EXIT_STOP" | "EXIT_TRAIL" | "EXIT_PARTIAL";
  reason: string;
  pnlPercent: number;
  amountUsd: number;
  sellFraction: number;
  txHash?: string;
}): Promise<void> {
  if (!hasToken()) return;

  const icon =
    params.action === "EXIT_STOP" ? "🛑" :
    params.action === "EXIT_TRAIL" ? "🎯" :
    "✂️";
  const pnlSign = params.pnlPercent >= 0 ? "+" : "";
  const fractionLabel = params.sellFraction >= 0.99 ? "full exit" : `${Math.round(params.sellFraction * 100)}% of position`;

  const lines: string[] = [
    `${icon} <b>${params.action.replace("EXIT_", "")}</b> ${escapeHtml(params.symbol)} — cycle #${params.cycle}`,
    `<code>${pnlSign}${params.pnlPercent.toFixed(1)}% PnL · $${params.amountUsd.toFixed(2)} ${fractionLabel}</code>`,
    `<i>${escapeHtml(params.reason)}</i>`,
  ];
  if (params.txHash) {
    const url = params.txHash.startsWith("0xSODEX_")
      ? `https://testnet.sodex.dev/order/${params.txHash.slice(8)}`
      : `https://bscscan.com/tx/${params.txHash}`;
    lines.push(`<a href="${url}">tx</a>`);
  }

  await broadcastMessage(lines.join("\n"));
}

const CROO_STORE_URL = crooStoreUrl("telegram", "guidance-broadcast");
const DASHBOARD_HIRE_URL = dashboardHireUrl("telegram");
const INTEGRATION_GUIDE_URL = integrationGuideUrl("telegram", "guidance-broadcast");

const GUIDANCE_ACTION_LABELS: Record<string, string> = {
  evaluate: "✅ Evaluate",
  skip_entries: "⛔ Skip entries",
  wait: "⏳ Wait",
};

/**
 * Public-safe cycle guidance for /start subscribers + operator channel.
 * Full ranked signals remain behind CROO / MCP hire.
 */
export async function sendGuidanceBroadcast(params: {
  cycle: number;
  guidance: {
    recommendedAction: string;
    reason: string;
    topCandidate: string | null;
    sizeMultiplier: number;
  };
  stale: boolean;
  signalCount: number;
}): Promise<void> {
  if (!hasToken()) return;

  const actionLabel =
    GUIDANCE_ACTION_LABELS[params.guidance.recommendedAction] ??
    params.guidance.recommendedAction;

  const lines: string[] = [
    `🎯 <b>Cycle #${params.cycle} guidance</b>${params.stale ? " · <i>stale</i>" : ""}`,
    `<code>${actionLabel}</code>${
      params.guidance.topCandidate
        ? ` · ${escapeHtml(params.guidance.topCandidate)}`
        : ""
    }`,
    `<i>${escapeHtml(params.guidance.reason)}</i>`,
  ];

  if (params.signalCount > 1) {
    lines.push(
      `<i>${params.signalCount} ranked signals this cycle — full list + provenance via hire</i>`,
    );
  }

  lines.push(
    `<i>Allocator agents: <a href="${CROO_STORE_URL}">signals-live</a> on CROO ($0.05 USDC) · Requirements: <code>{}</code></i>`,
  );

  lines.push("");
  lines.push(
    `<a href="${CROO_STORE_URL}">Hire on CROO</a> · <a href="${DASHBOARD_HIRE_URL}">Dashboard</a> · <a href="${INTEGRATION_GUIDE_URL}">Integrate</a>`,
  );

  await broadcastMessage(lines.join("\n"));
}

/**
 * Send a guardrail-block alert. Fired when one or more proposals are rejected
 * so judges can see the risk system catching trades before execution.
 */
export async function sendGuardrailBlocked(params: {
  cycle: number;
  rejected: Array<{ tokenSymbol: string; reason: string }>;
  blockedAll?: boolean;
}): Promise<void> {
  if (!isConfigured()) return;
  if (params.rejected.length === 0) return;

  const lines: string[] = [
    `🛡️ <b>Guardrail ${params.blockedAll ? "halt" : "rejections"}</b> — cycle #${params.cycle}`,
  ];
  lines.push(
    `<pre>${params.rejected
      .slice(0, 6)
      .map((r) => `${r.tokenSymbol.padEnd(8)} ${escapeHtml(r.reason).slice(0, 80)}`)
      .join("\n")}</pre>`,
  );
  if (params.rejected.length > 6) {
    lines.push(`<i>…and ${params.rejected.length - 6} more</i>`);
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
 * Send a Delphi prediction-market cycle summary + entry alerts.
 *
 * Compact single message (unlike the 3-message BSC cycle summary) because
 * the Delphi loop is sparse: a few markets, a few entries per cycle.
 */
export async function sendDelphiCycleSummary(params: {
  cycle: number;
  marketsEvaluated: number;
  estimatesProduced: number;
  tradesPlaced: number;
  redeemsSucceeded: number;
  exits?: { convergence: number; stopped: number };
  /** Alpha-stack activity this cycle (provenance of the forecasts). */
  alpha?: { briefings: number; volBaselines: number; cached?: number };
  entries?: Array<{
    question: string;
    outcomeIdx: number;
    effectivePrice?: number;
    estimatedProbability?: number;
    edge: number;
    transactionHash?: string;
    /** Provenance tags for entry lines. */
    model?: string;
    webEvidence?: boolean;
    volAnchor?: number;
  }>;
}): Promise<void> {
  if (!isConfigured()) return;

  const exitPart =
    params.exits && params.exits.convergence + params.exits.stopped > 0
      ? ` · Exits: <code>${params.exits.convergence + params.exits.stopped}</code>`
      : "";
  const alphaPart =
    params.alpha && params.alpha.briefings + params.alpha.volBaselines > 0
      ? `\n   Evidence: <code>${params.alpha.briefings}</code> web briefings · <code>${params.alpha.volBaselines}</code> vol anchors${
          params.alpha.cached ? ` · <code>${params.alpha.cached}</code> cached` : ""
        }`
      : "";
  const lines: string[] = [
    `🔮 <b>Delphi cycle #${params.cycle}</b>`,
    `   Markets: <code>${params.marketsEvaluated}</code> · Estimates: <code>${params.estimatesProduced}</code> · Entries: <code>${params.tradesPlaced}</code> · Redeems: <code>${params.redeemsSucceeded}</code>${exitPart}${alphaPart}`,
  ];

  if (params.entries && params.entries.length > 0) {
    lines.push(``);
    lines.push(`<pre>${params.entries
      .slice(0, 5)
      .map((e) => {
        const price = e.effectivePrice !== undefined ? e.effectivePrice.toFixed(3) : "?";
        const est = e.estimatedProbability !== undefined ? e.estimatedProbability.toFixed(2) : "?";
        // Compact provenance tags — the method behind the number.
        const tags: string[] = [];
        if (e.webEvidence) tags.push("web");
        if (e.volAnchor !== undefined) tags.push("vol");
        if (e.model) tags.push(shortModel(e.model));
        const tagStr = tags.length > 0 ? ` [${tags.join("·")}]` : "";
        return `o${e.outcomeIdx} @ ${price} (est ${est}, edge ${e.edge.toFixed(3)})${tagStr}  ${escapeHtml(e.question.slice(0, 48))}`;
      })
      .join("\n")}</pre>`);
  }

  await sendMessage(lines.join("\n"));
}

/** Shorten a model id for Telegram (drop the org prefix + ensemble suffix). */
function shortModel(model: string): string {
  return model
    .replace(/^(zai|openai|anthropic)\//, "")
    .replace(/ ×\d+ median$/, "");
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
