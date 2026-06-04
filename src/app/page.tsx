"use client";

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { Navbar } from "@/components/layout/navbar";
import { Button } from "@/components/ui/button";
import { useConviction } from "@/hooks/use-conviction";
import { useAppStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { SHOWCASE_WALLETS } from "@/lib/showcase-data";
import { Terminal } from "@/components/ui/terminal";
import { TunnelBackground } from "@/components/ui/tunnel-background";
import { getFeatureAccess } from "@/lib/ethos-gates";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  ArrowRight,
  Activity,
  TrendingUp,
  Shield,
  ShieldCheck,
  AlertTriangle,
  Settings,
  Share2,
  Copy,
  Check,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { keccak256, toBytes } from "viem";
import { ConvictionBadge } from "@/components/ui/conviction-badge";
import { ScoreBreakdownDialog } from "@/components/ui/score-breakdown";
import { ethosClient } from "@/lib/ethos";
import { PositionExplorer } from "@/components/ui/position-explorer";
import { ShareDialog } from "@/components/ui/share-dialog";
import { ErrorPanel } from "@/components/ui/error-panel";
import { DataQualityBadge } from "@/components/ui/data-quality-badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
} from "@/components/ui/dialog";
import { WalletSearchInput } from "@/components/wallet/wallet-search-input";
import type { ResolvedIdentity } from "@/lib/services/identity-resolver";
import { AnalysisFilters } from "@/components/ui/analysis-filters";
import { ScanProgress } from "@/components/ui/scan-progress";
import { AleoConvictionCard } from "@/components/aleo/aleo-conviction-card";
import { AleoPrivateThesis } from "@/components/aleo/aleo-private-thesis";
import { MantleConvictionCard } from "@/components/mantle/mantle-conviction-card";
import { MantleStrategyLens } from "@/components/mantle/mantle-strategy-lens";
import { ReputationTierCard } from "@/components/reputation/reputation-tier-card";
import { CohortComparison } from "@/components/analysis/cohort-comparison";
import { PrivateBalanceCard } from "@/components/privacy/private-balance-card";
import { AnimatedScore } from "@/components/ui/animated-score";
import Link from "next/link";

export default function Home() {
  const {
    analyzeWallet,
    loadCachedAnalysis,
    isAnalyzing,
    isConnected,
    isShowcaseMode,
    activeAddress,
  } = useConviction();
  const {
    ethosScore,
    ethosProfile,
    farcasterIdentity,
    unifiedTrustScore,
    convictionMetrics,
    positionAnalyses,
    targetAddress,
    analysisChain,
    dataQuality,
    logs,
    parameters,
    setParameters,
    reset,
    errorState,
    clearError,
    dailyAnalysisCount,
    mantle,
  } = useAppStore();

  const [activeTab, setActiveTab] = useState<"analyzer" | "strategist">("analyzer");

  const [shareDialogOpen, setShareDialogOpen] = useState(false);

  const dailyLimit = useMemo(
    () => getFeatureAccess(ethosScore?.score ?? 0).dailyAnalysisLimit,
    [ethosScore?.score]
  );

  // Deterministic proof-of-analysis hash for Mantle anchoring.
  const thesisHash = useMemo(() => {
    if (!convictionMetrics) return "0x0000000000000000000000000000000000000000000000000000000000000000";
    return keccak256(toBytes(JSON.stringify({
      targetAddress,
      analysisChain,
      score: Math.round(convictionMetrics.score),
      archetype: convictionMetrics.archetype ?? "Unclassified",
      patienceTax: Math.round(convictionMetrics.patienceTax),
      upsideCapture: Math.round(convictionMetrics.upsideCapture),
      totalPositions: convictionMetrics.totalPositions,
      positions: positionAnalyses.slice(0, 10).map((position) => ({
        tokenAddress: position.tokenAddress,
        tokenSymbol: position.tokenSymbol ?? position.metadata?.symbol,
        totalInvested: Math.round(position.entryDetails.totalValue),
        totalRealized: Math.round(position.exitDetails?.totalValue ?? 0),
      })),
    })));
  }, [analysisChain, convictionMetrics, positionAnalyses, targetAddress]);

  const subjectHash = useMemo(() => {
    const subject = `${analysisChain ?? "unknown"}:${targetAddress ?? "unknown"}`;
    return keccak256(toBytes(subject));
  }, [analysisChain, targetAddress]);

  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const hasScanned = !isAnalyzing && logs.length > 0;
  const [hasEverScanned, setHasEverScanned] = useState(false);
  
  useEffect(() => {
    if (typeof window !== 'undefined') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setHasEverScanned(localStorage.getItem('enw_has_scanned') === 'true');
    }
  }, []);
  const [showSuccessMessage, setShowSuccessMessage] = useState(false);
  const prevHasScanned = useRef(false);

  useEffect(() => {
    if (hasScanned && !prevHasScanned.current && convictionMetrics) {
      // Use setTimeout to avoid synchronous setState inside effect which triggers cascading renders
      const timer = setTimeout(() => setShowSuccessMessage(true), 0);
      const hideTimer = setTimeout(() => setShowSuccessMessage(false), 4000);
      
      // Autoscroll to results once scan finishes
      const scrollTimer = setTimeout(() => {
        const resultsSection = document.getElementById("conviction-results");
        if (resultsSection) {
          resultsSection.scrollIntoView({
            behavior: "smooth",
            block: "start",
          });
        }
      }, 300); // Wait a bit for the animation and DOM update

      return () => {
        clearTimeout(timer);
        clearTimeout(hideTimer);
        clearTimeout(scrollTimer);
      };
    }
    prevHasScanned.current = hasScanned;
  }, [hasScanned, convictionMetrics]);

  const [isCopied, setIsCopied] = useState(false);
  const handleCopyAddress = useCallback(() => {
    if (targetAddress) {
      navigator.clipboard.writeText(targetAddress);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    }
  }, [targetAddress]);

  // Set localStorage after first successful scan
  useEffect(() => {
    if (hasScanned && typeof window !== 'undefined') {
      localStorage.setItem('enw_has_scanned', 'true');
      const timer = setTimeout(() => setHasEverScanned(true), 0);
      return () => clearTimeout(timer);
    }
  }, [hasScanned]);

  const formatCurrency = (val: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(val);

  return (
    <div
      className="min-h-screen text-foreground selection:bg-signal/20 overflow-x-hidden relative"
      suppressHydrationWarning
    >
      <TunnelBackground />
      <Navbar />

      <main className="pt-24 pb-12 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto min-h-[calc(100vh-6rem)] flex flex-col">
        {/* Hero Section */}
        <motion.section
          layout
          className="relative z-10 flex flex-col items-center text-center space-y-6 max-w-3xl mx-auto mb-12"
        >
          {/* Ambient Glow */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-125 h-125 bg-signal/5 rounded-full blur-[100px] -z-10 pointer-events-none" />

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-border bg-surface/50 backdrop-blur-sm text-xs font-mono text-foreground-muted"
          >
            <span
              className={cn(
                "w-1.5 h-1.5 rounded-full bg-signal shadow-[0_0_10px_var(--signal)]",
                isAnalyzing && "animate-pulse",
              )}
            />
            {isAnalyzing ? "SYSTEM ANALYZING..." : "CONVICTION ENGINE"}
          </motion.div>

          <motion.h1
            layout
            className="text-4xl md:text-6xl font-bold tracking-tight text-foreground leading-tight"
          >
            Being early feels like <br />
            <span className="text-foreground-muted">being wrong.</span>
          </motion.h1>

          <motion.p
            layout
            className="text-base md:text-lg text-foreground-muted max-w-2xl leading-relaxed"
          >
            An agentic on-chain behavioral analysis tool. We audit your trading
            history to distinguish between bad timing and bad thesis.
          </motion.p>

          {/* Action Buttons - Hide during analysis, show after scan for new scan option */}
          <AnimatePresence>
            {!isAnalyzing && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="flex flex-col items-center gap-8 pt-4 w-full"
              >
                {/* Mode Selector */}
                <div className="inline-flex p-1 rounded-full bg-surface border border-border">
                  <button
                    onClick={() => setActiveTab("analyzer")}
                    className={cn(
                      "px-6 py-1.5 rounded-full text-xs font-mono transition-all",
                      activeTab === "analyzer" 
                        ? "bg-foreground text-background" 
                        : "text-foreground-muted hover:text-foreground"
                    )}
                  >
                    ANALYZER
                  </button>
                  <button
                    onClick={() => setActiveTab("strategist")}
                    className={cn(
                      "px-6 py-1.5 rounded-full text-xs font-mono transition-all flex items-center gap-1.5",
                      activeTab === "strategist" 
                        ? "bg-signal text-black" 
                        : "text-foreground-muted hover:text-foreground"
                    )}
                  >
                    <Shield className="w-3 h-3" />
                    STRATEGIST
                  </button>
                </div>

                {activeTab === "analyzer" ? (
                  <div className="flex flex-col items-center gap-8 pt-4">
                  <div className="flex flex-col sm:flex-row items-center gap-4">
                    <Dialog>
                      <DialogTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-10 px-4 rounded-full border-border/50 hover:border-signal/50 font-mono text-xs text-foreground-muted gap-2"
                        >
                          <Settings className="w-4 h-4" />
                          Filters
                        </Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>Analysis Parameters</DialogTitle>
                          <DialogDescription>
                            Fine-tune the behavioral heuristics for your
                            conviction audit.
                          </DialogDescription>
                        </DialogHeader>
                        <div className="space-y-6 py-4">
                          <div className="space-y-3">
                            <label className="text-xs font-mono uppercase text-foreground-muted flex justify-between">
                              Time Horizon{" "}
                              <span>{parameters.timeHorizon} Days</span>
                            </label>
                            <input
                              type="range"
                              min="30"
                              max="365"
                              step="30"
                              value={parameters.timeHorizon}
                              onChange={(e) =>
                                setParameters({
                                  timeHorizon: parseInt(e.target.value) as
                                    | 30
                                    | 90
                                    | 180
                                    | 365,
                                })
                              }
                              className="w-full h-1 bg-surface rounded-lg appearance-none cursor-pointer accent-signal"
                            />
                          </div>
                          <div className="space-y-3">
                            <label className="text-xs font-mono uppercase text-foreground-muted flex justify-between">
                              Min. Trade Value{" "}
                              <span>${parameters.minTradeValue}</span>
                            </label>
                            <input
                              type="range"
                              min="0"
                              max="1000"
                              step="50"
                              value={parameters.minTradeValue}
                              onChange={(e) =>
                                setParameters({
                                  minTradeValue: parseInt(e.target.value),
                                })
                              }
                              className="w-full h-1 bg-surface rounded-lg appearance-none cursor-pointer accent-signal"
                            />
                          </div>
                        </div>
                      </DialogContent>
                    </Dialog>

                    {!hasScanned ? (
                      <Button
                        size="lg"
                        className="h-12 px-8 text-base rounded-full"
                        onClick={() => analyzeWallet()}
                        disabled={isAnalyzing}
                      >
                        {isConnected ? "Start Deep Scan" : "Connect to Scan"}
                        <ArrowRight className="ml-2 w-4 h-4" />
                      </Button>
                    ) : (
                      <Button
                        size="lg"
                        className="h-12 px-8 text-base rounded-full"
                        onClick={() => reset()}
                      >
                        New Scan
                        <ArrowRight className="ml-2 w-4 h-4" />
                      </Button>
                    )}
                    <Dialog>
                      <DialogTrigger asChild>
                        <Button
                          variant="ghost"
                          size="lg"
                          className="h-12 px-8 text-base rounded-full text-foreground-muted hover:text-foreground"
                        >
                          Read the Thesis
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto font-mono">
                        <DialogHeader>
                          <DialogTitle className="font-mono text-xs text-foreground-muted tracking-widest uppercase">
                            {">"} THESIS.md
                          </DialogTitle>
                        </DialogHeader>
                        <div className="space-y-6 text-sm leading-relaxed">
                          <div className="border-t border-border pt-4">
                            <p className="text-xs text-signal tracking-widest uppercase mb-2">
                              [PREMISE]
                            </p>
                            <p className="text-foreground text-lg font-medium">
                              Being early feels like being wrong.
                              <br />
                              <span className="text-foreground-muted">
                                Until it doesn&apos;t.
                              </span>
                            </p>
                          </div>

                          <div className="border-t border-border pt-4">
                            <p className="text-xs text-signal tracking-widest uppercase mb-2">
                              [ASYMMETRY]
                            </p>
                            <p className="text-foreground-muted">
                              Losses capped at −1x. Wins uncapped.
                            </p>
                            <p className="text-foreground mt-2">
                              The most expensive mistake isn&apos;t being
                              wrong—it&apos;s selling winners too early.
                            </p>
                          </div>

                          <div className="border-t border-border pt-4">
                            <p className="text-xs text-signal tracking-widest uppercase mb-2">
                              [THE PROBLEM]
                            </p>
                            <ul className="space-y-1 text-foreground-muted">
                              <li>
                                • Exit profitable positions prematurely due to
                                volatility
                              </li>
                              <li>
                                • Hold losers longer than winners, despite
                                asymmetric payoffs
                              </li>
                              <li>
                                • Misinterpret &quot;early&quot; as
                                &quot;wrong&quot; due to short-term drawdowns
                              </li>
                              <li>
                                • Lack objective evidence of how patience
                                affects P&L
                              </li>
                            </ul>
                          </div>

                          <div className="border-t border-border pt-4">
                            <p className="text-xs text-signal tracking-widest uppercase mb-2">
                              [CONVICTION INDEX]
                            </p>
                            <p className="text-foreground">
                              Not performance. Behavior under uncertainty.
                            </p>
                            <p className="text-foreground-muted mt-2">
                              A wallet-level score measuring how consistently a
                              trader allows upside to compound, caps downside
                              efficiently, and holds through drawdowns when
                              asymmetry remains.
                            </p>
                          </div>

                          <div className="border-t border-border pt-4">
                            <p className="text-xs text-signal tracking-widest uppercase mb-2">
                              [META-SIGNAL]
                            </p>
                            <p className="text-foreground-muted">
                              Not trade copying. Not alerts.
                            </p>
                            <p className="text-foreground mt-2">
                              Meta-signal about the trader, not the trade.
                            </p>
                          </div>

                          <div className="border-t border-border pt-4 pb-2">
                            <p className="text-xs text-foreground-dim tracking-widest uppercase">
                              [EOF]
                            </p>
                          </div>
                        </div>
                      </DialogContent>
                    </Dialog>
                  </div>

                  <div className="flex flex-col items-center gap-6 w-full max-w-lg mt-4">
                    <div className="w-full space-y-3">
                      <p className="text-[10px] font-mono text-foreground-muted uppercase tracking-widest text-center">
                        Analyze any public profile
                      </p>
                      <div className="flex items-center justify-center gap-2 text-[9px] font-mono text-foreground-muted">
                        <span>Today: {dailyAnalysisCount}/{dailyLimit === Infinity ? '∞' : dailyLimit} scans</span>
                        {dailyLimit !== Infinity && dailyAnalysisCount >= dailyLimit && (
                          <span className="text-amber-500">(Limit reached)</span>
                        )}
                      </div>
                      <div className={cn(
                        "rounded-lg",
                        !hasEverScanned && "ring-2 ring-signal/50 ring-offset-2 ring-offset-background animate-pulse"
                      )}>
                        <WalletSearchInput
                          onWalletSelected={async (
                            identity: ResolvedIdentity,
                          ) => {
                            console.log("Analyzing wallet:", identity);

                            // Update store with resolved identity data
                            const { setEthosData, setFarcasterIdentity } =
                              useAppStore.getState();

                            // Update Ethos data (score and profile together)
                            setEthosData(
                              identity.ethos?.score || null,
                              identity.ethos?.profile || null,
                            );

                            // Update Farcaster identity if available
                            if (identity.farcaster) {
                              setFarcasterIdentity(identity.farcaster);
                            }

                            // Trigger conviction analysis
                            await analyzeWallet(identity.address);
                          }}
                          className="max-w-none"
                        />
                      </div>
                      {!hasEverScanned && (
                        <p className="text-[10px] text-center text-foreground-muted mt-2 animate-pulse">
                          👆 Enter any wallet address, ENS name, or Farcaster handle to analyze their trading conviction
                        </p>
                      )}
                    </div>

                    {/* Advanced Filters */}
                    <div className="w-full max-w-md">
                      <AnalysisFilters />
                    </div>

                    <div className="flex flex-col items-center gap-3">
                      {!hasEverScanned && (
                        <p className="text-[9px] text-foreground-muted text-center">
                          Or try one of these examples:
                        </p>
                      )}
                      <p className="text-[10px] font-mono text-foreground-muted uppercase tracking-widest">
                        Quick start showcase
                      </p>
                      <div className="flex flex-wrap justify-center gap-2">
                        {SHOWCASE_WALLETS.slice(0, 3).map((wallet) => {
                          const archetypeLabel = wallet.description.match(/The '([^']+)'/)?.[1];
                          return (
                            <button
                              key={wallet.id}
                              onClick={() => analyzeWallet(wallet.id)}
                              className="group flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-lg border border-border/30 hover:border-signal/30 transition-colors"
                            >
                              <span className="font-mono text-[10px] text-foreground group-hover:text-foreground transition-colors">
                                {wallet.name}
                              </span>
                              {archetypeLabel && (
                                <span className="font-mono text-[8px] text-foreground-muted">
                                  {archetypeLabel}
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
                ) : (
                  <div className="w-full max-w-md mt-4 animate-in fade-in slide-in-from-bottom-4 duration-500 space-y-3">
                    <p className="text-[10px] font-mono text-foreground-muted text-center max-w-sm mx-auto">
                      Commit your trade thesis to Aleo for privacy-preserving proof-of-conviction. Your intent stays hidden until you choose to reveal it.
                    </p>
                    <AleoPrivateThesis />
                  </div>
                )}
                </motion.div>
              )}
            </AnimatePresence>
          </motion.section>

        {/* Dynamic Content Area */}
        <div className="flex-1 relative w-full max-w-6xl mx-auto">
          <AnimatePresence mode="wait">
            {/* STATE: ANALYZING (TERMINAL) */}
            {isAnalyzing && (
              <motion.div
                key="terminal"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                transition={{ duration: 0.3 }}
                className="w-full max-w-2xl mx-auto space-y-4"
              >
                <ScanProgress />
                <Terminal logs={logs} className="min-h-100" />
              </motion.div>
            )}

            {/* STATE: ERROR */}
            {!isAnalyzing && errorState.hasError && (
              <motion.div
                key="error"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="w-full max-w-3xl mx-auto"
              >
                <ErrorPanel
                  errorType={errorState.errorType!}
                  errorMessage={errorState.errorMessage!}
                  errorDetails={errorState.errorDetails}
                  canRetry={errorState.canRetry}
                  canUseCached={errorState.canUseCached}
                  recoveryAction={errorState.recoveryAction}
                  onRetry={() => {
                    clearError();
                    if (activeAddress) {
                      analyzeWallet(
                        isShowcaseMode ? SHOWCASE_WALLETS[0]?.id : undefined,
                      );
                    }
                  }}
                  onUseCached={() => {
                    if (activeAddress && analysisChain) {
                      clearError();
                      loadCachedAnalysis(activeAddress, analysisChain);
                    }
                  }}
                  onDismiss={clearError}
                />
              </motion.div>
            )}

            {/* STATE: RESULTS (DASHBOARD) */}
            {!isAnalyzing && hasScanned && !errorState.hasError && (
              <motion.div
                id="conviction-results"
                key="dashboard"
                initial="hidden"
                animate="visible"
                variants={{
                  hidden: { opacity: 0 },
                  visible: {
                    opacity: 1,
                    transition: {
                      staggerChildren: 0.1,
                    },
                  },
                }}
                className="grid grid-cols-1 md:grid-cols-6 lg:grid-cols-12 gap-6 relative z-10"
              >
                {/* Navigation + Summary */}
                <motion.div
                  variants={{
                    hidden: { opacity: 0, y: 20 },
                    visible: { opacity: 1, y: 0 },
                  }}
                  className="col-span-1 md:col-span-6 lg:col-span-12"
                >
                  {/* Summary Bar */}
                  {convictionMetrics && (
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4 p-3 rounded-lg bg-surface/50 border border-border">
                      <div className="flex items-center gap-3 flex-wrap">
                        {farcasterIdentity?.username && (
                          <span className="text-sm font-semibold text-foreground">@{farcasterIdentity.username}</span>
                        )}
                        <button
                          onClick={handleCopyAddress}
                          className="flex items-center gap-1.5 group hover:bg-surface p-1 -ml-1 rounded transition-colors"
                          title="Copy address"
                        >
                          <span className="font-mono text-xs text-foreground-muted group-hover:text-foreground transition-colors">
                            {targetAddress?.slice(0, 6)}...{targetAddress?.slice(-4)}
                          </span>
                          {isCopied ? (
                            <Check className="w-3 h-3 text-patience" />
                          ) : (
                            <Copy className="w-3 h-3 text-foreground-muted opacity-0 group-hover:opacity-100 transition-opacity" />
                          )}
                        </button>
                        {analysisChain && (
                          <span className={cn(
                            "text-[10px] px-1.5 py-0.5 rounded uppercase font-mono",
                            analysisChain === "solana" ? "bg-purple-500/10 text-purple-400" : "bg-blue-500/10 text-blue-400"
                          )}>
                            {analysisChain}
                          </span>
                        )}
                        <span className="text-xs text-foreground-muted">
                          Score: <span className="font-bold text-foreground">{convictionMetrics.score}</span>
                          {convictionMetrics.archetype && (
                            <> · {convictionMetrics.archetype}</>
                          )}
                          <> · Top {convictionMetrics.percentile}%</>
                          <> · {positionAnalyses.length} positions</>
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-xs font-mono text-foreground-muted hover:text-foreground"
                          onClick={() => setShareDialogOpen(true)}
                        >
                          <Share2 className="w-3.5 h-3.5 mr-1.5" />
                          Share
                        </Button>
                        <Link
                          href="/leaderboard"
                          target="_blank"
                          className="text-xs font-mono text-foreground-muted hover:text-foreground px-3 py-1.5 rounded hover:bg-surface transition-colors"
                        >
                          Leaderboard
                        </Link>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-xs font-mono text-foreground-muted hover:text-foreground"
                          onClick={() => reset()}
                        >
                          Analyze Another →
                        </Button>
                      </div>
                    </div>
                  )}
                </motion.div>

                {/* Score Card */}
                <motion.div
                  variants={{
                    hidden: { opacity: 0, y: 20 },
                    visible: { opacity: 1, y: 0 },
                  }}
                  className="col-span-1 md:col-span-6 lg:col-span-8 h-full"
                >
                  <Card className="glass-panel border-border/50 bg-surface/40 h-full min-h-75 flex flex-col justify-between overflow-hidden group relative">
                    <div className="absolute top-0 right-0 p-4 opacity-50 group-hover:opacity-100 transition-opacity">
                      {isShowcaseMode && (
                        <span className="mr-3 inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono font-medium bg-signal/10 text-signal border border-signal/20">
                          SHOWCASE MODE
                        </span>
                      )}
                      <Activity className="w-6 h-6 text-signal inline-block" />
                    </div>

                    {/* Conditional Content based on Data Availability */}
                    {convictionMetrics ? (
                      <>
                        <CardHeader className="pb-2">
                          <div className="flex justify-between items-start">
                            <div>
                              <div className="flex items-center gap-3 mb-1">
                                <CardTitle className="text-sm font-mono text-foreground-muted tracking-wider uppercase">
                                  Conviction Index
                                </CardTitle>
                                {dataQuality && (
                                  <DataQualityBadge
                                    symbolRate={
                                      dataQuality.dataCompleteness.symbolRate
                                    }
                                    priceRate={
                                      dataQuality.dataCompleteness.priceRate
                                    }
                                    avgTradeSize={dataQuality.avgTradeSize}
                                  />
                                )}
                              </div>
                              <CardDescription>
                                Behavioral score based on last{" "}
                                {parameters.timeHorizon}d.
                              </CardDescription>
                            </div>
                            <div className="flex gap-2">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="font-mono text-[10px] text-foreground hover:bg-surface/60 h-7"
                                onClick={() => setBreakdownOpen(true)}
                              >
                                Details
                              </Button>

                              <Button
                                variant="outline"
                                size="sm"
                                className={cn(
                                  "font-mono text-[10px] border-signal/50 text-signal hover:bg-signal/10 h-7",
                                  !hasEverScanned && "animate-pulse"
                                )}
                                onClick={() => setShareDialogOpen(true)}
                              >
                                <Share2 className="w-3.5 h-3.5 mr-1.5" />
                                SHARE RESULTS
                              </Button>
                            </div>
                          </div>
                        </CardHeader>
                        <CardContent className="flex flex-col xl:flex-row items-center xl:items-end justify-between gap-8 pt-4">
                          <div className="flex flex-col md:flex-row items-center md:items-end gap-6 md:gap-10">
                            <div className="space-y-2">
                              <div className="text-5xl sm:text-7xl md:text-8xl lg:text-9xl font-bold text-foreground tracking-tighter text-glow">
                                <AnimatedScore value={convictionMetrics.score} />
                              </div>
                              <div className="flex items-center gap-2 text-patience font-mono text-sm">
                                <TrendingUp className="w-4 h-4" />
                                Top {convictionMetrics.percentile}% of Traders
                              </div>
                            </div>

                            {convictionMetrics.archetype && (
                              <div className="pb-2 scale-90 md:scale-100 origin-bottom-left">
                                <ConvictionBadge
                                  archetype={convictionMetrics.archetype}
                                  showDescription
                                />
                              </div>
                            )}
                          </div>
                          <div className="space-y-4 w-full xl:w-auto min-w-60">
                            {/* Metrics */}
                            <div className="space-y-3">
                              <div className="flex justify-between items-baseline text-xs font-mono">
                                <span className="uppercase text-foreground-muted">Patience Tax</span>
                                <span className="text-lg font-bold text-impatience">
                                  -${formatCurrency(convictionMetrics.patienceTax)}
                                </span>
                              </div>
                              <div className="flex justify-between items-baseline text-xs font-mono">
                                <span className="uppercase text-foreground-muted">Upside Capture</span>
                                <span className="text-lg font-bold text-patience">
                                  {convictionMetrics.upsideCapture}%
                                </span>
                              </div>
                            </div>
                          </div>
                        </CardContent>
                        {/* Score Breakdown Dialog */}
                        <ScoreBreakdownDialog
                          open={breakdownOpen}
                          onOpenChange={setBreakdownOpen}
                          metrics={convictionMetrics}
                          positionCount={positionAnalyses.length}
                          ethosScore={ethosScore?.score}
                        />
                      </>
                    ) : (
                      /* Empty State for Score Card */
                      <div className="flex flex-col items-center justify-center h-full p-8 text-center space-y-4">
                        <AlertTriangle className="w-12 h-12 text-impatience/50" />
                        <div className="space-y-2">
                          <h3 className="text-xl font-bold text-foreground">
                            Insufficient Data
                          </h3>
                          <p className="text-foreground-muted max-w-md mx-auto">
                            We could not find enough on-chain trading history
                            for this wallet to generate a statistically
                            significant Conviction Score.
                          </p>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => reset()}
                          className="mt-4"
                        >
                          Try Another Wallet
                        </Button>
                      </div>
                    )}
                  </Card>
                </motion.div>

                {/* Ethos Card */}
                <motion.div
                  variants={{
                    hidden: { opacity: 0, y: 20 },
                    visible: { opacity: 1, y: 0 },
                  }}
                  className="col-span-1 md:col-span-6 lg:col-span-4 h-full"
                >
                  <Card className="glass-panel border-border/50 bg-surface/40 flex flex-col justify-between h-full relative overflow-hidden">
                    {/* Analyzing Other Wallet Indicator */}
                    {isConnected &&
                      targetAddress &&
                      targetAddress !== activeAddress && (
                        <div className="absolute top-0 left-0 right-0 bg-signal/10 border-b border-signal/20 py-1 px-4 flex items-center gap-2">
                          <div className="w-1.5 h-1.5 rounded-full bg-signal animate-pulse" />
                          <span className="text-[10px] font-mono text-signal uppercase font-bold tracking-widest">
                            Inspecting Public Profile
                          </span>
                        </div>
                      )}

                    <CardHeader
                      className={cn(
                        isConnected &&
                          targetAddress &&
                          targetAddress !== activeAddress
                          ? "pt-8"
                          : "pt-6",
                      )}
                    >
                      {/* Farcaster Identity Display */}
                      {farcasterIdentity && (
                        <div className="flex items-center gap-3 mb-4 p-3 rounded-lg bg-signal/5 border border-signal/20 max-h-35 overflow-hidden">
                          {farcasterIdentity.pfpUrl && (
                            <a
                              href={`https://warpcast.com/${farcasterIdentity.username}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="shrink-0 cursor-pointer hover:opacity-80 transition-opacity"
                            >
                              <img
                                src={farcasterIdentity.pfpUrl}
                                alt={farcasterIdentity.username}
                                className="w-10 h-10 rounded-full ring-2 ring-signal/30 hover:ring-signal/50 transition-all"
                                loading="lazy"
                              />
                            </a>
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-semibold text-foreground truncate">
                              {farcasterIdentity.displayName ||
                                farcasterIdentity.username}
                            </div>
                            <div className="text-xs text-foreground-muted truncate">
                              @{farcasterIdentity.username}
                            </div>
                          </div>
                        </div>
                      )}

                      <div className="flex items-center justify-between mb-2">
                        <CardTitle className="text-sm font-mono text-foreground-muted tracking-wider uppercase">
                          Reputation
                        </CardTitle>
                        <ShieldCheck className="w-5 h-5 text-ethos" />
                      </div>

                      <div className="text-3xl font-bold text-foreground">
                        {ethosScore
                          ? "Verified"
                          : farcasterIdentity
                            ? "Farcaster Verified"
                            : "Unknown"}
                      </div>
                      <CardDescription className="text-xs">
                        {ethosScore
                          ? "Verified via Ethos Network"
                          : farcasterIdentity
                            ? "Link your wallet to Ethos for reputation scoring"
                            : "Connect a wallet with Ethos history to unlock cohort comparison"}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="p-4 rounded-lg bg-surface/50 border border-border space-y-3">
                        {unifiedTrustScore && unifiedTrustScore.score > 0 && (
                          <div className="flex justify-between items-center text-sm">
                            <span className="text-foreground-muted">
                              Trust Score
                            </span>
                            <span className="font-mono text-signal font-bold">
                              {unifiedTrustScore.score}/100
                            </span>
                          </div>
                        )}
                        <div className="flex justify-between items-center text-sm">
                          <span className="text-foreground-muted">
                            Credibility
                          </span>
                          <span className="font-mono text-foreground">
                            {ethosScore?.score ?? "---"}
                          </span>
                        </div>
                        <div className="flex justify-between items-center text-sm">
                          <span className="text-foreground-muted">Tier</span>
                          <span
                            className={cn(
                              "font-mono text-xs px-2 py-1 rounded",
                              (ethosScore?.score ?? 0) >= 2000
                                ? "bg-patience/20 text-patience"
                                : (ethosScore?.score ?? 0) >= 1000
                                  ? "bg-signal/20 text-signal"
                                  : (ethosScore?.score ?? 0) >= 500
                                    ? "bg-foreground/20 text-foreground"
                                    : (ethosScore?.score ?? 0) >= 100
                                      ? "bg-foreground-muted/20 text-foreground-muted"
                                      : "bg-surface text-foreground-muted",
                            )}
                          >
                            {(ethosScore?.score ?? 0) >= 2000
                              ? "Elite"
                              : (ethosScore?.score ?? 0) >= 1000
                                ? "High"
                                : (ethosScore?.score ?? 0) >= 500
                                  ? "Medium"
                                  : (ethosScore?.score ?? 0) >= 100
                                    ? "Low"
                                    : "Unknown"}
                          </span>
                        </div>
                        <div className="flex justify-between items-center text-sm">
                          <span className="text-foreground-muted">
                            Sybil Risk
                          </span>
                          <span className="font-mono text-patience">
                            {ethosScore?.score
                              ? ethosScore.score > 1000
                                ? "Low"
                                : "Medium"
                              : "---"}
                          </span>
                        </div>
                      </div>

                      <div className="flex flex-col gap-2">
                        <Button
                          variant="outline"
                          className="w-full border-border hover:bg-surface text-xs font-mono"
                          onClick={() => {
                            if (ethosProfile) {
                              const profileUrl =
                                ethosClient.getProfileUrl(ethosProfile);
                              window.open(
                                profileUrl,
                                "_blank",
                                "noopener,noreferrer",
                              );
                            } else if (farcasterIdentity?.username) {
                              window.open(
                                `https://app.ethos.network/profile/x/${farcasterIdentity.username}/score`,
                                "_blank",
                                "noopener,noreferrer",
                              );
                            } else if (targetAddress) {
                              window.open(
                                `https://app.ethos.network/profile/${targetAddress}`,
                                "_blank",
                                "noopener,noreferrer",
                              );
                            } else {
                              window.open(
                                "https://app.ethos.network",
                                "_blank",
                                "noopener,noreferrer",
                              );
                            }
                          }}
                        >
                          {ethosScore ? "VIEW ETHOS PROFILE" : "BUILD REPUTATION ON ETHOS →"}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>

                {/* Mantle Agentic Card */}
                {mantle.isMantleMode && (
                  <motion.div
                    variants={{
                      hidden: { opacity: 0, y: 20 },
                      visible: { opacity: 1, y: 0 },
                    }}
                    className="col-span-1 md:col-span-6 lg:col-span-4 h-full"
                  >
                    <MantleConvictionCard
                      thesisHash={thesisHash}
                      subjectHash={subjectHash}
                      subjectLabel={targetAddress ?? "No wallet selected"}
                      convictionScore={convictionMetrics?.score ?? 0}
                      archetype={convictionMetrics?.archetype ?? "Unclassified"}
                    />
                  </motion.div>
                )}

                {/* Mantle Strategy Lens */}
                {mantle.isMantleMode && (
                  <motion.div
                    variants={{
                      hidden: { opacity: 0, y: 20 },
                      visible: { opacity: 1, y: 0 },
                    }}
                    className="col-span-1 md:col-span-6 lg:col-span-4 h-full"
                  >
                    <MantleStrategyLens />
                  </motion.div>
                )}

                {/* Aleo Privacy Card */}
                <motion.div
                  variants={{
                    hidden: { opacity: 0, y: 20 },
                    visible: { opacity: 1, y: 0 },
                  }}
                  className="col-span-1 md:col-span-6 lg:col-span-4 h-full"
                >
                  <AleoConvictionCard />
                </motion.div>

                {/* Reputation Tier Card */}
                <motion.div
                  variants={{
                    hidden: { opacity: 0, y: 20 },
                    visible: { opacity: 1, y: 0 },
                  }}
                  className="col-span-1 md:col-span-6 lg:col-span-4 h-full"
                >
                  <ReputationTierCard
                    currentScore={
                      isShowcaseMode ? 2200 : (ethosScore?.score ?? null)
                    }
                  />
                </motion.div>

                {/* Cohort Comparison */}
                {convictionMetrics && (
                  <motion.div
                    variants={{
                      hidden: { opacity: 0, y: 20 },
                      visible: { opacity: 1, y: 0 },
                    }}
                    className="col-span-1 md:col-span-6 lg:col-span-4 h-full"
                  >
                    <CohortComparison
                      address={targetAddress}
                      chain={analysisChain ?? undefined}
                      userScore={convictionMetrics.score}
                      userPatienceTax={convictionMetrics.patienceTax}
                      userWinRate={convictionMetrics.winRate}
                      ethosScore={
                        isShowcaseMode ? 2200 : (ethosScore?.score ?? null)
                      }
                    />
                  </motion.div>
                )}

                {/* Privacy Cash Private Treasury */}
                <motion.div
                  variants={{
                    hidden: { opacity: 0, y: 20 },
                    visible: { opacity: 1, y: 0 },
                  }}
                  className="col-span-1 md:col-span-6 lg:col-span-4 h-full"
                >
                  <PrivateBalanceCard />
                </motion.div>

                {/* Position Explorer */}
                <motion.div
                  variants={{
                    hidden: { opacity: 0, y: 20 },
                    visible: { opacity: 1, y: 0 },
                  }}
                  className="col-span-1 md:col-span-6 lg:col-span-12"
                >
                  {positionAnalyses.length > 0 && (
                    <PositionExplorer
                      positions={positionAnalyses}
                      chain={analysisChain || "solana"}
                    />
                  )}
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>

      {/* Share Dialog */}
      {convictionMetrics && analysisChain && (
        <ShareDialog
          open={shareDialogOpen}
          onOpenChange={setShareDialogOpen}
          metrics={convictionMetrics}
          chain={analysisChain}
        />
      )}
    </div>
  );
}
