"use client";

import { Suspense, useEffect, useState, useCallback, useMemo } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { Navbar } from "@/components/layout/navbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { TunnelBackground } from "@/components/ui/tunnel-background";
import { CasperWalletConnect } from "@/components/casper-wallet-connect";
import { ProofLadder } from "@/components/proof-ladder";
import { IntegrationHub } from "@/components/integration-hub";
import {
  crooStoreUrl,
  DOCS_MCP_INTEGRATION,
  SIGNALS_EXAMPLE_URL,
  SIGNALS_SCHEMA_URL,
  CROO_REQUESTER_PATH,
} from "@/lib/marketing-urls";
import { SignalsUnlockPanel } from "@/components/signals-unlock-panel";
import type { SignalsLiveTeaser } from "@/lib/signals-teaser-types";
import {
  GUIDANCE_LABELS,
  type BuyerRecommendedAction,
} from "@/lib/signals-teaser-types";
import { guidanceActionClass } from "@/components/hire-signals-cta";
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
  Copy,
  Search,
  ShoppingBag,
} from "lucide-react";
import {
  NORTH_STAR,
  NORTH_STAR_SHORT,
  DEMO_WALKTHROUGH_HREF,
} from "@/lib/product-copy";
import { resolveObservability, prevCycleDuration } from "@/lib/observability";
import { DisclosureSection } from "@/components/agent/disclosure-section";
import type { CycleObservability } from "@/components/agent/agent-observability-panel";
import { AgentCommandStrip } from "@/components/agent/agent-command-strip";
import { AgentLiveHooks } from "@/components/agent/agent-live-hooks";
import { AgentProofPanel } from "@/components/agent/agent-proof-panel";
import { AgentViewPanel } from "@/components/agent/agent-view-panel";
import { SignalFactorBreakdown, RegimeBar } from "@/components/agent/signal-factor-breakdown";
import { SignalScoringDetails } from "@/components/agent/signal-scoring-details";
import {
  hashToView,
  type AgentView,
  type AgentTabBadges,
} from "@/components/agent/agent-section-nav";
import { PositionRow } from "@/components/agent/position-row";
import { ProvenConvictionBanner } from "@/components/agent/proven-conviction-banner";
import { AgentHireSummary } from "@/components/agent/agent-hire-summary";

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
  cycleHistory?: Array<{
    cycle: number;
    startedAt: number;
    durationMs: number;
    tradesExecuted: number;
    tradesFailed: number;
    volumeUsd: number;
    portfolioValueUsd: number;
    drawdownPercent: number;
    topSignal: { symbol: string; score: number } | null;
    regimeScore: number | null;
    regimeLabel: string | null;
    anchorStatus: "success" | "skipped" | "failed" | null;
    juryProvider: string | null;
    juryTopAdjustment: number | null;
  }>;
  observability?: CycleObservability | null;
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
      /** LLM conviction jury adjustment (signed, ±15pp). */
      llmJury?: number;
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
    /** LLM jury reasoning trace. */
    juryReasoning?: string;
    /** LLM jury agreement level. */
    juryAgreement?: string;
    /** LLM jury identified key risk. */
    juryKeyRisk?: string;
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
  /** LLM conviction jury deliberation (7th factor). */
  llmDeliberation: {
    deliberatedAt: string;
    provider: string;
    model: string;
    tokensEvaluated: number;
    marketAssessment: string;
    verdicts: Array<{
      symbol: string;
      adjustment: number;
      adjustedScore: number;
      reasoning: string;
      agreement: string;
      keyRisk: string;
    }>;
  } | null;
  /** Casper ecosystem context fetched via MCP (CSPR.trade + blockchain MCP). */
  casperEcosystemContext: {
    dexMcpReachable: boolean;
    chainMcpReachable: boolean;
    csprPriceUsd: number | null;
    csprUsdcLiquidityUsd: number | null;
    topDexTokens: Array<{
      symbol: string;
      address: string;
      decimals: number;
      priceUsd?: number;
    }>;
    networkStatus: {
      eraId: number;
      activeValidators: number;
      totalStakeCspr: number;
      circulatingSupplyCspr: number;
      blockHeight: number;
    } | null;
    fetchedAt: string;
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

// ─── Loading State ───

function LoadingCompact() {
  return (
    <div className="flex flex-col items-center justify-center py-28 gap-4">
      <RefreshCw className="w-6 h-6 text-signal animate-spin" />
      <p className="text-sm font-mono text-foreground-muted">Connecting to agent…</p>
      <p className="text-[10px] font-mono text-foreground-dim">Live data · BSC mainnet</p>
    </div>
  );
}

// Story-driven hero — demo walkthrough only
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

// ─── Mobile act navigation (sticky below navbar) ───

const ACT_SECTIONS = [
  { id: "act-1", label: "Act 1 · Live" },
  { id: "act-2", label: "Act 2 · Score & Trade" },
  { id: "act-3", label: "Act 3 · Anchor" },
  { id: "act-4", label: "Act 4 · Verify" },
] as const;

function ActStickyNav() {
  return (
    <nav
      aria-label="Dashboard acts"
      className="lg:hidden sticky top-16 z-30 -mx-4 sm:-mx-6 lg:mx-0 px-4 sm:px-6 py-2 mb-4 border-b border-border/40 bg-background/90 backdrop-blur-md"
    >
      <div className="flex gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {ACT_SECTIONS.map((act) => (
          <a
            key={act.id}
            href={`#${act.id}`}
            className="shrink-0 px-3 py-1.5 rounded-full border border-border/50 bg-surface/40 text-[10px] font-mono uppercase tracking-wider text-foreground-muted hover:text-signal hover:border-signal/30 transition-colors"
          >
            {act.label}
          </a>
        ))}
      </div>
    </nav>
  );
}

function DemoActBanner({ act, title }: { act: number; title: string }) {
  return (
    <p className="text-[10px] font-mono uppercase tracking-widest text-signal/80 mb-2">
      Act {act} · {title}
    </p>
  );
}

function LlmJuryCard({ conviction }: { conviction: ConvictionData | null }) {
  return (
    <Card className="bg-surface/30 border-border/50 border-purple-500/20">
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-mono uppercase tracking-wider text-foreground-muted flex items-center gap-2">
          <span className="w-3.5 h-3.5 rounded-full bg-purple-400/80 flex items-center justify-center text-[8px]">
            AI
          </span>
          LLM Conviction Jury
          <span className="ml-1 text-[9px] font-mono normal-case tracking-normal text-purple-400/70">
            7th factor
          </span>
          {conviction?.llmDeliberation && (
            <span className="ml-auto text-[9px] font-mono text-foreground-dim normal-case tracking-normal">
              {conviction.llmDeliberation.provider === "template"
                ? "template mode"
                : `${conviction.llmDeliberation.provider} · ${conviction.llmDeliberation.model}`}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-1 space-y-2.5">
        {conviction?.llmDeliberation && conviction.llmDeliberation.verdicts.length > 0 ? (
          <>
            <div className="p-2.5 rounded-lg bg-purple-500/5 border border-purple-500/15">
              <span className="text-[9px] font-mono uppercase tracking-wider text-purple-400/70">
                Market Assessment
              </span>
              <p className="text-xs text-foreground/80 mt-1 leading-relaxed">
                {conviction.llmDeliberation.marketAssessment}
              </p>
            </div>
            {conviction.llmDeliberation.verdicts.slice(0, 5).map((v, i) => {
              const agreementColor =
                v.agreement === "strong-agree" ? "text-emerald-400" :
                v.agreement === "agree" ? "text-emerald-400/70" :
                v.agreement === "neutral" ? "text-foreground-dim" :
                v.agreement === "disagree" ? "text-amber-400" :
                "text-impatience";
              const adjColor = v.adjustment > 0 ? "text-purple-400" : v.adjustment < 0 ? "text-rose-400" : "text-foreground-dim";
              const baseScore = v.adjustedScore - v.adjustment;
              return (
                <motion.div
                  key={v.symbol}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.3 + i * 0.06 }}
                  className="p-2.5 rounded-lg bg-surface/40 border border-border/30 hover:border-purple-500/20 transition-colors"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-semibold">{v.symbol}</span>
                    <span className={`text-[10px] font-mono ${agreementColor}`}>
                      {v.agreement.replace("-", " ")}
                    </span>
                    <span className="ml-auto flex items-center gap-1 text-[10px] font-mono tabular-nums">
                      <span className="text-foreground-dim line-through">{baseScore}</span>
                      <span className={v.adjustment < 0 ? "text-rose-400" : v.adjustment > 0 ? "text-purple-400" : "text-foreground-dim"}>
                        {v.adjustment < 0 ? "→" : v.adjustment > 0 ? "→" : "="}
                      </span>
                      <span className={adjColor}>{v.adjustedScore}</span>
                      <span className={`px-1 py-0.5 rounded text-[9px] font-bold ${v.adjustment < 0 ? "bg-rose-500/15 text-rose-400" : v.adjustment > 0 ? "bg-purple-500/15 text-purple-400" : "bg-foreground-dim/10 text-foreground-dim"}`}>
                        {v.adjustment >= 0 ? "+" : ""}{v.adjustment}
                      </span>
                    </span>
                  </div>
                  <p className="text-[11px] text-foreground/70 leading-relaxed mb-1">
                    {v.reasoning}
                  </p>
                  <div className="flex items-start gap-1 text-[10px] font-mono text-foreground-dim">
                    <span className="text-amber-400/70 shrink-0">⚠ risk:</span>
                    <span>{v.keyRisk}</span>
                  </div>
                </motion.div>
              );
            })}
            <div className="text-[9px] font-mono text-foreground-dim pt-1">
              {conviction.llmDeliberation.tokensEvaluated} tokens evaluated ·
              deliberated {new Date(conviction.llmDeliberation.deliberatedAt).toLocaleTimeString()} ·
              reasoning digest anchored on-chain
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center py-8 text-foreground-muted">
            <span className="w-8 h-8 rounded-full bg-purple-400/20 flex items-center justify-center text-[10px] font-mono text-purple-400 mb-2">
              AI
            </span>
            <p className="text-xs font-mono">Jury in template mode</p>
            <p className="text-[10px] font-mono text-foreground-dim mt-1 text-center max-w-xs">
              No LLM API key configured — the jury runs with zero adjustments.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Dashboard ───

function sectionVisible(view: AgentView, target: AgentView, demoMode: boolean): boolean {
  return demoMode || view === target;
}

function Dashboard({
  status,
  trades,
  conviction,
  signalsTeaser,
  demoMode,
}: {
  status: AgentStatus;
  trades: TradesResponse | null;
  conviction: ConvictionData | null;
  signalsTeaser: SignalsLiveTeaser | null;
  demoMode: boolean;
}) {
  const [view, setView] = useState<AgentView>("live");

  useEffect(() => {
    if (demoMode || typeof window === "undefined") return;
    const sync = () => setView(hashToView(window.location.hash));
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, [demoMode]);

  const showLive = sectionVisible(view, "live", demoMode);
  const showProof = sectionVisible(view, "proof", demoMode);
  const showHire = sectionVisible(view, "hire", demoMode);

  const handleViewChange = useCallback((next: AgentView) => {
    setView(next);
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, []);

  const resolvedObs = useMemo(
    () =>
      resolveObservability(status.observability, demoMode, status.cycle),
    [status.observability, status.cycle, demoMode],
  );

  const prevDuration = useMemo(
    () =>
      resolvedObs
        ? prevCycleDuration(status.cycleHistory, resolvedObs.cycle)
        : null,
    [resolvedObs, status.cycleHistory],
  );

  const tabBadges = useMemo((): AgentTabBadges => {
    const top = conviction?.signals[0]?.symbol;
    const posCount = conviction?.heldPositions.length ?? 0;
    const anchored = conviction?.anchorResults?.some((r) => r.status === "success");
    const traced =
      resolvedObs?.traceId != null
        ? "traced"
        : status.status === "running"
          ? "live"
          : undefined;
    return {
      live: traced ?? top ?? (posCount > 0 ? `${posCount} pos` : undefined),
      proof: anchored ? "anchored" : undefined,
      hire: "v1.2",
    };
  }, [conviction, resolvedObs?.traceId, status.status]);

  useEffect(() => {
    if (demoMode || typeof window === "undefined") return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "1") handleViewChange("live");
      if (e.key === "2") handleViewChange("proof");
      if (e.key === "3") handleViewChange("hire");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [demoMode, handleViewChange]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4 }}
      className="space-y-4"
    >
      {demoMode && <ActStickyNav />}

      {/* Orientation — compact in simple view; full 4-act pipeline in demo */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0, duration: 0.4 }}
        className={cn(!demoMode && "space-y-4")}
      >
        {demoMode ? (
          <div className="border-l-2 border-signal/40 pl-4 py-1">
            <p className="text-sm text-foreground leading-relaxed">
              Demo walkthrough — four acts from live scoring to verifiable hire.
              Same agent, same API; this mode is for judges and integrators
              tracing the full narrative.
            </p>
            <p className="text-[10px] font-mono text-foreground-dim mt-1.5">
              {NORTH_STAR_SHORT} · cycle #{status.cycle} · BSC mainnet
            </p>
          </div>
        ) : null}

        {demoMode && (
          <>
            <p className="text-xs text-foreground-muted mt-2 leading-relaxed">
              Every cycle: data → score → manage → execute → anchor → narrate.
              Anchored to{" "}
              <span className="text-signal">Casper Testnet + Mantle Sepolia</span>.
              The{" "}
              <Link href="/analyzer" className="text-signal hover:underline">
                wallet analyzer
              </Link>{" "}
              uses the same <span className="font-mono">conviction-core</span>{" "}
              framework.
            </p>

            {status && (
              <div className="mt-3 space-y-1">
                <p className="text-[9px] font-mono text-foreground-dim uppercase tracking-wider">
                  Per-cycle pipeline · Acts 1–3 below · Act 4 is hire + personal anchor
                </p>
                <div className="flex items-center gap-1 flex-wrap text-[9px] font-mono">
                  <span className="text-foreground-dim uppercase tracking-wider mr-1">
                    Cycle {status.cycle}:
                  </span>
                  {[
                    { act: 1, title: "Score", steps: ["data", "score"] as const },
                    { act: 2, title: "Trade", steps: ["manage", "execute"] as const },
                    { act: 3, title: "Anchor", steps: ["anchor"] as const },
                  ].map((group, gi) => (
                    <span key={group.act} className="flex items-center gap-0.5">
                      {gi > 0 && (
                        <span className="text-foreground-dim mx-1">·</span>
                      )}
                      <span
                        className="text-signal/80 uppercase tracking-wider"
                        title={`Act ${group.act}: ${group.title}`}
                      >
                        A{group.act}
                      </span>
                      {group.steps.map((step, si) => (
                        <span key={step} className="flex items-center gap-0.5">
                          {si > 0 && (
                            <span className="text-foreground-dim mx-0.5">→</span>
                          )}
                          <span className="text-patience">✓</span>
                          <span className="text-foreground-muted">{step}</span>
                        </span>
                      ))}
                    </span>
                  ))}
                  <span className="text-foreground-dim mx-1">·</span>
                  <span className="text-patience">✓</span>
                  <span className="text-foreground-muted">narrate</span>
                  <span className="text-foreground-dim ml-2">
                    · next in{" "}
                    {status.nextRunAt
                      ? Math.max(
                          0,
                          Math.round((status.nextRunAt - Date.now()) / 60_000),
                        )
                      : "—"}
                    m
                  </span>
                </div>
              </div>
            )}
          </>
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

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05, duration: 0.35 }}
      >
        <AgentCommandStrip
          status={status}
          conviction={conviction}
          observability={resolvedObs}
          prevDurationMs={prevDuration}
          isDemoObs={demoMode && !status.observability?.pipelineSteps?.length}
          active={view}
          onViewChange={handleViewChange}
          tabBadges={tabBadges}
          showNav={!demoMode}
          demoMode={demoMode}
        />
      </motion.div>

      {demoMode && (
        <motion.div
          id="act-1"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.06, duration: 0.35 }}
        >
          <DemoActBanner act={1} title="Live" />
        </motion.div>
      )}

      {/* Tab panels */}
      <AnimatePresence mode={demoMode ? "sync" : "wait"}>
      {showLive && (
      <AgentViewPanel viewKey="live" animate={!demoMode} id="act-2">
        {demoMode && <DemoActBanner act={2} title="Score & trade" />}
        <div id="signals" className="grid grid-cols-1 lg:grid-cols-2 gap-4 scroll-mt-28">
        {/* ── Left: Conviction Signals with 7-factor breakdown bar ── */}
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
                <span className="ml-1 text-[9px] font-mono normal-case tracking-normal text-purple-400/70">
                  7-factor
                </span>
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
              demoMode ? (
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
              ) : (
                <RegimeBar
                  score={conviction.regime.score}
                  label={conviction.regime.label}
                  compact
                />
              )
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
                {demoMode && conviction.signals[0] && (
                  <div className="p-3 rounded-lg bg-surface/50 border border-border/30 mb-2">
                    <SignalFactorBreakdown signal={conviction.signals[0]} />
                  </div>
                )}
                {conviction.signals.slice(0, 1).map((s, i) => (
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
                        <span className="text-[10px] font-mono text-foreground-dim truncate">
                          {s.rationale}
                        </span>
                      </div>
                      {demoMode && (
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
                        {s.breakdown.llmJury != null && s.breakdown.llmJury !== 0 && (
                          <span title="LLM conviction jury adjustment">
                            · jury{" "}
                            <span className={s.breakdown.llmJury > 0 ? "text-purple-400" : "text-rose-400"}>
                              {s.breakdown.llmJury > 0 ? "+" : ""}
                              {s.breakdown.llmJury}
                            </span>
                          </span>
                        )}
                      </div>
                      )}
                      {s.holderCount != null && demoMode && (
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
                {conviction.signals.length > 1 && (
                  <SignalsUnlockPanel
                    hiddenCount={conviction.signals.length - 1}
                    teaser={signalsTeaser}
                    className="mt-2"
                  />
                )}
                {!demoMode && conviction.signals[0] && (
                  <DisclosureSection
                    className="mt-2"
                    title="How this signal was scored"
                    subtitle="Regime context · active weights · 7-factor breakdown"
                    icon={<BarChart3 className="w-3.5 h-3.5 text-signal" />}
                  >
                    <SignalScoringDetails
                      regime={conviction.regime}
                      topSignal={conviction.signals[0]}
                      weights={conviction.signals[0].weights}
                    />
                  </DisclosureSection>
                )}
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

        {/* ── Right: AI Deliberation Panel — demo shows inline; simple view collapses ── */}
        {demoMode && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.22, duration: 0.35 }}
        >
          <LlmJuryCard conviction={conviction} />
        </motion.div>
        )}
        </div>

        {!demoMode && (
          <DisclosureSection
            className="mt-4"
            title="AI conviction jury"
            subtitle="7th factor · score adjustments ±15"
            icon={
              <span className="w-3.5 h-3.5 rounded-full bg-purple-400/80 flex items-center justify-center text-[8px] text-white">
                AI
              </span>
            }
            badge={
              conviction?.llmDeliberation?.verdicts.length ? (
                <span className="text-[10px] font-mono text-purple-400/80 normal-case">
                  {conviction.llmDeliberation.verdicts.length} verdicts
                </span>
              ) : undefined
            }
          >
            <LlmJuryCard conviction={conviction} />
          </DisclosureSection>
        )}

        {/* ── Casper MCP Consumer — demo inline; simple view collapses ── */}
        {conviction?.casperEcosystemContext && demoMode && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.18, duration: 0.35 }}
            className="mt-4"
          >
            <Card className="bg-surface/30 border-border/50 border-cyan-500/20">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-mono uppercase tracking-wider text-foreground-muted flex items-center gap-2">
                  <Globe className="w-3.5 h-3.5 text-cyan-400" />
                  Cross-Chain Context
                  <span className="ml-1 text-[9px] font-mono normal-case tracking-normal text-cyan-400/70">
                    consumed via MCP
                  </span>
                  <span className="ml-auto flex items-center gap-2 text-[9px] font-mono">
                    <span className={`flex items-center gap-1 ${conviction.casperEcosystemContext.dexMcpReachable ? "text-emerald-400" : "text-foreground-dim"}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${conviction.casperEcosystemContext.dexMcpReachable ? "bg-emerald-400 animate-pulse" : "bg-foreground-dim"}`} />
                      CSPR.trade MCP
                    </span>
                    <span className={`flex items-center gap-1 ${conviction.casperEcosystemContext.chainMcpReachable ? "text-emerald-400" : "text-foreground-dim"}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${conviction.casperEcosystemContext.chainMcpReachable ? "bg-emerald-400 animate-pulse" : "bg-foreground-dim"}`} />
                      Casper RPC
                    </span>
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-1">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {/* CSPR price */}
                  <div className="p-2.5 rounded-lg bg-surface/40 border border-border/30">
                    <span className="text-[9px] font-mono uppercase tracking-wider text-foreground-dim">
                      CSPR Price
                    </span>
                    <p className="text-sm font-bold tabular-nums text-foreground mt-0.5">
                      {conviction.casperEcosystemContext.csprPriceUsd !== null
                        ? `$${conviction.casperEcosystemContext.csprPriceUsd.toFixed(4)}`
                        : "—"}
                    </p>
                    {conviction.casperEcosystemContext.csprUsdcLiquidityUsd !== null && (
                      <p className="text-[9px] font-mono text-foreground-dim mt-0.5">
                        liq ${(conviction.casperEcosystemContext.csprUsdcLiquidityUsd / 1000).toFixed(1)}K
                      </p>
                    )}
                  </div>

                  {/* Network status */}
                  {conviction.casperEcosystemContext.networkStatus && (
                    <div className="p-2.5 rounded-lg bg-surface/40 border border-border/30">
                      <span className="text-[9px] font-mono uppercase tracking-wider text-foreground-dim">
                        Casper Network
                      </span>
                      <p className="text-sm font-bold tabular-nums text-foreground mt-0.5">
                        Era {conviction.casperEcosystemContext.networkStatus.eraId}
                      </p>
                      <p className="text-[9px] font-mono text-foreground-dim mt-0.5">
                        {conviction.casperEcosystemContext.networkStatus.activeValidators} validators ·{" "}
                        {conviction.casperEcosystemContext.networkStatus.totalStakeCspr.toLocaleString()} CSPR staked
                      </p>
                    </div>
                  )}

                  {/* Block height */}
                  {conviction.casperEcosystemContext.networkStatus && (
                    <div className="p-2.5 rounded-lg bg-surface/40 border border-border/30">
                      <span className="text-[9px] font-mono uppercase tracking-wider text-foreground-dim">
                        Block Height
                      </span>
                      <p className="text-sm font-bold tabular-nums text-foreground mt-0.5">
                        {conviction.casperEcosystemContext.networkStatus.blockHeight.toLocaleString()}
                      </p>
                      <p className="text-[9px] font-mono text-foreground-dim mt-0.5">
                        fetched {new Date(conviction.casperEcosystemContext.fetchedAt).toLocaleTimeString()}
                      </p>
                    </div>
                  )}

                  {/* DEX tokens */}
                  {conviction.casperEcosystemContext.topDexTokens.length > 0 && (
                    <div className="p-2.5 rounded-lg bg-surface/40 border border-border/30">
                      <span className="text-[9px] font-mono uppercase tracking-wider text-foreground-dim">
                        CSPR.trade DEX Tokens
                      </span>
                      <div className="flex items-center gap-1.5 flex-wrap mt-1">
                        {conviction.casperEcosystemContext.topDexTokens.slice(0, 6).map((t, i) => (
                          <span key={i} className="text-[10px] font-mono text-foreground">
                            {t.symbol}{t.priceUsd ? ` $${t.priceUsd.toFixed(4)}` : ""}{i < Math.min(conviction.casperEcosystemContext!.topDexTokens.length, 6) - 1 ? "," : ""}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Bidirectional MCP note */}
                <div className="mt-2 flex items-center gap-2 text-[9px] font-mono text-foreground-dim">
                  <Network className="w-3 h-3 text-cyan-400/60" />
                  <span>
                    Agent consumes Casper ecosystem MCP servers (CSPR.trade + blockchain RPC) for cross-chain context,
                    and exposes its own MCP server with 7 tools for other agents to query.
                  </span>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}

        {conviction?.casperEcosystemContext && !demoMode && (
          <DisclosureSection
            className="mt-4"
            title="Cross-chain context"
            subtitle="Casper MCP · CSPR.trade + network RPC"
            icon={<Globe className="w-3.5 h-3.5 text-cyan-400" />}
          >
            <Card className="bg-surface/30 border-border/50 border-cyan-500/20">
              <CardContent className="pt-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="p-2.5 rounded-lg bg-surface/40 border border-border/30">
                    <span className="text-[9px] font-mono uppercase tracking-wider text-foreground-dim">CSPR Price</span>
                    <p className="text-sm font-bold tabular-nums text-foreground mt-0.5">
                      {conviction.casperEcosystemContext.csprPriceUsd !== null
                        ? `$${conviction.casperEcosystemContext.csprPriceUsd.toFixed(4)}`
                        : "—"}
                    </p>
                  </div>
                  {conviction.casperEcosystemContext.networkStatus && (
                    <div className="p-2.5 rounded-lg bg-surface/40 border border-border/30">
                      <span className="text-[9px] font-mono uppercase tracking-wider text-foreground-dim">Casper Network</span>
                      <p className="text-sm font-bold tabular-nums text-foreground mt-0.5">
                        Era {conviction.casperEcosystemContext.networkStatus.eraId}
                      </p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </DisclosureSection>
        )}

        {/* ── Cycle Timeline — demo inline; simple view collapses ── */}
        {status?.cycleHistory && status.cycleHistory.length > 0 && demoMode && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.20, duration: 0.35 }}
            className="mt-4"
          >
            <Card className="bg-surface/30 border-border/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-mono uppercase tracking-wider text-foreground-muted flex items-center gap-2">
                  <Activity className="w-3.5 h-3.5 text-signal" />
                  Cycle Timeline
                  <span className="ml-auto text-[9px] font-mono text-foreground-dim normal-case tracking-normal">
                    last {status.cycleHistory.length} cycles
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-1">
                <div className="relative">
                  {/* Timeline line */}
                  <div className="absolute left-3 top-0 bottom-0 w-px bg-border/40" />

                  <div className="space-y-2">
                    {[...status.cycleHistory].reverse().map((c, i) => {
                      const isLatest = i === 0;
                      const hasTrades = c.tradesExecuted > 0 || c.tradesFailed > 0;
                      const anchorOk = c.anchorStatus === "success";
                      const anchorSkipped = c.anchorStatus === "skipped";
                      const juryActive = c.juryProvider && c.juryProvider !== "template";
                      return (
                        <div key={c.cycle} className="relative flex items-start gap-3 pl-1">
                          {/* Timeline dot */}
                          <div className={cn(
                            "relative z-10 w-2.5 h-2.5 rounded-full mt-1.5 shrink-0 border-2",
                            isLatest
                              ? "bg-signal border-signal animate-pulse"
                              : hasTrades
                                ? "bg-patience border-patience"
                                : "bg-surface border-border/60",
                          )} />

                          {/* Cycle content */}
                          <div className={cn(
                            "flex-1 min-w-0 rounded-lg px-2.5 py-1.5 border text-[10px] font-mono",
                            isLatest
                              ? "bg-surface/50 border-signal/20"
                              : "bg-surface/30 border-border/20",
                          )}>
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={cn("font-semibold", isLatest ? "text-signal" : "text-foreground")}>
                                #{c.cycle}
                              </span>
                              <span className="text-foreground-dim">
                                {new Date(c.startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                              </span>
                              <span className="text-foreground-dim">
                                · {(c.durationMs / 1000).toFixed(0)}s
                              </span>

                              {/* Trades indicator */}
                              {hasTrades ? (
                                <span className="flex items-center gap-1 text-patience">
                                  <Zap className="w-2.5 h-2.5" />
                                  {c.tradesExecuted} trade{c.tradesExecuted !== 1 ? "s" : ""}
                                  {c.tradesFailed > 0 && (
                                    <span className="text-impatience">({c.tradesFailed} failed)</span>
                                  )}
                                </span>
                              ) : (
                                <span className="text-foreground-dim">no trades</span>
                              )}

                              {/* Top signal */}
                              {c.topSignal && (
                                <span className="text-foreground-muted">
                                  · top: <span className="text-signal">{c.topSignal.symbol}</span> <span className="tabular-nums">{c.topSignal.score}</span>
                                </span>
                              )}

                              {/* Jury adjustment */}
                              {juryActive && c.juryTopAdjustment !== null && (
                                <span className={cn(
                                  "px-1 py-0.5 rounded text-[9px] font-bold",
                                  c.juryTopAdjustment < 0
                                    ? "bg-rose-500/15 text-rose-400"
                                    : c.juryTopAdjustment > 0
                                      ? "bg-purple-500/15 text-purple-400"
                                      : "bg-foreground-dim/10 text-foreground-dim",
                                )}>
                                  AI {c.juryTopAdjustment >= 0 ? "+" : ""}{c.juryTopAdjustment}
                                </span>
                              )}

                              {/* Anchor status */}
                              <span className={cn(
                                "ml-auto flex items-center gap-1",
                                anchorOk ? "text-signal" : anchorSkipped ? "text-foreground-dim" : "text-impatience",
                              )}>
                                {anchorOk ? "✓ anchored" : anchorSkipped ? "◌ cached" : c.anchorStatus === "failed" ? "⚠ failed" : ""}
                              </span>
                            </div>

                            {/* Portfolio value + drawdown */}
                            <div className="flex items-center gap-3 mt-0.5 text-foreground-dim">
                              {c.portfolioValueUsd > 0 && (
                                <span>
                                  ${c.portfolioValueUsd.toFixed(2)}
                                </span>
                              )}
                              {c.drawdownPercent > 0 && (
                                <span className="text-impatience/70">
                                  −{c.drawdownPercent.toFixed(1)}% DD
                                </span>
                              )}
                              {c.regimeLabel && (
                                <span>
                                  regime: <span className="text-foreground-muted">{c.regimeLabel}</span>
                                </span>
                              )}
                              {c.juryProvider && (
                                <span className={juryActive ? "text-purple-400/70" : "text-foreground-dim"}>
                                  jury: {c.juryProvider}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}

        {status?.cycleHistory && status.cycleHistory.length > 0 && !demoMode && (
          <DisclosureSection
            className="mt-4"
            title="Cycle history"
            subtitle={`Last ${status.cycleHistory.length} cycles`}
            icon={<Activity className="w-3.5 h-3.5 text-signal" />}
          >
            <div className="space-y-2">
              {[...status.cycleHistory].reverse().slice(0, 5).map((c, i) => (
                <div
                  key={c.cycle}
                  className="flex items-center gap-2 flex-wrap text-[10px] font-mono p-2 rounded-lg bg-surface/40 border border-border/30"
                >
                  <span className={cn("font-semibold", i === 0 ? "text-signal" : "text-foreground")}>
                    #{c.cycle}
                  </span>
                  <span className="text-foreground-dim">
                    {c.tradesExecuted > 0 ? `${c.tradesExecuted} trade(s)` : "no trades"}
                  </span>
                  {c.topSignal && (
                    <span className="text-foreground-muted">
                      · {c.topSignal.symbol} {c.topSignal.score}
                    </span>
                  )}
                  <span className={cn("ml-auto", c.anchorStatus === "success" ? "text-signal" : "text-foreground-dim")}>
                    {c.anchorStatus === "success" ? "✓ anchored" : c.anchorStatus ?? "—"}
                  </span>
                </div>
              ))}
            </div>
          </DisclosureSection>
        )}

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
                {/* ── "Early, Not Wrong" — conviction proven callout ── */}
                {(() => {
                  const proven = conviction.heldPositions
                    .map((p) => {
                      const verdict = conviction.positionVerdicts.find(
                        (v) => v.symbol === p.symbol,
                      );
                      const signal = conviction.signals.find(
                        (s) => s.symbol === p.symbol,
                      );
                      const isProven =
                        verdict?.heldThroughDrawdown &&
                        p.maxUnderwaterPercent <= -10 &&
                        (verdict?.unrealizedPnLPercent ?? 0) > 0 &&
                        !p.stuck;
                      return { position: p, verdict, signal, isProven };
                    })
                    .filter((x) => x.isProven);

                  if (proven.length > 0) {
                    const { position: p, verdict, signal } = proven[0]!;
                    return (
                      <ProvenConvictionBanner
                        key={`proven-${p.symbol}`}
                        position={p}
                        verdict={verdict!}
                        signal={signal ?? undefined}
                        compact={!demoMode}
                      />
                    );
                  }

                  return (
                    <div className="rounded-lg border border-dashed border-patience/25 bg-patience/5 p-3 mb-1">
                      <p className="text-[10px] font-mono font-bold uppercase tracking-wider text-patience/80">
                        ◆ Early, Not Wrong — awaiting proof
                      </p>
                      {demoMode && (
                      <p className="text-[10px] font-mono text-foreground-muted mt-1.5 leading-relaxed">
                        No open position has held through ≥10% drawdown and recovered
                        yet. The agent holds by design — conviction is tested when
                        you&apos;re early, not when you&apos;re obviously right.
                      </p>
                      )}
                    </div>
                  );
                })()}

                {conviction.heldPositions.map((p) => {
                  const verdict = conviction.positionVerdicts.find(
                    (v) => v.symbol === p.symbol,
                  );
                  const entrySignal = conviction.signals.find(
                    (s) => s.symbol === p.symbol,
                  );
                  return (
                    <PositionRow
                      key={p.symbol}
                      position={p}
                      verdict={verdict}
                      entrySignal={entrySignal}
                      expandable={!demoMode}
                    />
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

        {!demoMode && (
          <AgentLiveHooks
            className="mt-2"
            onNavigate={handleViewChange}
            anchorResults={conviction?.anchorResults}
            guidanceAction={signalsTeaser?.guidance.recommendedAction}
            topCandidate={signalsTeaser?.guidance.topCandidate}
          />
        )}
      </AgentViewPanel>
      )}

      {showProof && (
      <AgentViewPanel viewKey="proof" animate={!demoMode} id="act-3">
        {demoMode && <DemoActBanner act={3} title="Anchor" />}
        <AgentProofPanel
          anchorResults={conviction?.anchorResults}
          cycle={status.cycle}
        />
      </AgentViewPanel>
      )}

      {showHire && (
      <AgentViewPanel viewKey="hire" animate={!demoMode} id="act-4">
        {demoMode && <DemoActBanner act={4} title="Verify & hire" />}

        {!demoMode && signalsTeaser && (
          <AgentHireSummary
            guidanceAction={signalsTeaser.guidance.recommendedAction}
            topCandidate={signalsTeaser.guidance.topCandidate}
            className="mb-4"
          />
        )}

        <div id="hire" className="space-y-4 scroll-mt-28">
          {demoMode ? (
          <>
          <div className="border-l-2 border-[#65b3ae]/50 pl-4">
            <p className="text-xs font-mono uppercase tracking-wider text-[#65b3ae]">
              Hire this agent
            </p>
            <p className="text-sm text-foreground-muted mt-1 leading-relaxed">
              Hire an autonomous contrarian agent that scores BSC tokens every 4 hours and
              anchors every thesis on Casper + Mantle. Same{" "}
              <span className="font-mono text-foreground">signals-live/v1.2</span> on MCP
              (Casper x402) and CROO CAP (USDC on Base) — guidance plus per-cycle
              execution alignment.
            </p>
          </div>
          <ProofLadder variant="full" />
          <IntegrationHub />
          <BuyerPreviewCard />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <ReputationApiCard />
            <CrooCapCard />
          </div>
          </>
          ) : (
          <>
            <ProofLadder variant="compact" />
            <BuyerPreviewCard />
            <DisclosureSection
              title="Integration options"
              subtitle="MCP x402 · CROO CAP · signals-live/v1.2"
              icon={<Network className="w-3.5 h-3.5 text-signal" />}
            >
              <IntegrationHub className="border-0 bg-transparent" />
            </DisclosureSection>
            <DisclosureSection
              title="MCP reputation API"
              subtitle="Query stats · x402 pricing"
              icon={<BarChart3 className="w-3.5 h-3.5 text-signal" />}
            >
              <ReputationApiCard />
            </DisclosureSection>
            <DisclosureSection
              title="CROO CAP marketplace"
              subtitle="USDC on Base · Store listing"
              icon={<ShoppingBag className="w-3.5 h-3.5 text-[#65b3ae]" />}
            >
              <CrooCapCard />
            </DisclosureSection>
          </>
          )}
        </div>

        <details id="personal-anchor" className="rounded-xl border border-border/40 bg-surface/20">
          <summary className="px-4 py-3 text-xs font-mono text-foreground-muted cursor-pointer select-none list-none hover:text-signal transition-colors">
            Personal anchor (optional) — sign your own conviction on Casper
          </summary>
          <div className="px-4 pb-4 pt-1 max-w-md">
            <CasperWalletConnect />
          </div>
        </details>
      </AgentViewPanel>
      )}
      </AnimatePresence>

      {/* ── Technical appendix — collapsed by default ── */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.32, duration: 0.35 }}
      >
        <details className="group rounded-xl border border-border/40 bg-surface/20">
          <summary
            className={cn(
              "flex items-center gap-2 rounded-xl p-4",
              "text-xs font-mono uppercase tracking-wider",
              "text-foreground-muted hover:text-signal cursor-pointer",
              "select-none list-none transition-colors",
            )}
          >
            <BarChart3 className="w-3.5 h-3.5 text-signal shrink-0" />
            <span>Technical details</span>
            <span className="text-[10px] text-foreground-dim font-normal normal-case">
              trades · market data · narrative · resources · architecture
            </span>
            <span className="ml-auto text-[10px] text-foreground-dim font-normal normal-case group-open:hidden">
              Expand
            </span>
            <span className="ml-auto text-[10px] text-foreground-dim font-normal normal-case hidden group-open:inline">
              Collapse
            </span>
          </summary>
          <div className="px-4 pb-4 space-y-6 border-t border-border/30 pt-4">
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

      {/* Resources */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.44, duration: 0.4 }}
      >
        <p className="text-[10px] font-mono uppercase tracking-wider text-foreground-dim mb-2 flex items-center gap-2">
          <ExternalLink className="w-3 h-3 text-signal" />
          Resources
        </p>
        <div className="space-y-1">
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
      </motion.div>

      {/* Pipeline architecture */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.52, duration: 0.4 }}
      >
        <p className="text-[10px] font-mono uppercase tracking-wider text-foreground-dim mb-2 flex items-center gap-2">
          <Zap className="w-3 h-3 text-signal" />
          Pipeline architecture
        </p>
        <Card className="bg-surface/30 border-border/50">
          <CardContent className="pt-4">
            <PipelineGrid />
          </CardContent>
        </Card>
      </motion.div>

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
  providers?: {
    x402: {
      queriesServed: number;
      paidQueries: number;
      feesCollectedBaseUnits: string;
      pricing: Record<string, { paid: boolean; amountBaseUnits: string; description: string }>;
      byTool: Record<string, { calls: number; paidCalls: number; baseUnits: string }>;
    };
    cap: {
      queriesServed: number;
      paidQueries: number;
      feesCollectedBaseUnits: string;
      pricing: Record<string, { paid: boolean; amountUsdcBaseUnits: string; description: string }>;
      byTool: Record<string, { calls: number; paidCalls: number; baseUnits: string }>;
    };
  };
}

interface CapStatusResponse {
  connected: boolean;
  services: Record<string, string>;
}

type CapProviderStats = NonNullable<ReputationStats["providers"]>["cap"];

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

/** Format USDC base units (6 decimals on Base). */
function formatUsdc(baseUnits: string | undefined, decimals = 6): string {
  if (!baseUnits) return "—";
  const n = BigInt(baseUnits);
  if (n === BigInt(0)) return "$0";
  const divisor = BigInt(10) ** BigInt(decimals);
  const whole = n / divisor;
  const fraction = n % divisor;
  const fracStr = fraction.toString().padStart(decimals, "0").replace(/0+$/, "");
  return fracStr ? `$${whole}.${fracStr} USDC` : `$${whole} USDC`;
}

const CROO_STORE_URL = crooStoreUrl("dashboard", "cap-card");
const CROO_REQUESTER_REPO = CROO_REQUESTER_PATH;

interface SignalsLivePreview {
  schema: string;
  teaser: true;
  freshness: {
    cycle: number;
    stale: boolean;
    staleReason: string | null;
  };
  guidance: {
    recommendedAction: BuyerRecommendedAction;
    reason: string;
    topCandidate: string | null;
    sizeMultiplier: number;
  };
  signalCount: number;
  topSignal: { symbol: string; score: number } | null;
  provenance: {
    behavioral: {
      score: number;
      archetype: string;
    } | null;
    reputation: {
      totalAnchors: number;
      dualChain: boolean;
    };
  };
  unlock: {
    message: string;
    crooStoreUrl: string;
    priceUsdc: string;
    dashboardUrl: string;
  };
  meta: { schemaUrl: string };
}

const GUIDANCE_LABELS_LOCAL: Record<BuyerRecommendedAction, string> = GUIDANCE_LABELS;

const CROO_CAP_REQUESTER_SNIPPET = `# Reference requester — examples/croo-requester/
export CROO_SDK_KEY=croo_sk_your_requester_key   # not the provider key

cd examples/croo-requester
npm install
npm run dry-run    # validate sample + print guidance
npm start          # live negotiate → pay → deliver`;

function BuyerPreviewCard() {
  const [preview, setPreview] = useState<SignalsLivePreview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stale = false;
    async function load() {
      try {
        const res = await fetch("/api/agent/proxy?endpoint=signals/teaser");
        if (!res.ok) throw new Error(`signals/teaser returned ${res.status}`);
        const data = (await res.json()) as SignalsLivePreview;
        if (!stale) setPreview(data);
      } catch (e) {
        if (!stale) setError(e instanceof Error ? e.message : "failed to load");
      }
    }
    load();
    const id = setInterval(load, 60_000);
    return () => {
      stale = true;
      clearInterval(id);
    };
  }, []);

  const action = preview?.guidance.recommendedAction;
  const actionClass = action ? guidanceActionClass(action) : "";

  return (
    <Card className="bg-surface/30 border-border/50 border-signal/25">
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-mono uppercase tracking-wider text-foreground-muted flex items-center gap-2 flex-wrap">
          <Sparkles className="w-3.5 h-3.5 text-signal" />
          What buyers get
          <span className="ml-auto text-[10px] font-mono text-foreground-dim normal-case">
            signals-live/v1.2 · same on MCP + CROO
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-[11px] text-foreground-muted leading-relaxed">
          Public teaser — guidance + top symbol only. Paid{" "}
          <span className="font-mono text-foreground">signals-live/v1.2</span> adds full
          rankings, factor breakdowns, execution ledger (entries / skips / alignment), and
          on-chain provenance with explicit behavioral status.
        </p>

        {preview ? (
          <div className="rounded-lg border border-signal/30 bg-signal/5 p-3 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              {action && (
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-mono uppercase tracking-wider border",
                    actionClass,
                  )}
                >
                  {GUIDANCE_LABELS_LOCAL[action]}
                  {preview.guidance.topCandidate && action === "evaluate" && (
                    <span className="normal-case">· {preview.guidance.topCandidate}</span>
                  )}
                </span>
              )}
              <span className="text-[10px] font-mono text-foreground-dim">
                cycle {preview.freshness.cycle}
                {preview.freshness.stale ? " · stale" : " · fresh"}
              </span>
              {preview.provenance.reputation.dualChain && (
                <span className="text-[10px] font-mono px-2 py-0.5 rounded border border-signal/30 text-signal">
                  dual-chain
                </span>
              )}
            </div>

            <p className="text-[11px] font-mono text-foreground leading-relaxed">
              {preview.guidance.reason}
            </p>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px] font-mono">
              <div className="rounded bg-black/30 px-2 py-1.5">
                <p className="text-foreground-dim uppercase tracking-wider">Ranked</p>
                <p className="text-foreground tabular-nums">{preview.signalCount}</p>
              </div>
              <div className="rounded bg-black/30 px-2 py-1.5">
                <p className="text-foreground-dim uppercase tracking-wider">Behavior</p>
                <p className="text-foreground tabular-nums">
                  {preview.provenance.behavioral?.score ?? "—"}
                </p>
              </div>
              <div className="rounded bg-black/30 px-2 py-1.5">
                <p className="text-foreground-dim uppercase tracking-wider">Anchors</p>
                <p className="text-foreground tabular-nums">
                  {preview.provenance.reputation.totalAnchors}
                </p>
              </div>
              <div className="rounded bg-black/30 px-2 py-1.5">
                <p className="text-foreground-dim uppercase tracking-wider">Size ×</p>
                <p className="text-foreground tabular-nums">
                  {preview.guidance.sizeMultiplier}
                </p>
              </div>
            </div>
          </div>
        ) : error ? (
          <p className="text-[10px] text-impatience font-mono">preview: {error}</p>
        ) : (
          <Skeleton className="h-24 w-full rounded-lg" />
        )}

        <div className="flex flex-wrap gap-2">
          <a
            href={preview?.meta.schemaUrl ?? SIGNALS_SCHEMA_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-1 rounded border border-border/50 hover:border-signal/40 text-foreground-muted hover:text-signal transition-colors"
          >
            JSON Schema
            <ExternalLink className="w-3 h-3" />
          </a>
          <a
            href={SIGNALS_EXAMPLE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-1 rounded border border-border/50 hover:border-signal/40 text-foreground-muted hover:text-signal transition-colors"
          >
            Example response
            <ExternalLink className="w-3 h-3" />
          </a>
          <a
            href={preview?.unlock.crooStoreUrl ?? CROO_STORE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-1 rounded border border-[#65b3ae]/40 hover:bg-[#65b3ae]/10 text-[#65b3ae] transition-colors"
          >
            Hire on CROO · ${preview?.unlock.priceUsdc ?? "0.05"}
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>

        <p className="text-[10px] font-mono text-foreground-dim leading-relaxed">
          {preview?.unlock.message}
        </p>
      </CardContent>
    </Card>
  );
}

const MCP_CONFIG_SNIPPET = `{
  "mcpServers": {
    "early-not-wrong": {
      "url": "https://earlynotwrong.vercel.app/api/agent/proxy?endpoint=mcp"
    }
  }
}`;

const MCP_ENDPOINT = "http://144.202.117.160:31777/mcp";

const MCP_CURL_FREE = `curl -sS -X POST ${MCP_ENDPOINT} \\
  -H 'content-type: application/json' \\
  -H 'accept: application/json, text/event-stream' \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_agent_reputation","arguments":{"subjectHash":"0x4a937673ea542abdf587e6b509793b2173980228cc65180a2f32c24fd3ac459a"}}}'`;

const MCP_CURL_PAID = `curl -sS -i -X POST ${MCP_ENDPOINT} \\
  -H 'content-type: application/json' \\
  -H 'accept: application/json, text/event-stream' \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_live_signals","arguments":{}}}'`;

function ReputationApiCard() {
  const [stats, setStats] = useState<ReputationStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<"config" | "free" | "paid" | null>(null);

  const x402 = stats?.providers?.x402 ?? (stats ? {
    queriesServed: stats.queriesServed,
    paidQueries: stats.paidQueries,
    feesCollectedBaseUnits: stats.feesCollectedBaseUnits,
    pricing: stats.pricing,
    byTool: stats.byTool,
  } : null);

  const copySnippet = (key: "config" | "free" | "paid", text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(null), 1500);
    });
  };

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
          MCP · x402
          <span className="ml-auto text-[10px] text-foreground-dim">
            Casper settlement
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 gap-3 mb-4">
          <div className="rounded-lg bg-surface/40 border border-border/40 p-3">
            <p className="text-[10px] font-mono text-foreground-muted uppercase tracking-wider">Queries served</p>
            <p className="text-2xl font-semibold tabular-nums">
              {x402?.queriesServed ?? "—"}
            </p>
          </div>
          <div className="rounded-lg bg-surface/40 border border-border/40 p-3">
            <p className="text-[10px] font-mono text-foreground-muted uppercase tracking-wider">Paid</p>
            <p className="text-2xl font-semibold tabular-nums text-signal">
              {x402?.paidQueries ?? "—"}
            </p>
          </div>
          <div className="rounded-lg bg-surface/40 border border-border/40 p-3">
            <p className="text-[10px] font-mono text-foreground-muted uppercase tracking-wider">
              Fees collected{" "}
              <span className="text-foreground-dim normal-case">(testnet)</span>
            </p>
            <p className="text-2xl font-semibold tabular-nums text-patience">
              {formatCspr(x402?.feesCollectedBaseUnits)}
            </p>
          </div>
        </div>

        <p className="text-[11px] text-foreground-muted mb-3 leading-relaxed">
          Query over{" "}
          <span className="font-mono text-foreground">Model Context Protocol</span>{" "}
          with per-call <span className="font-mono text-foreground">x402</span>{" "}
          micropayments on Casper — same{" "}
          <span className="font-mono text-foreground">signals-live/v1.2</span> payload as CROO.{" "}
          <a
            href={DOCS_MCP_INTEGRATION}
            target="_blank"
            rel="noopener noreferrer"
            className="text-signal hover:underline"
          >
            Integration guide
          </a>
        </p>

        <div className="rounded-lg border border-signal/30 bg-signal/5 p-3 mb-4">
          <p className="text-[11px] font-mono text-foreground font-semibold">
            get_live_signals
            <span className="ml-2 text-signal">0.5 CSPR</span>
          </p>
          <p className="text-[10px] font-mono text-foreground-muted mt-0.5 leading-relaxed">
            signals-live/v1.2 — ranked candidates, macro gate, execution alignment,
            provenance bundle, and buyer <code className="text-foreground">guidance</code>{" "}
            action contract
          </p>
        </div>

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
              {x402 &&
                Object.entries(x402.pricing).map(([tool, p]) => {
                  const called = x402.byTool[tool];
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

        {/* Try it — copy-paste curls for judges and integrators */}
        <div className="mt-4 space-y-3">
          <p className="text-[10px] font-mono uppercase tracking-wider text-foreground-dim">
            Try it now
          </p>

          <div className="rounded-lg border border-border/40 bg-surface/30 p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] font-mono text-foreground">
                <span className="text-patience">Free</span> ·{" "}
                <code className="text-foreground-muted">get_agent_reputation</code>
              </p>
              <button
                type="button"
                onClick={() => copySnippet("free", MCP_CURL_FREE)}
                className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-1 rounded bg-surface/60 border border-border/50 hover:border-signal/40 text-foreground-muted hover:text-signal transition-colors"
              >
                <Copy className="w-3 h-3" />
                {copied === "free" ? "Copied!" : "Copy curl"}
              </button>
            </div>
            <pre className="p-2 rounded bg-black/40 text-[9px] text-foreground-muted overflow-x-auto font-mono leading-relaxed">
              {MCP_CURL_FREE}
            </pre>
          </div>

          <div className="rounded-lg border border-signal/30 bg-signal/5 p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] font-mono text-foreground">
                <span className="text-signal">Paid · 402</span> ·{" "}
                <code className="text-foreground-muted">get_live_signals</code>
              </p>
              <button
                type="button"
                onClick={() => copySnippet("paid", MCP_CURL_PAID)}
                className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-1 rounded bg-surface/60 border border-border/50 hover:border-signal/40 text-foreground-muted hover:text-signal transition-colors"
              >
                <Copy className="w-3 h-3" />
                {copied === "paid" ? "Copied!" : "Copy curl"}
              </button>
            </div>
            <pre className="p-2 rounded bg-black/40 text-[9px] text-foreground-muted overflow-x-auto font-mono leading-relaxed">
              {MCP_CURL_PAID}
            </pre>
            <p className="text-[10px] font-mono text-foreground-dim leading-relaxed">
              Returns HTTP 402 + Casper x402 PaymentRequirements (0.5 CSPR). Response is{" "}
              <span className="font-mono text-foreground">signals-live/v1.2</span> — see the
              preview card above. Re-POST with a signed{" "}
              <code className="text-foreground-muted">X-PAYMENT</code> header to settle.
            </p>
          </div>
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
              onClick={() => copySnippet("config", MCP_CONFIG_SNIPPET)}
              className="text-[10px] font-mono px-2 py-1 rounded bg-surface/60 border border-border/50 hover:border-signal/40 text-foreground-muted hover:text-signal transition-colors"
            >
              {copied === "config" ? "Copied!" : "Copy"}
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

function CrooCapCard() {
  const [capStatus, setCapStatus] = useState<CapStatusResponse | null>(null);
  const [capStats, setCapStats] = useState<CapProviderStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let stale = false;
    async function load() {
      try {
        const [statusRes, statsRes] = await Promise.all([
          fetch("/api/agent/proxy?endpoint=cap/status"),
          fetch("/api/agent/proxy?endpoint=reputation/stats"),
        ]);
        if (!statusRes.ok) throw new Error(`cap/status returned ${statusRes.status}`);
        const statusData = (await statusRes.json()) as CapStatusResponse;
        if (!stale) setCapStatus(statusData);

        if (statsRes.ok) {
          const statsData = (await statsRes.json()) as ReputationStats;
          if (!stale) setCapStats(statsData.providers?.cap ?? null);
        }
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

  const signalsLive = capStats?.pricing["signals-live"];
  const signalsCalls = capStats?.byTool["signals-live"];

  return (
    <Card className="bg-surface/30 border-border/50 border-[#65b3ae]/20">
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-mono uppercase tracking-wider text-foreground-muted flex items-center gap-2 flex-wrap">
          <DollarSign className="w-3.5 h-3.5 text-[#65b3ae]" />
          CROO · CAP
          <span className="ml-auto text-[10px] text-foreground-dim">
            USDC on Base
          </span>
          {capStatus && (
            <span
              className={cn(
                "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-mono uppercase tracking-wider border",
                capStatus.connected
                  ? "border-patience/30 bg-patience/10 text-patience"
                  : "border-impatience/30 bg-impatience/10 text-impatience",
              )}
            >
              <span
                className={cn(
                  "w-1.5 h-1.5 rounded-full",
                  capStatus.connected ? "bg-patience" : "bg-impatience",
                )}
              />
              {capStatus.connected ? "Connected" : "Offline"}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 gap-3 mb-4">
          <div className="rounded-lg bg-surface/40 border border-border/40 p-3">
            <p className="text-[10px] font-mono text-foreground-muted uppercase tracking-wider">Orders fulfilled</p>
            <p className="text-2xl font-semibold tabular-nums">
              {capStats?.queriesServed ?? "—"}
            </p>
          </div>
          <div className="rounded-lg bg-surface/40 border border-border/40 p-3">
            <p className="text-[10px] font-mono text-foreground-muted uppercase tracking-wider">Paid</p>
            <p className="text-2xl font-semibold tabular-nums text-[#65b3ae]">
              {capStats?.paidQueries ?? "—"}
            </p>
          </div>
          <div className="rounded-lg bg-surface/40 border border-border/40 p-3">
            <p className="text-[10px] font-mono text-foreground-muted uppercase tracking-wider">USDC earned</p>
            <p className="text-2xl font-semibold tabular-nums text-patience">
              {formatUsdc(capStats?.feesCollectedBaseUnits)}
            </p>
          </div>
        </div>

        <p className="text-[11px] text-foreground-muted mb-3 leading-relaxed">
          Hire this agent on the{" "}
          <a
            href={CROO_STORE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-[#65b3ae] hover:underline"
          >
            CROO Agent Store
          </a>
          . USDC on Base via CAP — identical{" "}
          <span className="font-mono text-foreground">signals-live/v1.2</span> JSON on every
          paid order.
        </p>

        {/* Store-listed premium SKU */}
        <div className="rounded-lg border border-[#65b3ae]/30 bg-[#65b3ae]/5 p-3 mb-4 space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div>
              <p className="text-[11px] font-mono text-foreground font-semibold">
                signals-live
                <span className="ml-2 text-[#65b3ae]">$0.05 USDC</span>
                <span className="ml-2 text-[10px] text-foreground-dim">v1.2</span>
              </p>
              <p className="text-[10px] font-mono text-foreground-muted mt-0.5 leading-relaxed">
                Ranked signals + execution alignment + provenance — Requirements{" "}
                <code className="text-foreground">{`{}`}</code> only
              </p>
            </div>
            <a
              href={CROO_STORE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-1 rounded border border-[#65b3ae]/40 text-[#65b3ae] hover:bg-[#65b3ae]/10 transition-colors"
            >
              Hire on CROO
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
          {signalsLive && (
            <p className="text-[10px] font-mono text-foreground-dim">
              {signalsCalls?.calls ?? 0} fulfillment
              {(signalsCalls?.paidCalls ?? 0) > 0
                ? ` (${signalsCalls?.paidCalls} paid)`
                : ""}
              {" · "}
              maps to MCP <code className="text-foreground-muted">get_live_signals</code>
            </p>
          )}
        </div>

        {/* Requester snippet */}
        <div className="rounded-lg border border-border/40 bg-surface/30 p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] font-mono text-foreground">
              <span className="text-[#65b3ae]">▸</span> Requester agent (CAP SDK)
            </p>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(CROO_CAP_REQUESTER_SNIPPET).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                });
              }}
              className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-1 rounded bg-surface/60 border border-border/50 hover:border-[#65b3ae]/40 text-foreground-muted hover:text-[#65b3ae] transition-colors"
            >
              <Copy className="w-3 h-3" />
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
          <pre className="p-2 rounded bg-black/40 text-[9px] text-foreground-muted overflow-x-auto font-mono leading-relaxed max-h-48">
            {CROO_CAP_REQUESTER_SNIPPET}
          </pre>
          <p className="text-[10px] font-mono text-foreground-dim leading-relaxed">
            Use a <strong className="font-normal text-foreground">requester</strong> SDK key (not
            the provider key on this VPS). See{" "}
            <a href={CROO_REQUESTER_REPO} className="text-[#65b3ae] hover:underline" target="_blank" rel="noopener noreferrer">
              examples/croo-requester
            </a>
            {" "}for dry-run and live purchase.
          </p>
        </div>

        {error && (
          <p className="mt-3 text-[10px] text-impatience font-mono">cap: {error}</p>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Main Page ───

function AgentDashboardContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const demoMode = searchParams.get("demo") === "1";

  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [trades, setTrades] = useState<TradesResponse | null>(null);
  const [conviction, setConviction] = useState<ConvictionData | null>(null);
  const [signalsTeaser, setSignalsTeaser] = useState<SignalsLiveTeaser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);
  const [countdown, setCountdown] = useState(REFRESH_INTERVAL / 1000);
  const [retryCount, setRetryCount] = useState(0);

  const fetchAll = useCallback(async () => {
    try {
      const [statusRes, tradesRes, convictionRes, teaserRes] = await Promise.all([
        fetch("/api/agent/proxy?endpoint=status"),
        fetch("/api/agent/proxy?endpoint=trades"),
        fetch("/api/agent/proxy?endpoint=conviction"),
        fetch("/api/agent/proxy?endpoint=signals/teaser"),
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
      if (teaserRes.ok) {
        setSignalsTeaser((await teaserRes.json()) as SignalsLiveTeaser);
      }
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

  useEffect(() => {
    if (!showDashboard || typeof window === "undefined") return;
    const hash = window.location.hash;
    if (!hash) return;
    const target = document.querySelector(hash);
    if (target) {
      requestAnimationFrame(() => {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
  }, [showDashboard]);

  return (
    <div className="min-h-screen text-foreground selection:bg-signal/20 overflow-x-hidden relative">
      <TunnelBackground />
      <Navbar />
      <main
        className={cn(
          "pt-24 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto min-h-[calc(100vh-6rem)] flex flex-col",
          demoMode ? "pb-12" : "pb-24 sm:pb-12",
        )}
      >
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
              <p className="mt-1 text-sm text-foreground-muted max-w-xl">
                {demoMode
                  ? "Four-act demo walkthrough for judges and integrators"
                  : "Watch live · verify on-chain · hire when ready"}
              </p>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <Button
                variant={demoMode ? "default" : "outline"}
                size="sm"
                className="rounded-full text-[10px] font-mono uppercase tracking-wider"
                onClick={() => router.push(demoMode ? "/agent" : DEMO_WALKTHROUGH_HREF)}
              >
                {demoMode ? "Simple view" : "Demo walkthrough"}
              </Button>
              <Link
                href="/analyzer"
                className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border/50 text-[10px] font-mono text-foreground-muted hover:text-signal hover:border-signal/30 transition-colors"
              >
                <Search className="w-3 h-3" />
                Audit wallet
              </Link>
              {status && !demoMode && (
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-surface/50 border border-border/50 text-xs font-mono">
                  <RefreshCw className="w-3 h-3 text-foreground-dim" />
                  <span className="text-foreground-muted">{countdown}s</span>
                </div>
              )}
              {status && demoMode && (
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-surface/50 border border-border/50 text-xs font-mono">
                  <span className="text-foreground-muted uppercase tracking-wider">Cycle</span>
                  <span className="font-semibold text-signal">#{status.cycle}</span>
                </div>
              )}
              {status && demoMode && (
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-surface/50 border border-border/50 text-xs font-mono">
                  <span className="text-foreground-muted uppercase tracking-wider">Trades</span>
                  <span className="font-semibold text-patience">{status.totalTrades}</span>
                </div>
              )}
              {showDashboard && demoMode && (
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

          {lastFetch && showDashboard && demoMode && (
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
                {demoMode ? <LoadingStory /> : <LoadingCompact />}
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
                <Dashboard
                  status={status}
                  trades={trades}
                  conviction={conviction}
                  signalsTeaser={signalsTeaser}
                  demoMode={demoMode}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}

export default function AgentDashboard() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center text-sm font-mono text-foreground-muted">
          Loading dashboard…
        </div>
      }
    >
      <AgentDashboardContent />
    </Suspense>
  );
}
