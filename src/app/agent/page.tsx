"use client";

import { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { Navbar } from "@/components/layout/navbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { TunnelBackground } from "@/components/ui/tunnel-background";
import { CasperWalletConnect } from "@/components/casper-wallet-connect";
import { CasperWalletProvider } from "@/components/casper-wallet-provider";
import { RecentAnchors } from "@/components/recent-anchors";
import { cn } from "@/lib/utils";
import {
  Activity,
  TrendingUp,
  Shield,
  AlertTriangle,
  DollarSign,
  RefreshCw,
  ExternalLink,
  CheckCircle2,
  XCircle,
  ChevronRight,
  Zap,
  BarChart3,
  Globe,
  FileText,
  Sparkles,
  Signal,
  Network,
  Send,
} from "lucide-react";

// ─── Types ───

interface AgentStatus {
  agent: string;
  version: string;
  status: string;
  cycle: number;
  lastRunAt: number;
  nextRunAt: number;
  totalTrades: number;
  totalVolumeUsd: number;
  errors: number;
  /** Public "watch this agent" Telegram channel — null when unconfigured. */
  telegram?: {
    botUsername: string;
    subscriberCount: number;
  } | null;
  portfolio: {
    totalValueUsd: number;
    positions: number;
    chains: string[];
  };
  guardrails: {
    drawdownPercent: number;
    peakValueUsd: number;
    tradesToday: number;
    dailyLimit: number;
    drawdownExceeded: boolean;
    allOk: boolean;
  };
  metrics?: {
    realizedPnlUsd: number;
    totalGasSpentUsd: number;
    netPnlUsd: number;
    winRate: number;
    totalEntries: number;
    totalExits: number;
    winningExits: number;
    losingExits: number;
    totalWinsUsd: number;
    totalLossesUsd: number;
    averageWinUsd: number;
    averageLossUsd: number;
    largestWinUsd: number;
    largestLossUsd: number;
    profitFactor: number;
  };
  behavioralMetrics?: {
    score: number;
    archetype: string;
    winRate: number;
    avgHoldingPeriod: number;
    totalPositions: number;
    earlyExits: number;
    upsideCapture: number;
    patienceTax: number;
  } | null;
}

interface Trade {
  timestamp: number;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  success: boolean;
}

interface TradesResponse {
  totalSessionTrades: number;
  totalVolumeUsd: number;
  recentTrades: Trade[];
}

interface ConvictionData {
  regime: {
    score: number;
    label: string;
    fearGreedIndex: number | null;
    fearLevel: string;
    /** SoSoValue SSI index confirmation in [−1, +1], or null when offline. */
    ssiConfirmation: number | null;
  } | null;
  marketData: {
    fearGreedIndex: number;
    fearGreedLabel: string;
    totalMarketCapUsd: number;
    btcFundingRate: number;
    ethFundingRate: number;
    tokensTracked: number;
  } | null;
  signals: Array<{
    symbol: string;
    score: number;
    breakdown: {
      contrarian: number;
      rsi: number;
      quality: number;
      regime: number;
      holders: number;
      volatilityPenalty: number;
      /** SoSoValue news sentiment adjustment (signed, ±10pp). */
      news: number;
    };
    /** Active signal weights for this regime. */
    weights: {
      contrarian: number;
      rsi: number;
      quality: number;
      regime: number;
      holders: number;
      volatilityPenaltyMax: number;
      newsMax: number;
    };
    holderCount: number | null;
    holderGrowthPercent: number | null;
    /** Net news sentiment in [−1, +1], or null if no related news in this cycle. */
    newsSentiment: number | null;
    rationale: string;
  }>;
  heldPositions: Array<{
    symbol: string;
    entryPriceUsd: number;
    amountUsd: number;
    entryCycle: number;
    cyclesHeld: number;
    peakPriceUsd: number;
    maxUnderwaterPercent: number;
    stuck?: boolean;
    failedExitAttempts?: number;
  }>;
  positionVerdicts: Array<{
    symbol: string;
    action: "HOLD" | "EXIT_STOP" | "EXIT_TRAIL";
    unrealizedPnLPercent: number;
    drawdownFromPeakPercent: number;
    heldThroughDrawdown: boolean;
    reason: string;
  }>;
  portfolio: {
    totalValueUsd: number;
    drawdownPercent: number;
    positions: Array<{ symbol: string; valueUsd: number }>;
  };
  narrative: {
    summary: string;
    headline: string | null;
    newsCount: number;
    macroEventCount: number;
    generatedAt: string;
  } | null;
  /** Macro event pause from SoSoValue calendar — drives entry sizing this cycle. */
  macroPause: {
    clear: boolean;
    skipEntries: boolean;
    sizeMultiplier: number;
    hoursUntilNext: number | null;
    reason: string;
    triggeringEvent: {
      name: string;
      date: string;
      impact: "high" | "medium" | "low";
    } | null;
  } | null;
  anchoredHash: string;
  anchoredUrl: string;
  anchoring: { hash: string; mode: string } | null;
  /** Per-adapter anchor results — one entry per chain (Mantle, Casper). */
  anchorResults?: Array<{
    adapter: string;
    status: "success" | "skipped" | "failed";
    txHash?: string;
    blockNumber?: number;
    explorerUrl?: string;
    error?: string;
  }>;
}

// ─── Constants ───

const REFRESH_INTERVAL = 30_000; // 30s

const PIPELINE_STEPS = [
  { label: "Portfolio", icon: Globe, desc: "TWAK balance", color: "text-blue-400", bgGlow: "bg-blue-500/5" },
  { label: "Data Sources", icon: Globe, desc: "SoSoValue · CMC · FGI", color: "text-purple-400", bgGlow: "bg-purple-500/5" },
  { label: "Regime", icon: Signal, desc: "Contrarian 0–100", color: "text-signal", bgGlow: "bg-signal/5" },
  { label: "Positions", icon: Shield, desc: "Cap loss · Trail run", color: "text-emerald-400", bgGlow: "bg-emerald-500/5" },
  { label: "Entries", icon: TrendingUp, desc: "Weakness + quality", color: "text-amber-400", bgGlow: "bg-amber-500/5" },
  { label: "Guardrails", icon: Shield, desc: "Risk limits", color: "text-impatience", bgGlow: "bg-red-500/5" },
  { label: "Execution", icon: Zap, desc: "SoDEX · TWAK", color: "text-purple-400", bgGlow: "bg-purple-500/5" },
  { label: "Anchor + Narrate", icon: FileText, desc: "Mantle · Casper · Feeds", color: "text-cyan-400", bgGlow: "bg-cyan-500/5" },
];

const HERO_STEPS = [
  { icon: Signal, label: "Reading the crowd", detail: "Fear & Greed · Funding rates · Token prices" },
  { icon: TrendingUp, label: "Scoring contrarian conviction", detail: "Quality assets down during fear — never chasing momentum" },
  { icon: Shield, label: "Holding through drawdown", detail: "Capping losses at −35% · Letting winners run past +100%" },
  { icon: Zap, label: "Executing via TWAK", detail: "Self-custody · BSC Mainnet · Agent Wallet Mode" },
  { icon: Network, label: "Serving its reputation", detail: "Other AI agents query the record on Casper via MCP, paying per call through x402" },
];

// ─── Helpers ───

function formatCurrency(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function formatCompact(n: number): string {
  if (n >= 1_000_000_000_000) return `${(n / 1_000_000_000_000).toFixed(1)}T`;
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  return formatCurrency(n);
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  });
}

// ─── Shared Components ───

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span
      className={cn(
        "inline-block w-2 h-2 rounded-full shadow-[0_0_8px]",
        ok ? "bg-patience shadow-patience/50" : "bg-impatience shadow-impatience/50",
      )}
    />
  );
}

function PipelineGrid() {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
      {PIPELINE_STEPS.map((step, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 + i * 0.06, duration: 0.4 }}
          className={cn(
            "flex flex-col items-center text-center p-3 rounded-lg border transition-colors gap-2",
            step.bgGlow,
            "border-border/40 hover:border-signal/20",
          )}
        >
          <step.icon className={cn("w-5 h-5", step.color)} />
          <span className="text-[10px] font-mono uppercase tracking-wider text-foreground">
            {step.label}
          </span>
          <span className="text-[10px] text-foreground-muted leading-tight">{step.desc}</span>
        </motion.div>
      ))}
    </div>
  );
}

// ─── Loading State: Story-Driven Hero ───

function LoadingStory() {
  const [visibleStep, setVisibleStep] = useState(0);

  useEffect(() => {
    if (visibleStep >= HERO_STEPS.length) return;
    const t = setTimeout(() => setVisibleStep((s) => s + 1), 800 + visibleStep * 200);
    return () => clearTimeout(t);
  }, [visibleStep]);

  return (
    <div className="relative z-10 max-w-3xl mx-auto mb-16">
      {/* Ambient Glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-125 h-125 bg-signal/5 rounded-full blur-[100px] -z-10 pointer-events-none" />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center space-y-6"
      >
        {/* Badge */}
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5 }}
          className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-border bg-surface/50 backdrop-blur-sm"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-signal shadow-[0_0_10px_var(--signal)] animate-pulse" />
          <span className="text-[10px] font-mono text-foreground-muted tracking-widest uppercase">
            CONNECTING TO AGENT
          </span>
        </motion.div>

        {/* Title */}
        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.6 }}
          className="text-4xl md:text-6xl font-bold tracking-tight text-foreground leading-tight"
        >
          Early, Not Wrong
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.6 }}
          className="text-base md:text-lg text-foreground-muted max-w-2xl mx-auto leading-relaxed"
        >
          Most traders sell winners too early. This agent is built not to —{" "}
          <span className="text-foreground font-semibold">contrarian entries</span>,{" "}
          <span className="text-foreground font-semibold">held through drawdown</span>,
          capped only when the thesis breaks.
        </motion.p>

        {/* Connection Steps */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5, duration: 0.6 }}
          className="max-w-md mx-auto mt-8 space-y-3 text-left"
        >
          {HERO_STEPS.map((step, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, x: -10 }}
              animate={{
                opacity: visibleStep > i ? 1 : 0.3,
                x: 0,
              }}
              transition={{ delay: i * 0.15, duration: 0.4 }}
              className={cn(
                "flex items-center gap-4 p-3 rounded-lg border transition-all duration-500",
                visibleStep > i
                  ? "border-border/60 bg-surface/40"
                  : "border-transparent",
              )}
            >
              <div className={cn(
                "relative flex items-center justify-center w-8 h-8 rounded-full border transition-all duration-500",
                visibleStep > i
                  ? "border-signal/40 bg-signal/10"
                  : "border-border/30 bg-surface/30",
              )}>
                {/* Honest progress: this component only renders while the
                    agent fetch is still in flight, so no step is ever DONE
                    here — revealed steps pulse as in-progress instead of
                    showing a checkmark. The dashboard replaces this view
                    the moment the fetch actually resolves. */}
                <step.icon
                  className={cn(
                    "w-4 h-4 transition-colors",
                    visibleStep > i
                      ? "text-signal animate-pulse"
                      : "text-foreground-muted",
                  )}
                />
              </div>
              <div className="flex-1 min-w-0">
                <p className={cn(
                  "text-sm font-medium transition-colors",
                  visibleStep > i ? "text-foreground" : "text-foreground-muted",
                )}>
                  {step.label}
                </p>
                <p className="text-xs text-foreground-muted/60 font-mono">
                  {step.detail}
                </p>
              </div>
              {visibleStep === i && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="flex gap-1"
                >
                  {[0, 1, 2].map((d) => (
                    <motion.span
                      key={d}
                      animate={{ opacity: [0.3, 1, 0.3] }}
                      transition={{ delay: d * 0.2, duration: 1.2, repeat: Infinity }}
                      className="w-1 h-1 rounded-full bg-signal"
                    />
                  ))}
                </motion.div>
              )}
            </motion.div>
          ))}
        </motion.div>

        {/* 3-Step Progress for longer loads */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: visibleStep >= HERO_STEPS.length ? 1 : 0 }}
          transition={{ duration: 0.6 }}
          className="mt-10 max-w-sm mx-auto w-full"
        >
          {/* All three phases are genuinely in flight until the fetch
              resolves (at which point this whole view is replaced), so
              none may render as done — each dot pulses instead. */}
          <div className="flex items-center gap-0 w-full">
            {["Connect", "Fetch", "Signals"].map((label, i) => (
              <div key={label} className="flex items-center flex-1">
                <div className="flex items-center gap-2">
                  <motion.span
                    animate={{ opacity: [0.3, 1, 0.3] }}
                    transition={{ delay: i * 0.4, duration: 1.5, repeat: Infinity }}
                    className="w-2 h-2 rounded-full bg-signal shadow-[0_0_6px_var(--signal)]"
                  />
                  <span className="text-[10px] font-mono uppercase tracking-wider text-foreground-muted">
                    {label}
                  </span>
                </div>
                {i < 2 && (
                  <div className="flex-1 h-px mx-3 bg-gradient-to-r from-signal/40 to-foreground-dim/10" />
                )}
              </div>
            ))}
          </div>
          <p className="text-[10px] text-foreground-muted/50 font-mono text-center mt-3">
            Loading on-chain portfolio and market data…
          </p>
        </motion.div>
      </motion.div>
    </div>
  );
}

// ─── Error State ───

function ErrorState({
  error,
  onRetry,
}: {
  error: string;
  onRetry: () => void;
}) {
  return (
    <div className="relative z-10 max-w-2xl mx-auto">
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-125 h-125 bg-impatience/5 rounded-full blur-[100px] -z-10 pointer-events-none" />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center space-y-8"
      >
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-impatience/30 bg-impatience/5">
          <span className="w-1.5 h-1.5 rounded-full bg-impatience shadow-[0_0_10px_rgb(239,68,68)]" />
          <span className="text-[10px] font-mono text-impatience tracking-widest uppercase">
            CONNECTION ERROR
          </span>
        </div>

        <div className="space-y-3">
          <AlertTriangle className="w-10 h-10 text-impatience/60 mx-auto" />
          <h2 className="text-2xl font-bold text-foreground">Agent Unreachable</h2>
          <p className="text-sm text-foreground-muted max-w-lg mx-auto leading-relaxed">
            The trading agent runs on the agent host. It may be mid-cycle or
            the connection timed out — retrying usually works.
          </p>
        </div>

        <div className="flex items-center justify-center gap-3">
          <Button
            variant="default"
            size="sm"
            onClick={onRetry}
            className="rounded-full"
          >
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
            Retry Connection
          </Button>
          <a
            href="https://asciinema.org/a/ox0AlPA1AN7uwfWJ"
            target="_blank"
            rel="noopener noreferrer"
          >
            <Button
              variant="outline"
              size="sm"
              className="rounded-full text-xs font-mono"
            >
              <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
              Watch Demo Instead
            </Button>
          </a>
        </div>

        <div className="max-w-md mx-auto">
          <details className="text-left">
            <summary className="text-[10px] font-mono text-foreground-muted cursor-pointer hover:text-foreground transition-colors">
              Error details
            </summary>
            <pre className="mt-2 p-3 rounded-lg bg-surface/30 border border-border/50 text-[10px] font-mono text-impatience overflow-x-auto">
              {error}
            </pre>
          </details>
        </div>
      </motion.div>
    </div>
  );
}

// ─── Dashboard ───

function Dashboard({
  status,
  trades,
  conviction,
}: {
  status: AgentStatus;
  trades: TradesResponse | null;
  conviction: ConvictionData | null;
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4 }}
      className="space-y-6"
    >
      {/* Row 0: Orientation — what cold visitors see first.
          The 4-act narrative: the agent is live → it scores conviction →
          it anchors on-chain → you can anchor your own. */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0, duration: 0.4 }}
        className="border-l-2 border-signal/40 pl-4 py-1"
      >
        <p className="text-sm text-foreground">
          A conviction-weighted autonomous trading agent on BSC Mainnet.
          Every cycle is signed and anchored to{" "}
          <span className="text-signal">Casper Testnet + Mantle Sepolia</span>.
        </p>
        <p className="text-[10px] font-mono text-foreground-dim mt-1">
          Live from{" "}
          <span className="text-foreground-muted">the agent&apos;s public API</span> ·{" "}
          ~4h cycles: data → score → manage → execute → anchor → narrate
        </p>
        <p className="text-xs text-foreground-muted mt-1.5 leading-relaxed">
          Scroll to see the agent&apos;s conviction signals, held positions,
          on-chain anchor history, and connect your Casper Wallet to anchor
          your own conviction record. The same{" "}
          <span className="font-mono text-foreground">conviction-core</span>{" "}
          framework that scores the agent&apos;s trades also powers the{" "}
          <Link href="/analyzer" className="text-signal hover:underline">wallet analyzer</Link>.
        </p>

        {/* Cycle pipeline strip — the 8-step autonomous loop */}
        {status && (
          <div className="mt-3 flex items-center gap-1 flex-wrap text-[9px] font-mono">
            <span className="text-foreground-dim uppercase tracking-wider mr-1">Cycle {status.cycle}:</span>
            {[
              { label: "data", icon: "✓" },
              { label: "score", icon: "✓" },
              { label: "manage", icon: "✓" },
              { label: "execute", icon: "✓" },
              { label: "anchor", icon: "✓" },
              { label: "narrate", icon: "✓" },
            ].map((step, i) => (
              <span key={step.label} className="flex items-center gap-0.5">
                <span className="text-patience">{step.icon}</span>
                <span className="text-foreground-muted">{step.label}</span>
                {i < 5 && <span className="text-foreground-dim mx-0.5">→</span>}
              </span>
            ))}
            <span className="text-foreground-dim ml-2">
              · next in {status.nextRunAt ? Math.max(0, Math.round((status.nextRunAt - Date.now()) / 60_000)) : "—"}m
            </span>
          </div>
        )}
      </motion.div>

      {/* Row 0b: Watch this agent — public Telegram alerts. Only rendered
          when the agent reports a live bot identity on /status. */}
      {status.telegram?.botUsername && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.03, duration: 0.4 }}
        >
          <a
            href={`https://t.me/${status.telegram.botUsername}`}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex items-center gap-4 p-3 rounded-lg border border-border/50 bg-surface/30 hover:border-signal/40 transition-colors"
          >
            <div className="flex items-center justify-center w-8 h-8 rounded-full border border-signal/40 bg-signal/10 shrink-0">
              <Send className="w-4 h-4 text-signal" />
            </div>
            <div className="flex-1 min-w-0">
              <span className="text-[10px] font-mono uppercase tracking-widest text-signal">
                Watch This Agent
              </span>
              <p className="text-xs text-foreground-muted leading-relaxed">
                Get Telegram alerts when the agent enters, exits, or holds through drawdown.
              </p>
            </div>
            <div className="hidden sm:flex items-center gap-3 text-xs font-mono shrink-0">
              <span className="text-foreground group-hover:text-signal transition-colors">
                @{status.telegram.botUsername}
              </span>
              {status.telegram.subscriberCount > 0 && (
                <span className="text-foreground-muted">
                  {status.telegram.subscriberCount} watching
                </span>
              )}
              <ExternalLink className="w-3.5 h-3.5 text-foreground-muted group-hover:text-signal transition-colors" />
            </div>
          </a>
        </motion.div>
      )}

      {/* Row 1: Agent Status + Portfolio + Guardrails + Performance */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05, duration: 0.4 }}
        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4"
      >
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05, duration: 0.35 }}
        >
          <Card className="bg-surface/30 border-border/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-mono uppercase tracking-wider text-foreground-muted flex items-center gap-2">
                <Activity className="w-3.5 h-3.5 text-signal" />
                Agent Status
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-3">
                <StatusDot ok={status.status === "idle"} />
                <span className="text-lg font-semibold capitalize">{status.status}</span>
                {status.status === "running" && (
                  <span className="text-xs font-mono text-signal animate-pulse">
                    RUNNING...
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                <div>
                  <span className="text-foreground-muted">Version</span>
                  <p className="text-foreground">{status.version}</p>
                </div>
                <div>
                  <span className="text-foreground-muted">Cycle</span>
                  <p className="text-foreground">#{status.cycle}</p>
                </div>
                <div>
                  <span className="text-foreground-muted">Last Run</span>
                  <p className="text-foreground">{formatTime(status.lastRunAt)}</p>
                </div>
                <div>
                  <span className="text-foreground-muted">Next Run</span>
                  <p className="text-foreground">{formatTime(status.nextRunAt)}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.08, duration: 0.35 }}
        >
          <Card className="bg-surface/30 border-border/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-mono uppercase tracking-wider text-foreground-muted flex items-center gap-2">
                <DollarSign className="w-3.5 h-3.5 text-patience" />
                Portfolio
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="text-2xl sm:text-3xl font-bold tabular-nums text-foreground">
                {formatCurrency(status.portfolio.totalValueUsd)}
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                <div>
                  <span className="text-foreground-muted">Positions</span>
                  <p className="text-foreground">{status.portfolio.positions}</p>
                </div>
                <div>
                  <span className="text-foreground-muted">Chains</span>
                  <p className="text-foreground">{status.portfolio.chains.join(", ")}</p>
                </div>
                <div>
                  <span className="text-foreground-muted">Volume (total)</span>
                  <p className="text-patience">{formatCurrency(status.totalVolumeUsd)}</p>
                </div>
                <div>
                  <span className="text-foreground-muted">Errors</span>
                  <p className={cn(status.errors > 0 ? "text-impatience" : "text-patience")}>
                    {status.errors}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.11, duration: 0.35 }}
        >
          <Card className="bg-surface/30 border-border/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-mono uppercase tracking-wider text-foreground-muted flex items-center gap-2">
                <Shield className="w-3.5 h-3.5 text-impatience" />
                Guardrails
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-3">
                <StatusDot ok={status.guardrails.allOk} />
                <span className={cn(
                  "text-lg font-semibold",
                  status.guardrails.allOk ? "text-patience" : "text-impatience",
                )}>
                  {status.guardrails.allOk ? "All Systems Nominal" : "Limit Breached"}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                <div>
                  <span className="text-foreground-muted">Drawdown</span>
                  <p className={cn(
                    status.guardrails.drawdownExceeded ? "text-impatience" : "text-patience"
                  )}>
                    {status.guardrails.drawdownPercent.toFixed(1)}%
                  </p>
                </div>
                <div>
                  <span className="text-foreground-muted">Peak Value</span>
                  <p className="text-foreground">{formatCurrency(status.guardrails.peakValueUsd)}</p>
                </div>
                <div>
                  <span className="text-foreground-muted">Today's Trades</span>
                  <p className={cn(
                    status.guardrails.tradesToday >= status.guardrails.dailyLimit
                      ? "text-impatience"
                      : "text-patience"
                  )}>
                    {status.guardrails.tradesToday}/{status.guardrails.dailyLimit}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.14, duration: 0.35 }}
        >
          <Card className="bg-surface/30 border-border/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-mono uppercase tracking-wider text-foreground-muted flex items-center gap-2">
                <TrendingUp className="w-3.5 h-3.5 text-patience" />
                Performance
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className={cn(
                "text-2xl sm:text-3xl font-bold tabular-nums",
                (status.metrics?.netPnlUsd ?? 0) >= 0 ? "text-patience" : "text-impatience"
              )}>
                {formatCurrency(status.metrics?.netPnlUsd ?? 0)}
                <span className="text-xs font-normal text-foreground-muted ml-2">net PnL</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                <div>
                  <span className="text-foreground-muted">Win Rate</span>
                  <p className={cn(
                    (status.metrics?.winRate ?? 0) >= 0.5 ? "text-patience" : "text-foreground"
                  )}>
                    {((status.metrics?.winRate ?? 0) * 100).toFixed(0)}%
                  </p>
                </div>
                <div>
                  <span className="text-foreground-muted">Entries / Exits</span>
                  <p className="text-foreground">
                    {(status.metrics?.totalEntries ?? 0)} / {(status.metrics?.totalExits ?? 0)}
                  </p>
                </div>
                <div>
                  <span className="text-foreground-muted">Profit Factor</span>
                  <p className={cn(
                    (status.metrics?.profitFactor ?? 0) >= 1 ? "text-patience" : "text-foreground"
                  )}>
                    {(status.metrics?.profitFactor ?? 0).toFixed(2)}
                  </p>
                </div>
                <div>
                  <span className="text-foreground-muted">Gas Spent</span>
                  <p className="text-foreground">{formatCurrency(status.metrics?.totalGasSpentUsd ?? 0)}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.16, duration: 0.35 }}
        >
          <Card className="bg-surface/30 border-border/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-mono uppercase tracking-wider text-foreground-muted flex items-center gap-2">
                <Shield className="w-3.5 h-3.5 text-signal" />
                Agent Conviction Index
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {status.behavioralMetrics ? (
                <>
                  <div className={cn(
                    "text-2xl sm:text-3xl font-bold tabular-nums",
                    (status.behavioralMetrics.score ?? 0) >= 60 ? "text-patience" : "text-impatience"
                  )}>
                    {status.behavioralMetrics.score}
                    <span className="text-xs font-normal text-foreground-muted ml-2">/ 100</span>
                  </div>
                  <div className="text-sm font-medium text-foreground">
                    {status.behavioralMetrics.archetype}
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                    <div>
                      <span className="text-foreground-muted">Win Rate</span>
                      <p className="text-foreground">{status.behavioralMetrics.winRate}%</p>
                    </div>
                    <div>
                      <span className="text-foreground-muted">Avg Hold</span>
                      <p className="text-foreground">{status.behavioralMetrics.avgHoldingPeriod}d</p>
                    </div>
                    <div>
                      <span className="text-foreground-muted">Positions</span>
                      <p className="text-foreground">{status.behavioralMetrics.totalPositions}</p>
                    </div>
                    <div>
                      <span className="text-foreground-muted">Early Exits</span>
                      <p className={cn(
                        status.behavioralMetrics.earlyExits === 0 ? "text-patience" : "text-impatience"
                      )}>
                        {status.behavioralMetrics.earlyExits}
                      </p>
                    </div>
                  </div>
                </>
              ) : (
                <div className="text-sm text-foreground-muted">
                  Insufficient closed positions yet. The agent will score its
                  own behavior once it has a few exits.
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>
      </motion.div>

      {/* Row 2: Conviction Signals (the thesis, visible) + Held Positions (the proof)
          Act 2 of the narrative: the agent scores conviction and holds through drawdown. */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.14, duration: 0.4 }}
        className="grid grid-cols-1 lg:grid-cols-2 gap-4"
      >
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.22, duration: 0.35 }}
        >
          <Card className="bg-surface/30 border-border/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-mono uppercase tracking-wider text-foreground-muted flex items-center gap-2">
                <Signal className="w-3.5 h-3.5 text-signal" />
                Conviction Signals
              {conviction?.regime && (
                <span className="ml-auto flex items-center gap-1.5 text-[10px]">
                  <span className="font-mono text-foreground-dim">Regime</span>
                  <span className={cn(
                    "font-semibold tabular-nums px-1.5 py-0.5 rounded-full",
                    conviction.regime.score >= 60
                      ? "bg-patience/10 text-patience border border-patience/20"
                      : conviction.regime.score <= 30
                      ? "bg-impatience/10 text-impatience border border-impatience/20"
                      : "bg-amber-500/10 text-amber-400 border border-amber-500/20",
                  )}>
                    {conviction.regime.score}/100
                  </span>
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {conviction?.regime && (
              <div className="p-3 rounded-lg bg-surface/40 border border-border/40">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <p className="text-xs font-mono text-foreground-muted uppercase tracking-wider">
                      {conviction.regime.label}
                    </p>
                    <p className="text-[10px] font-mono text-foreground-dim mt-0.5">
                      FGI {conviction.regime.fearGreedIndex ?? "—"} · {conviction.regime.fearLevel}
                      {conviction.regime.ssiConfirmation != null && (
                        <>
                          {" · "}
                          <span
                            className={cn(
                              conviction.regime.ssiConfirmation > 0.2
                                ? "text-patience"
                                : conviction.regime.ssiConfirmation < -0.2
                                  ? "text-impatience"
                                  : "text-foreground-dim",
                            )}
                            title="SoSoValue SSI index 7d move — confirms or contradicts the contrarian fear regime"
                          >
                            SSI{" "}
                            {conviction.regime.ssiConfirmation > 0
                              ? "confirms"
                              : conviction.regime.ssiConfirmation < 0
                                ? "contradicts"
                                : "neutral"}{" "}
                            ({conviction.regime.ssiConfirmation > 0 ? "+" : ""}
                            {conviction.regime.ssiConfirmation.toFixed(2)})
                          </span>
                        </>
                      )}
                    </p>
                    {conviction.signals[0]?.weights && (
                      <p
                        className="text-[10px] font-mono text-foreground-dim/70 mt-1"
                        title="Active signal weights shifted by current regime"
                      >
                        weights{" "}
                        <span className="text-signal">C{conviction.signals[0].weights.contrarian}</span>
                        {" · "}
                        <span className="text-cyan-400">R{conviction.signals[0].weights.rsi}</span>
                        {" · "}
                        <span className="text-patience">Q{conviction.signals[0].weights.quality}</span>
                        {" · "}
                        <span className="text-cyan-400">M{conviction.signals[0].weights.regime}</span>
                        {" · "}
                        <span className="text-amber-400">H{conviction.signals[0].weights.holders}</span>
                        {" · "}
                        <span className="text-impatience">V{conviction.signals[0].weights.volatilityPenaltyMax}</span>
                        {" · "}
                        <span className="text-emerald-400">N{conviction.signals[0].weights.newsMax}</span>
                      </p>
                    )}
                  </div>
                  <div className="text-3xl font-bold tabular-nums text-signal">
                    {conviction.regime.score}
                  </div>
                </div>
                <div className="mt-2 h-1.5 rounded-full bg-surface/60 overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${conviction.regime.score}%` }}
                    transition={{ duration: 0.8, ease: "easeOut" }}
                    className={cn(
                      "h-full rounded-full",
                      conviction.regime.score >= 60 ? "bg-patience" :
                      conviction.regime.score <= 30 ? "bg-impatience" : "bg-amber-400",
                    )}
                  />
                </div>
              </div>
            )}

            {conviction?.macroPause && !conviction.macroPause.clear && (
              <div
                className={cn(
                  "p-2.5 rounded-lg border text-[10px] font-mono",
                  conviction.macroPause.skipEntries
                    ? "bg-impatience/10 border-impatience/30 text-impatience"
                    : conviction.macroPause.sizeMultiplier < 1
                      ? "bg-amber-500/10 border-amber-500/30 text-amber-400"
                      : "bg-surface/40 border-border/40 text-foreground-muted",
                )}
                title={
                  conviction.macroPause.triggeringEvent
                    ? `${conviction.macroPause.triggeringEvent.name} · ${conviction.macroPause.triggeringEvent.date} · ${conviction.macroPause.triggeringEvent.impact} impact`
                    : undefined
                }
              >
                <span className="uppercase tracking-wider">
                  {conviction.macroPause.skipEntries
                    ? "⏸ Entries paused"
                    : conviction.macroPause.sizeMultiplier < 1
                      ? "⚠ Sizing halved"
                      : "👀 Macro watch"}
                </span>{" "}
                <span className="text-foreground-dim">— {conviction.macroPause.reason}</span>
              </div>
            )}

            {conviction && conviction.signals.length > 0 ? (
              <div className="space-y-1.5">
                {conviction.signals.slice(0, 6).map((s, i) => (
                  <motion.div
                    key={s.symbol}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.05 }}
                    className="flex items-center justify-between p-2.5 rounded-lg bg-surface/40 border border-border/40 hover:border-signal/20 transition-colors"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold">{s.symbol}</span>
                        <span className="text-[10px] font-mono text-foreground-dim">
                          {s.rationale}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-1 text-[10px] font-mono text-foreground-muted">
                        <span>contrarian <span className="text-signal">{s.breakdown.contrarian}</span></span>
                        <span>· rsi <span className="text-cyan-400">{s.breakdown.rsi}</span></span>
                        <span>· quality <span className="text-patience">{s.breakdown.quality}</span></span>
                        <span>· regime <span className="text-cyan-400">{s.breakdown.regime}</span></span>
                        {s.holderCount != null && (
                          <span>· holders <span className="text-amber-400">{s.breakdown.holders}</span></span>
                        )}
                        {s.breakdown.volatilityPenalty > 0 && (
                          <span>· vol <span className="text-impatience">−{s.breakdown.volatilityPenalty}</span></span>
                        )}
                        {s.breakdown.news !== 0 && (
                          <span title="SoSoValue news sentiment adjustment">
                            · news{" "}
                            <span className={s.breakdown.news > 0 ? "text-emerald-400" : "text-impatience"}>
                              {s.breakdown.news > 0 ? "+" : ""}
                              {s.breakdown.news}
                            </span>
                          </span>
                        )}
                      </div>
                      {s.holderCount != null && (
                        <div className="flex items-center gap-2 mt-0.5 text-[10px] font-mono text-foreground-dim">
                          <span>{s.holderCount.toLocaleString()} holders</span>
                          {s.holderGrowthPercent != null && (
                            <span className={s.holderGrowthPercent >= 0 ? "text-emerald-500" : "text-impatience"}>
                              {s.holderGrowthPercent >= 0 ? "+" : ""}{s.holderGrowthPercent.toFixed(1)}% growth
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <div className="w-12 h-1 rounded-full bg-surface/60 overflow-hidden">
                        <div
                          className="h-full bg-signal rounded-full"
                          style={{ width: `${s.score}%` }}
                        />
                      </div>
                      <span className="text-sm font-bold tabular-nums w-7 text-right">
                        {s.score}
                      </span>
                    </div>
                  </motion.div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-8 text-foreground-muted">
                <Signal className="w-8 h-8 mb-2 opacity-40" />
                <p className="text-xs font-mono">No signals scored above threshold</p>
              </div>
            )}
          </CardContent>
        </Card>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.26, duration: 0.35 }}
        >
          <Card className="bg-surface/30 border-border/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-mono uppercase tracking-wider text-foreground-muted flex items-center gap-2">
                <Shield className="w-3.5 h-3.5 text-patience" />
                Conviction Ledger
                <span className="ml-1.5 text-[9px] font-mono normal-case tracking-normal text-foreground-dim hidden sm:inline">
                  positions ← signals
                </span>
              {conviction && (
                <span className="ml-auto text-foreground-dim text-[10px] font-mono">
                  {conviction.heldPositions.length} held ·{" "}
                  {conviction.positionVerdicts.filter((v) => v.heldThroughDrawdown).length} weathered drawdown
                  {conviction.heldPositions.filter((p) => p.stuck).length > 0 && (
                    <>
                      {" · "}
                      <span className="text-impatience">
                        {conviction.heldPositions.filter((p) => p.stuck).length} stuck
                      </span>
                    </>
                  )}
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {conviction && conviction.heldPositions.length > 0 ? (
              <div className="space-y-1.5">
                {/* ── "Early, Not Wrong" — conviction proven callout ──
                    Positions held through significant drawdown that are now
                    profitable. This is the product thesis made visible. */}
                {conviction.heldPositions
                  .map((p) => {
                    const verdict = conviction.positionVerdicts.find(
                      (v) => v.symbol === p.symbol
                    );
                    const signal = conviction.signals.find(
                      (s) => s.symbol === p.symbol
                    );
                    const isProven =
                      verdict?.heldThroughDrawdown &&
                      p.maxUnderwaterPercent <= -10 &&
                      (verdict?.unrealizedPnLPercent ?? 0) > 0 &&
                      !p.stuck;
                    return { position: p, verdict, signal, isProven };
                  })
                  .filter((x) => x.isProven)
                  .slice(0, 1)
                  .map(({ position: p, verdict, signal }) => (
                    <motion.div
                      key={`proven-${p.symbol}`}
                      initial={{ opacity: 0, scale: 0.97 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ duration: 0.4 }}
                      className="rounded-xl border-2 border-patience/40 bg-patience/8 p-3.5 space-y-2.5 shadow-[0_0_20px_-8px_var(--patience-dim)]"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-patience">
                          ◆ Early, Not Wrong
                        </span>
                        <span className="text-[9px] font-mono text-foreground-dim">
                          conviction proven
                        </span>
                      </div>
                      {/* The full arc: scored → entered → dipped → held → now */}
                      <div className="flex items-center gap-1.5 flex-wrap text-[11px] font-mono">
                        <span className="text-foreground font-semibold">{p.symbol}</span>
                        {signal && (
                          <>
                            <span className="text-foreground-dim">·</span>
                            <span className="text-signal" title={signal.rationale}>
                              scored {signal.score}
                          </span>
                          </>
                        )}
                        <span className="text-foreground-dim">→</span>
                        <span className="text-foreground-muted">
                          entered cycle {p.entryCycle}
                        </span>
                        <span className="text-foreground-dim">→</span>
                        <span className="text-impatience">
                          dipped −{p.maxUnderwaterPercent.toFixed(1)}%
                        </span>
                        <span className="text-foreground-dim">→</span>
                        <span className="text-patience font-semibold">
                          held {p.cyclesHeld} cycles
                        </span>
                        <span className="text-foreground-dim">→</span>
                        <span className="text-patience font-bold text-sm">
                          now +{verdict!.unrealizedPnLPercent.toFixed(1)}%
                        </span>
                      </div>
                      {verdict?.reason && (
                        <p className="text-[10px] font-mono text-foreground-muted leading-relaxed">
                          {verdict.reason}
                        </p>
                      )}
                    </motion.div>
                  ))}

                {conviction.heldPositions.map((p, i) => {
                  const verdict = conviction.positionVerdicts.find(
                    (v) => v.symbol === p.symbol
                  );
                  const currentPnl = verdict?.unrealizedPnLPercent ?? 0;
                  // Match this position to the signal that motivated entry
                  const entrySignal = conviction.signals.find(
                    (s) => s.symbol === p.symbol
                  );
                  return (
                    <motion.div
                      key={p.symbol}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.05 }}
                      className="p-2.5 rounded-lg bg-surface/40 border border-border/40 hover:border-patience/20 transition-colors"
                    >
                      <div className="flex items-center justify-between">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold">{p.symbol}</span>
                            {verdict && (
                              <span className={cn(
                                "text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded-full border",
                                verdict.action === "HOLD"
                                  ? "border-patience/30 bg-patience/10 text-patience"
                                  : verdict.action === "EXIT_TRAIL"
                                  ? "border-cyan-500/30 bg-cyan-500/10 text-cyan-400"
                                  : "border-impatience/30 bg-impatience/10 text-impatience",
                              )}>
                                {verdict.action === "HOLD" ? "Holding" : verdict.action === "EXIT_TRAIL" ? "Trailing" : "Stopped"}
                              </span>
                            )}
                            {verdict?.heldThroughDrawdown && (
                              <span className="text-[10px] font-mono text-signal">
                                ◆ early, not wrong
                              </span>
                            )}
                            {p.stuck && (
                              <span
                                className="text-[10px] font-mono px-1.5 py-0.5 rounded-full border border-impatience/30 bg-impatience/10 text-impatience"
                                title={`Unexitable — ${p.failedExitAttempts ?? 0} failed exit attempts`}
                              >
                                STUCK
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 mt-1 text-[10px] font-mono text-foreground-muted flex-wrap">
                            <span>${p.amountUsd.toFixed(0)} entry</span>
                            <span>·</span>
                            <span>{p.cyclesHeld} cycles held</span>
                            <span>·</span>
                            <span className="text-foreground-dim">
                              −{p.maxUnderwaterPercent.toFixed(1)}% worst dip
                            </span>
                            {entrySignal && (
                              <>
                                <span>·</span>
                                <span className="text-signal" title={entrySignal.rationale}>
                                  scored {entrySignal.score}
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                        <div className={cn(
                          "text-sm font-bold tabular-nums shrink-0",
                          currentPnl >= 0 ? "text-patience" : "text-impatience",
                        )}>
                          {currentPnl >= 0 ? "+" : ""}{currentPnl.toFixed(1)}%
                        </div>
                      </div>
                      {verdict && (
                        <p className="text-[10px] font-mono text-foreground-dim mt-1.5 leading-tight">
                          {verdict.reason}
                        </p>
                      )}
                    </motion.div>
                  );
                })}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-8 text-foreground-muted">
                <Shield className="w-8 h-8 mb-2 opacity-40" />
                <p className="text-xs font-mono text-center">No open positions</p>
                <p className="text-[10px] font-mono text-foreground-dim mt-1 text-center max-w-xs">
                  The agent opens contrarian entries during fear. The next qualifying signal will appear here.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
        </motion.div>
      </motion.div>

      {/* Row 3: On-Chain Anchor History (Act 3: it anchors on-chain).
          Shows recent conviction records the agent has anchored across
          Casper, Mantle, and Aleo — proof this is a live system. */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.22, duration: 0.4 }}
      >
        <RecentAnchors />
      </motion.div>

      {/* Row 3b: Casper Wallet detail card + Agent Reputation API (Act 4: anchor your own).
          The connect button lives in the navbar (where users expect it);
          this card shows balance, anchor form, and sign proof once connected. */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.26, duration: 0.4 }}
        className="grid grid-cols-1 lg:grid-cols-3 gap-4"
      >
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.28, duration: 0.35 }}
          className="lg:col-span-1"
        >
          <CasperWalletConnect />
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.30, duration: 0.35 }}
          className="lg:col-span-2"
        >
          <ReputationApiCard />
        </motion.div>
      </motion.div>

      {/* Row 4: Recent Activity + Market Data */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.30, duration: 0.4 }}
        className="grid grid-cols-1 lg:grid-cols-2 gap-4"
      >
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.30, duration: 0.35 }}
        >
          <Card className="bg-surface/30 border-border/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-mono uppercase tracking-wider text-foreground-muted flex items-center gap-2">
                <BarChart3 className="w-3.5 h-3.5 text-patience" />
                {/* Title tracks content — trades fire during cycles, holdings persist
                    between them; reading "Recent Trades" while seeing positions
                    read like a bug. The umbrella title fits both. */}
                {trades && trades.recentTrades.length > 0 ? "Recent Trades" : "Activity"}
                {trades && (
                  <span className="ml-auto text-foreground-dim text-[10px]">
                    {trades.totalSessionTrades} total · {formatCurrency(trades.totalVolumeUsd)} volume
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {trades && trades.recentTrades.length > 0 ? (
                <div className="space-y-2">
                  {trades.recentTrades.map((trade, i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.05 }}
                      className="flex items-center justify-between p-3 rounded-lg bg-surface/40 border border-border/40 hover:border-signal/20 transition-colors"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="flex items-center gap-1 text-sm font-semibold">
                          <span className="text-impatience">{trade.tokenIn}</span>
                          <ChevronRight className="w-3 h-3 text-foreground-muted shrink-0" />
                          <span className="text-patience">{trade.tokenOut}</span>
                        </div>
                        <span className="text-xs font-mono text-foreground-muted">
                          ${trade.amountIn}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {trade.success ? (
                          <span className="flex items-center gap-1 text-xs text-patience">
                            <CheckCircle2 className="w-3 h-3" />
                            Executed
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-xs text-impatience">
                            <XCircle className="w-3 h-3" />
                            Failed
                          </span>
                        )}
                        <span className="text-[10px] text-foreground-dim font-mono">
                          {formatTime(trade.timestamp)}
                        </span>
                      </div>
                    </motion.div>
                  ))}
                </div>
              ) : (
                // Empty state — trades are cycle-scoped, so between cycles this
                // is usually empty even though positions are actively managed.
                // Show what the agent is HOLDING (its current state) instead of
                // a blank "no trades" message — same data the loop uses to
                // decide whether to harvest, exit, or hold next cycle.
                <div className="space-y-2">
                  <p className="text-[10px] font-mono text-foreground-muted uppercase tracking-wider px-1">
                    Holding (between cycles)
                  </p>
                  {conviction && conviction.heldPositions.length > 0 ? (
                    conviction.heldPositions
                      .slice()
                      .sort((a, b) => b.amountUsd - a.amountUsd)
                      .slice(0, 5)
                      .map((p, i) => (
                        <motion.div
                          key={p.symbol}
                          initial={{ opacity: 0, x: -10 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: i * 0.05 }}
                          className="flex items-center justify-between p-3 rounded-lg bg-surface/40 border border-border/40"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <span className="text-sm font-semibold text-patience">{p.symbol}</span>
                            <span className="text-xs font-mono text-foreground-muted">
                              ${p.amountUsd.toFixed(2)}
                            </span>
                          </div>
                          <span className="text-[10px] text-foreground-dim font-mono">
                            {p.cyclesHeld} cycle{p.cyclesHeld === 1 ? "" : "s"} held
                          </span>
                        </motion.div>
                      ))
                  ) : (
                    <div className="flex flex-col items-center justify-center py-6 text-foreground-muted">
                      <BarChart3 className="w-8 h-8 mb-2 opacity-40" />
                      <p className="text-xs font-mono">No active positions</p>
                    </div>
                  )}
                  <p className="text-[10px] font-mono text-foreground-dim text-center pt-1">
                    Next cycle in ~4h · trades fire when conviction + bankroll align
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.34, duration: 0.35 }}
        >
          <Card className="bg-surface/30 border-border/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-mono uppercase tracking-wider text-foreground-muted flex items-center gap-2">
                <Globe className="w-3.5 h-3.5 text-signal" />
                Market Data
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {conviction?.marketData ? (
                <>
                  <div className="flex items-center gap-4 flex-wrap">
                    <div className="flex items-center gap-2">
                      <span className="text-2xl font-bold tabular-nums">{conviction.marketData.fearGreedIndex}</span>
                      <span className={cn(
                        "text-xs font-mono px-2 py-0.5 rounded-full",
                        conviction.marketData.fearGreedIndex <= 25
                          ? "bg-impatience/10 text-impatience border border-impatience/20"
                          : conviction.marketData.fearGreedIndex >= 75
                          ? "bg-patience/10 text-patience border border-patience/20"
                          : "bg-amber-500/10 text-amber-400 border border-amber-500/20",
                      )}>
                        {conviction.marketData.fearGreedLabel}
                      </span>
                    </div>
                    <span className="text-xs text-foreground-muted font-mono">
                      Fear & Greed Index
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                    <div>
                      <span className="text-foreground-muted">Market Cap</span>
                      <p className="text-foreground">{formatCompact(conviction.marketData.totalMarketCapUsd)}</p>
                    </div>
                    <div>
                      <span className="text-foreground-muted">Tokens Tracked</span>
                      <p className="text-foreground">{conviction.marketData.tokensTracked}</p>
                    </div>
                    <div>
                      <span className="text-foreground-muted">BTC Funding</span>
                      <p className="text-foreground">{(conviction.marketData.btcFundingRate * 100).toFixed(4)}%</p>
                    </div>
                    <div>
                      <span className="text-foreground-muted">ETH Funding</span>
                      <p className="text-foreground">{(conviction.marketData.ethFundingRate * 100).toFixed(4)}%</p>
                    </div>
                  </div>
                </>
              ) : conviction ? (
                <div className="py-2 space-y-3">
                  <div className="flex items-center gap-3">
                    <Skeleton className="h-8 w-16" />
                    <Skeleton className="h-5 w-20 rounded-full" />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Skeleton className="h-6 w-24" />
                    <Skeleton className="h-6 w-20" />
                    <Skeleton className="h-6 w-16" />
                    <Skeleton className="h-6 w-24" />
                  </div>
                </div>
              ) : null}
              {conviction && ((conviction.anchorResults?.length ?? 0) > 0 ||
                (conviction.anchoredHash && conviction.anchoredHash !== "0x0000000000000000000000000000000000000000000000000000000000000000")) && (
                <div className={cn(
                  "pt-2 space-y-1.5",
                  conviction.marketData ? "border-t border-border/50" : "",
                )}>
                  <div className="flex items-center gap-2 text-[10px] font-mono text-foreground-muted uppercase tracking-wider">
                    <FileText className="w-3 h-3" />
                    <span>Conviction anchored</span>
                  </div>
                  {/* Multi-chain: render one row per adapter that ran this cycle. */}
                  {conviction.anchorResults && conviction.anchorResults.length > 0 ? (
                    // Casper-first: this is the marketplace host; Mantle is the
                    // EVM mirror. Symbolic but consistent with the story order.
                    [...conviction.anchorResults]
                      .sort((a, b) => (a.adapter === "casper" ? -1 : b.adapter === "casper" ? 1 : 0))
                      .map((r) => (
                      <div key={r.adapter} className="flex items-center gap-2 text-[10px] font-mono pl-5">
                        <span className="w-4 text-center">
                          {r.status === "success" ? "✓" : r.status === "skipped" ? "○" : "✗"}
                        </span>
                        <span className="capitalize text-foreground-muted w-14">{r.adapter}</span>
                        {r.status === "success" && r.txHash ? (
                          <a
                            href={r.explorerUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-signal hover:underline truncate"
                          >
                            {r.txHash.slice(0, 14)}…
                            <ExternalLink className="w-2.5 h-2.5 inline ml-0.5" />
                          </a>
                        ) : (
                          <span className="text-foreground-muted truncate">{r.error ?? r.status}</span>
                        )}
                      </div>
                    )) // end .map
                  ) : (
                    // Fallback: legacy single-anchor field (older agent versions).
                    <div className="flex items-center gap-2 text-[10px] font-mono pl-5">
                      <span className="w-4 text-center">✓</span>
                      <span className="capitalize text-foreground-muted w-14">mantle</span>
                      <a
                        href={conviction.anchoredUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-signal hover:underline truncate"
                      >
                        {conviction.anchoredHash.slice(0, 14)}…
                        <ExternalLink className="w-2.5 h-2.5 inline ml-0.5" />
                      </a>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>
      </motion.div>

      {/* Row 4b: Market Narrative — SoSoValue feeds + conviction commentary */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.38, duration: 0.4 }}
      >
        <Card className="bg-surface/30 border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-xs font-mono uppercase tracking-wider text-foreground-muted flex items-center gap-2">
            <Sparkles className="w-3.5 h-3.5 text-signal" />
            Market Narrative
            {conviction?.narrative && conviction.narrative.newsCount > 0 && (
              <span className="ml-auto text-foreground-dim text-[10px] font-mono">
                {conviction.narrative.newsCount} news · {conviction.narrative.macroEventCount} macro events
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {conviction?.narrative ? (
            <>
              {conviction.narrative.headline && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-surface/40 border border-border/40 mb-3">
                  <FileText className="w-4 h-4 text-signal shrink-0 mt-0.5" />
                  <p className="text-xs font-mono text-foreground-muted leading-relaxed">
                    "{conviction.narrative.headline}"
                  </p>
                </div>
              )}
              <p className="text-sm text-foreground leading-relaxed">
                {conviction.narrative.summary}
              </p>
              <div className="flex items-center gap-3 mt-3 text-[10px] font-mono text-foreground-dim">
                <span>Source: SoSoValue feeds + conviction data</span>
                <span>·</span>
                <span>Generated {new Date(conviction.narrative.generatedAt).toLocaleTimeString()}</span>
              </div>
            </>
          ) : (
            <div className="py-4 space-y-3">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-5/6" />
              <div className="flex items-center gap-2 pt-1">
                <Skeleton className="h-2 w-24" />
                <Skeleton className="h-2 w-16" />
              </div>
              <p className="text-[10px] text-foreground-dim/50 font-mono pt-1">
                Narrative fetches alongside agent data — will populate after the next cycle.
              </p>
            </div>            )}
          </CardContent>
        </Card>
      </motion.div>

      {/* Row 5: Links */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.44, duration: 0.4 }}
      >
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.44, duration: 0.35 }}
        >
        {/* Resources — collapsed by default, shows count of links when closed */}
        <details className="group">
          <summary
            className={cn(
              "flex items-center gap-2 rounded-lg border border-border/50",
              "bg-surface/40 p-3",
              "text-xs font-mono uppercase tracking-wider",
              "text-foreground-muted hover:text-signal hover:border-signal/20 cursor-pointer",
              "select-none list-none transition-colors"
            )}
          >
            <ExternalLink className="w-3.5 h-3.5 text-signal shrink-0" />
            <span>Resources</span>
            <span className="text-[10px] text-foreground-dim font-normal normal-case">5 links</span>
            <span className="ml-auto text-[10px] text-foreground-dim font-normal normal-case group-open:hidden">
              Click to expand
            </span>
            <span className="ml-auto text-[10px] text-foreground-dim font-normal normal-case hidden group-open:inline">
              Collapse
            </span>
          </summary>
          <div className="mt-1 space-y-1">
            {[
              {
                label: "GitHub Repository",
                href: "https://github.com/thisyearnofear/earlynotwrong",
                desc: "Full source code — 101 unit tests passing",
              },
              {
                label: "BNB Hack Submission",
                href: "https://dorahacks.io/hackathon/bnbhack-twt-cmc/detail",
                desc: "Track 1 (live PnL) + Track 2 (Strategy Skill)",
              },
              {
                label: "Agent Wallet (BSC Mainnet)",
                href: "https://bscscan.com/address/0xA1Dd482E4D6C8cf6f5f7BF80FEc6Bd3F11F5888a",
                desc: "0xA1Dd482E...5888a · Registered for BNB Hack live PnL",
              },
              {
                label: "Casper Registry (Marketplace host)",
                href: "https://testnet.cspr.live/contract-package/973e3c8654e6ee030483969503f21d6fab543317ef60ea2ca041a8e905087afa",
                desc: "ConvictionRegistry (Odra) · MCP + x402 paid queries",
              },
              {
                label: "Mantle Registry (EVM mirror)",
                href: "https://explorer.sepolia.mantle.xyz/address/0x81226e8894D334c790D9a972855592E6C4eeB15C",
                desc: "ERC-8004 · Thesis anchored per cycle",
              },
            ].map((link, i) => (
              <a
                key={i}
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between p-3 rounded-lg bg-surface/40 border border-border/40 hover:border-signal/20 transition-colors group"
              >
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-foreground group-hover:text-signal transition-colors">
                    {link.label}
                  </p>
                  <p className="text-[10px] text-foreground-muted font-mono mt-0.5 truncate">{link.desc}</p>
                </div>
                <ExternalLink className="w-3.5 h-3.5 text-foreground-muted group-hover:text-signal shrink-0 ml-2" />
              </a>
            ))}
          </div>
        </details>
        </motion.div>
      </motion.div>

      {/* Row 6: Pipeline Architecture (collapsed by default) */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.52, duration: 0.4 }}
      >
      <details className="group">
        <summary
          className={cn(
            "flex items-center gap-2 text-xs font-mono uppercase tracking-wider",
            "text-foreground-muted hover:text-signal cursor-pointer",
            "select-none list-none transition-colors"
          )}
        >
          <Zap className="w-3.5 h-3.5 text-signal" />
          Pipeline Architecture
          <span className="ml-auto text-[10px] text-foreground-dim group-open:hidden">
            Click to expand
          </span>
          <span className="ml-auto text-[10px] text-foreground-dim hidden group-open:inline">
            Collapse
          </span>
        </summary>
        <div className="mt-3">
          <Card className="bg-surface/30 border-border/50">
            <CardContent className="pt-4">
              <PipelineGrid />
            </CardContent>
          </Card>
        </div>
      </details>
      </motion.div>
    </motion.div>
  );
}

// ─── Agent Reputation API panel ───
//
// Surfaces the live MCP + x402 stats: how many reputation queries the agent's
// Casper-hosted registry has served, how many were paid, and the per-tool
// pricing table. This is the buildathon's "hero" surface — the dual-anchor
// is downstream of these queries; this panel is where the Casper-native
// agent-economy story actually shows up in the UI.

interface ReputationStats {
  queriesServed: number;
  paidQueries: number;
  feesCollectedBaseUnits: string;
  pricing: Record<string, { paid: boolean; amountBaseUnits: string; description: string }>;
  byTool: Record<string, { calls: number; paidCalls: number; baseUnits: string }>;
}

/** Format Casper CEP-18 base units as CSPR. The Cep18x402 token uses 2
 *  decimals (matches the cspr.cloud testnet asset), so 20 base units = 0.20 CSPR. */
function formatCspr(baseUnits: string | undefined, decimals = 2): string {
  if (!baseUnits) return "—";
  // BigInt() instead of `0n` literals — root tsconfig target predates ES2020.
  const n = BigInt(baseUnits);
  if (n === BigInt(0)) return "0 CSPR";
  const divisor = BigInt(10) ** BigInt(decimals);
  const whole = n / divisor;
  const fraction = n % divisor;
  const fracStr = fraction.toString().padStart(decimals, "0").replace(/0+$/, "");
  return fracStr ? `${whole}.${fracStr} CSPR` : `${whole} CSPR`;
}

const MCP_CONFIG_SNIPPET = `{
  "mcpServers": {
    "early-not-wrong": {
      "url": "https://earlynotwrong.vercel.app/api/agent/proxy?endpoint=mcp"
    }
  }
}`;

function ReputationApiCard() {
  const [stats, setStats] = useState<ReputationStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let stale = false;
    async function load() {
      try {
        const res = await fetch("/api/agent/proxy?endpoint=reputation/stats");
        if (!res.ok) throw new Error(`stats returned ${res.status}`);
        const data = (await res.json()) as ReputationStats;
        if (!stale) setStats(data);
      } catch (e) {
        if (!stale) setError(e instanceof Error ? e.message : "failed to load");
      }
    }
    load();
    const id = setInterval(load, 30_000);
    return () => {
      stale = true;
      clearInterval(id);
    };
  }, []);

  return (
    <Card className="bg-surface/30 border-border/50">
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-mono uppercase tracking-wider text-foreground-muted flex items-center gap-2">
          <Network className="w-3.5 h-3.5 text-signal" />
          Agent-to-Agent Reputation
          <span className="ml-auto text-[10px] text-foreground-dim">
            MCP · x402 · CROO CAP
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {/* Hero strip — three numbers + a one-liner explaining the surface. */}
        <div className="grid grid-cols-3 gap-3 mb-4">
          <div className="rounded-lg bg-surface/40 border border-border/40 p-3">
            <p className="text-[10px] font-mono text-foreground-muted uppercase tracking-wider">Queries served</p>
            <p className="text-2xl font-semibold tabular-nums">
              {stats?.queriesServed ?? "—"}
            </p>
          </div>
          <div className="rounded-lg bg-surface/40 border border-border/40 p-3">
            <p className="text-[10px] font-mono text-foreground-muted uppercase tracking-wider">Paid</p>
            <p className="text-2xl font-semibold tabular-nums text-signal">
              {stats?.paidQueries ?? "—"}
            </p>
          </div>
          <div className="rounded-lg bg-surface/40 border border-border/40 p-3">
            <p className="text-[10px] font-mono text-foreground-muted uppercase tracking-wider">
              Fees collected{" "}
              <span className="text-foreground-dim normal-case">(testnet)</span>
            </p>
            <p className="text-2xl font-semibold tabular-nums text-patience">
              {formatCspr(stats?.feesCollectedBaseUnits)}
            </p>
          </div>
        </div>

        <p className="text-[11px] text-foreground-muted mb-3 leading-relaxed">
          Other AI agents query this agent&apos;s verifiable track record over{" "}
          <span className="font-mono text-foreground">Model Context Protocol</span>,
          paying per call through <span className="font-mono text-foreground">x402</span>{" "}
          micropayments on Casper. The agent also advertises reputation services on
          the <span className="font-mono text-foreground">CROO</span> network,
          settled in USDC on Base — agent-to-agent commerce, no human in the loop.
        </p>

        {/* Tools table */}
        <div className="rounded-lg border border-border/40 overflow-hidden">
          <table className="w-full text-[11px] font-mono">
            <thead className="bg-surface/40 text-foreground-muted text-[10px] uppercase tracking-wider">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Tool</th>
                <th className="text-left px-3 py-2 font-medium">Pricing</th>
                <th className="text-right px-3 py-2 font-medium">Calls</th>
              </tr>
            </thead>
            <tbody>
              {stats &&
                Object.entries(stats.pricing).map(([tool, p]) => {
                  const called = stats.byTool[tool];
                  return (
                    <tr key={tool} className="border-t border-border/30">
                      <td className="px-3 py-2 text-foreground">{tool}</td>
                      <td className="px-3 py-2 text-foreground-muted">
                        {p.paid ? (
                          <span className="text-signal">{p.description}</span>
                        ) : (
                          <span>{p.description}</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right text-foreground-muted tabular-nums">
                        {called?.calls ?? 0}
                        {called?.paidCalls ? (
                          <span className="text-signal"> ({called.paidCalls} paid)</span>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>

        {/* Claude Desktop integration — promoted inline (was a collapsed
            <details>) since this is the single highest-conversion element
            on the page: a passing developer can grab this and try it. */}
        <div className="mt-4 rounded-lg border border-signal/30 bg-signal/5 p-3">
          <div className="flex items-center justify-between gap-2 mb-2">
            <p className="text-[11px] font-mono text-foreground">
              <span className="text-signal">▸</span> Add this MCP server to your AI agent
            </p>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(MCP_CONFIG_SNIPPET).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                });
              }}
              className="text-[10px] font-mono px-2 py-1 rounded bg-surface/60 border border-border/50 hover:border-signal/40 text-foreground-muted hover:text-signal transition-colors"
            >
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
          <pre className="p-3 rounded bg-black/50 text-foreground-muted text-[10px] overflow-x-auto font-mono leading-relaxed">{MCP_CONFIG_SNIPPET}</pre>
          <p className="text-[10px] text-foreground-muted mt-2 font-mono leading-relaxed">
            Works with Claude Desktop, Cursor, Continue.dev — or any MCP-compatible client.
          </p>
        </div>

        {error && (
          <p className="mt-3 text-[10px] text-impatience font-mono">stats: {error}</p>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Main Page ───

export default function AgentDashboard() {
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [trades, setTrades] = useState<TradesResponse | null>(null);
  const [conviction, setConviction] = useState<ConvictionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);
  const [countdown, setCountdown] = useState(REFRESH_INTERVAL / 1000);
  const [retryCount, setRetryCount] = useState(0);

  const fetchAll = useCallback(async () => {
    try {
      const [statusRes, tradesRes, convictionRes] = await Promise.all([
        fetch("/api/agent/proxy?endpoint=status"),
        fetch("/api/agent/proxy?endpoint=trades"),
        fetch("/api/agent/proxy?endpoint=conviction"),
      ]);

      if (!statusRes.ok) {
        const body = await statusRes.json().catch(() => ({}));
        throw new Error(body.error || `/status returned ${statusRes.status}`);
      }
      if (!tradesRes.ok) throw new Error(`/trades returned ${tradesRes.status}`);
      if (!convictionRes.ok) throw new Error(`/conviction returned ${convictionRes.status}`);

      setStatus(await statusRes.json());
      setTrades(await tradesRes.json());
      setConviction(await convictionRes.json());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to connect to agent");
      setRetryCount((r) => r + 1);
    } finally {
      setLoading(false);
      setLastFetch(new Date());
      setCountdown(REFRESH_INTERVAL / 1000);
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // Auto-refresh countdown
  useEffect(() => {
    if (loading) return;
    const timer = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          fetchAll();
          return REFRESH_INTERVAL / 1000;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [loading, fetchAll]);

  const showDashboard = !loading && !error && status;

  return (
    <CasperWalletProvider>
    <div className="min-h-screen text-foreground selection:bg-signal/20 overflow-x-hidden relative">
      <TunnelBackground />
      <Navbar />
      <main className="pt-24 pb-12 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto min-h-[calc(100vh-6rem)] flex flex-col">
        {/* Header — persistent across all states */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8"
        >
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-signal mb-2">
                <Activity className="w-3 h-3" />
                Conviction-Native Trading Agent
              </div>
              <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">
                Early, Not Wrong
              </h1>
              <p className="mt-1 text-sm text-foreground-muted">
                Contrarian entries · held through drawdown · capped only when the thesis breaks
              </p>
            </div>
            <div className="flex items-center gap-3">
              {status && (
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-surface/50 border border-border/50 text-xs font-mono">
                  <span className="text-foreground-muted uppercase tracking-wider">Cycle</span>
                  <span className="font-semibold text-signal">#{status.cycle}</span>
                </div>
              )}
              {status && (
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-surface/50 border border-border/50 text-xs font-mono">
                  <span className="text-foreground-muted uppercase tracking-wider">Trades</span>
                  <span className="font-semibold text-patience">{status.totalTrades}</span>
                </div>
              )}
              {showDashboard && (
                <div className="flex items-center gap-2 text-[10px] font-mono text-foreground-dim">
                  <RefreshCw className="w-3 h-3" />
                  {countdown}s
                </div>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="rounded-full text-xs font-mono text-foreground-muted"
                onClick={fetchAll}
                disabled={loading}
              >
                <RefreshCw className={cn("w-3 h-3 mr-1.5", loading && "animate-spin")} />
                Refresh
              </Button>
            </div>
          </div>

          {lastFetch && showDashboard && (
            <p className="text-[10px] font-mono text-foreground-dim mt-2">
              Last updated: {lastFetch.toLocaleTimeString()} · Auto-refresh every {REFRESH_INTERVAL / 1000}s
            </p>
          )}
        </motion.div>

        {/* Content — switches between loading story, error, and dashboard */}
        <div className="flex-1 flex flex-col justify-center">
          <AnimatePresence mode="wait">
            {loading && (
              <motion.div
                key="loading"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <LoadingStory />
              </motion.div>
            )}

            {!loading && error && (
              <motion.div
                key="error"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
              >
                <ErrorState error={error} onRetry={fetchAll} />
              </motion.div>
            )}

            {showDashboard && (
              <motion.div
                key="dashboard"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
              >
                <Dashboard status={status} trades={trades} conviction={conviction} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>
    </div>
    </CasperWalletProvider>
  );
}
