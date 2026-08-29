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
  DEMO_WALKTHROUGH_HREF,
} from "@/lib/product-copy";
import { resolveObservability, prevCycleDuration } from "@/lib/observability";
import { DisclosureSection } from "@/components/agent/disclosure-section";
import type { CycleObservability } from "@/components/agent/agent-observability-panel";
import { AgentCommandStrip } from "@/components/agent/agent-command-strip";
import { AgentLiveHooks } from "@/components/agent/agent-live-hooks";
import { AgentLiveSideRail } from "@/components/agent/agent-live-side-rail";
import { AgentProofPanel } from "@/components/agent/agent-proof-panel";
import { DemoWalkthroughIntro } from "@/components/agent/demo-walkthrough-intro";
import { DemoActNav, type DemoAct } from "@/components/agent/demo-act-nav";
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
import { LlmJuryCard } from "@/components/agent/llm-jury-card";
import { SignalEdgePanel } from "@/components/agent/signal-edge-panel";
import { DelphiArenaCard } from "@/components/agent/delphi-arena-card";
import { OptionsArenaCard } from "@/components/agent/options-arena-card";
import { BuyerPreviewCard } from "@/components/agent/buyer-preview-card";
import { ReputationApiCard } from "@/components/agent/reputation-api-card";
import { CrooCapCard } from "@/components/agent/croo-cap-card";
import type { ConvictionData } from "@/components/agent/agent-types";

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

// ConvictionData type lives in @/components/agent/agent-types.ts so card
// components (LlmJuryCard, SignalEdgePanel, …) can import it without reaching
// into this god component.

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

// ─── Dashboard ───

function DemoActBanner({ act, title }: { act: number; title: string }) {
  return (
    <p className="text-[10px] font-mono uppercase tracking-widest text-signal/80 mb-2">
      Act {act} · {title}
    </p>
  );
}

// ─── Dashboard ───

// ─── Dashboard ───

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
  const [demoAct, setDemoAct] = useState<DemoAct>(1);

  const handleDemoActChange = useCallback((act: DemoAct) => {
    setDemoAct(act);
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, []);

  useEffect(() => {
    if (demoMode || typeof window === "undefined") return;
    const sync = () => setView(hashToView(window.location.hash));
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, [demoMode]);

  const showLive = demoMode ? demoAct === 2 : view === "live";
  const showProof = demoMode ? demoAct === 3 : view === "proof";
  const showHire = demoMode ? demoAct === 4 : view === "hire";

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
      {demoMode && (
        <div className="sticky top-16 z-30 -mx-4 sm:-mx-6 lg:mx-0 px-4 sm:px-6 py-2 mb-1 border-b border-border/40 bg-background/90 backdrop-blur-md">
          <DemoActNav active={demoAct} onChange={handleDemoActChange} />
        </div>
      )}

      {/* Orientation — demo intro is compact; simple view uses command strip context */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0, duration: 0.4 }}
      >
        {demoMode ? (
          <DemoWalkthroughIntro cycle={status.cycle} nextRunAt={status.nextRunAt} />
        ) : null}
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

      {demoMode && demoAct === 1 && (
        <motion.div
          id="act-1"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.06, duration: 0.35 }}
        >
          <DemoActBanner act={1} title="Live" />
          <p className="text-xs text-foreground-muted mt-2 max-w-xl leading-relaxed">
            Status metrics above — expand <span className="text-signal font-mono">Health</span> or{" "}
            <span className="text-signal font-mono">Trace</span> for guardrails and SigNoz pipeline detail.
            Continue to Act 2 for scoring and positions.
          </p>
        </motion.div>
      )}

      {/* Tab panels / demo acts 2–4 */}
      <AnimatePresence mode="wait">
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
              <RegimeBar
                score={conviction.regime.score}
                label={conviction.regime.label}
                compact
              />
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
                {demoMode && conviction.signals[0] && (
                  <>
                    <DisclosureSection
                      className="mt-2"
                      title="7-factor breakdown"
                      subtitle="Top candidate · deterministic + jury"
                      icon={<BarChart3 className="w-3.5 h-3.5 text-signal" />}
                      defaultOpen
                    >
                      <SignalFactorBreakdown signal={conviction.signals[0]} />
                    </DisclosureSection>
                    <DisclosureSection
                      className="mt-2"
                      title="Scoring context"
                      subtitle="Regime · weights · macro"
                      icon={<Signal className="w-3.5 h-3.5 text-signal" />}
                    >
                      <SignalScoringDetails
                        regime={conviction.regime}
                        topSignal={conviction.signals[0]}
                        weights={conviction.signals[0].weights}
                      />
                    </DisclosureSection>
                  </>
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

        {/* ── Right: jury + cycle pipeline ── */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.22, duration: 0.35 }}
        >
          <AgentLiveSideRail
            juryPanel={<LlmJuryCard conviction={conviction} />}
            observability={resolvedObs}
            isRunning={status.status === "running"}
          />
        </motion.div>
        </div>

        {conviction?.casperEcosystemContext && (
          <DisclosureSection
            className="mt-4"
            title="Cross-chain context"
            subtitle="Casper MCP · CSPR.trade + network RPC"
            icon={<Globe className="w-3.5 h-3.5 text-cyan-400" />}
            badge={
              conviction.casperEcosystemContext.dexMcpReachable ||
              conviction.casperEcosystemContext.chainMcpReachable ? (
                <span className="text-[9px] font-mono text-emerald-400/90 normal-case">
                  MCP live
                </span>
              ) : undefined
            }
          >
            <Card className="bg-surface/30 border-border/50 border-cyan-500/20">
              <CardContent className="pt-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="p-2.5 rounded-lg bg-surface/40 border border-border/30">
                    <span className="text-[9px] font-mono uppercase tracking-wider text-foreground-dim">
                      CSPR Price
                    </span>
                    <p className="text-sm font-bold tabular-nums text-foreground mt-0.5">
                      {conviction.casperEcosystemContext.csprPriceUsd !== null
                        ? `$${conviction.casperEcosystemContext.csprPriceUsd.toFixed(4)}`
                        : "—"}
                    </p>
                  </div>
                  {conviction.casperEcosystemContext.networkStatus && (
                    <div className="p-2.5 rounded-lg bg-surface/40 border border-border/30">
                      <span className="text-[9px] font-mono uppercase tracking-wider text-foreground-dim">
                        Casper Network
                      </span>
                      <p className="text-sm font-bold tabular-nums text-foreground mt-0.5">
                        Era {conviction.casperEcosystemContext.networkStatus.eraId}
                      </p>
                    </div>
                  )}
                  {demoMode && conviction.casperEcosystemContext.networkStatus && (
                    <div className="p-2.5 rounded-lg bg-surface/40 border border-border/30">
                      <span className="text-[9px] font-mono uppercase tracking-wider text-foreground-dim">
                        Block Height
                      </span>
                      <p className="text-sm font-bold tabular-nums text-foreground mt-0.5">
                        {conviction.casperEcosystemContext.networkStatus.blockHeight.toLocaleString()}
                      </p>
                    </div>
                  )}
                  {demoMode &&
                    conviction.casperEcosystemContext.topDexTokens.length > 0 && (
                      <div className="p-2.5 rounded-lg bg-surface/40 border border-border/30">
                        <span className="text-[9px] font-mono uppercase tracking-wider text-foreground-dim">
                          CSPR.trade DEX
                        </span>
                        <div className="flex items-center gap-1 flex-wrap mt-1">
                          {conviction.casperEcosystemContext.topDexTokens
                            .slice(0, 4)
                            .map((t, i) => (
                              <span key={i} className="text-[10px] font-mono text-foreground">
                                {t.symbol}
                              </span>
                            ))}
                        </div>
                      </div>
                    )}
                </div>
                {demoMode && (
                  <p className="mt-2 text-[9px] font-mono text-foreground-dim flex items-start gap-2">
                    <Network className="w-3 h-3 text-cyan-400/60 shrink-0 mt-0.5" />
                    Bidirectional MCP — consumes CSPR.trade + Casper RPC; exposes 7 tools on /mcp.
                  </p>
                )}
              </CardContent>
            </Card>
          </DisclosureSection>
        )}

        {status?.cycleHistory && status.cycleHistory.length > 0 && (
          <DisclosureSection
            className="mt-4"
            title={demoMode ? "Cycle timeline" : "Cycle history"}
            subtitle={`Last ${status.cycleHistory.length} cycles`}
            icon={<Activity className="w-3.5 h-3.5 text-signal" />}
          >
            <div className="space-y-2">
              {[...status.cycleHistory]
                .reverse()
                .slice(0, demoMode ? 8 : 5)
                .map((c, i) => (
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
                        compact
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
                      expandable
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

        <AgentLiveHooks
          className="mt-2"
          onNavigate={(target) => {
            if (demoMode) {
              handleDemoActChange(target === "proof" ? 3 : 4);
            } else {
              handleViewChange(target);
            }
          }}
          anchorResults={conviction?.anchorResults}
          guidanceAction={signalsTeaser?.guidance.recommendedAction}
          topCandidate={signalsTeaser?.guidance.topCandidate}
        />
      </AgentViewPanel>
      )}

      {showProof && (
      <AgentViewPanel viewKey="proof" animate={!demoMode} id="act-3">
        {demoMode && <DemoActBanner act={3} title="Anchor" />}
        <AgentProofPanel
          anchorResults={conviction?.anchorResults}
          cycle={status.cycle}
        />
        <SignalEdgePanel />
        <DelphiArenaCard />
        <OptionsArenaCard />
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
          {demoMode && (
            <p className="text-sm text-foreground-muted leading-relaxed border-l-2 border-[#65b3ae]/50 pl-4">
              Hire an autonomous contrarian agent — same{" "}
              <span className="font-mono text-foreground">signals-live/v1.2</span> on MCP
              and CROO CAP. Expand sections below for integration paths.
            </p>
          )}
          <ProofLadder variant="compact" />
          <BuyerPreviewCard />
          <DisclosureSection
            title="Integration options"
            subtitle="MCP x402 · CROO CAP · signals-live/v1.2"
            icon={<Network className="w-3.5 h-3.5 text-signal" />}
            defaultOpen={demoMode}
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

// The hire-view integration cards (BuyerPreviewCard, ReputationApiCard,
// CrooCapCard) and their shared types/helpers/constants live in
// @/components/agent/ — extracted from this file. The LlmJuryCard and
// SignalEdgePanel are there too.

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
                  ? "One act at a time — expand sections as you go"
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
