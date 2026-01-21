"use client";

import { useState } from "react";
import { Navbar } from "@/components/layout/navbar";
import { Button } from "@/components/ui/button";
import { useConviction } from "@/hooks/use-conviction";
import { useAppStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { SHOWCASE_WALLETS } from "@/lib/showcase-data";
import { Terminal } from "@/components/ui/terminal";
import { TunnelBackground } from "@/components/ui/tunnel-background";
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
  ShieldCheck,
  Clock,
  AlertTriangle,
  Settings,
  Share2,
  Lock,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { ConvictionBadge } from "@/components/ui/conviction-badge";
import { ScoreBreakdownDialog } from "@/components/ui/score-breakdown";
import { ethosClient } from "@/lib/ethos";
import { AttestationDialog } from "@/components/ui/attestation-dialog";
import { PositionExplorer } from "@/components/ui/position-explorer";
import { ShareDialog } from "@/components/ui/share-dialog";
import { HistoryPanel } from "@/components/ui/history-panel";
import { ErrorPanel } from "@/components/ui/error-panel";
import { AlphaDiscovery } from "@/components/ui/alpha-discovery";
import { TokenHeatmap } from "@/components/ui/token-heatmap";
import { ReputationPerks } from "@/components/ui/reputation-perks";
import { ConvictionAlerts } from "@/components/ui/conviction-alerts";
import { CohortAnalysis } from "@/components/ui/cohort-analysis";
import { BehavioralInsights } from "@/components/ui/behavioral-insights";
import { DataQualityBadge } from "@/components/ui/data-quality-badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
} from "@/components/ui/dialog";

export default function Home() {
  const { analyzeWallet, loadCachedAnalysis, isAnalyzing, isConnected, isShowcaseMode, activeAddress } =
    useConviction();
  const {
    ethosScore,
    ethosProfile,
    farcasterIdentity,
    convictionMetrics,
    positionAnalyses,
    analysisChain,
    dataQuality,
    logs,
    parameters,
    setParameters,
    showAttestationDialog,
    reset,
    errorState,
    clearError,
  } = useAppStore();

  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const hasScanned = !isAnalyzing && logs.length > 0;

  const formatCurrency = (val: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(val);

  return (
    <div className="min-h-screen text-foreground selection:bg-signal/20 overflow-x-hidden relative">
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
            {isAnalyzing ? "SYSTEM ANALYZING..." : "CONVICTION ANALYZER V1.0"}
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

          {/* Action Buttons - Hide during analysis or result view to save space/focus */}
          <AnimatePresence>
            {!isAnalyzing && !hasScanned && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="flex flex-col items-center gap-8 pt-4 w-full"
              >
                <div className="flex flex-col items-center gap-8 pt-4">
                  <div className="flex flex-col sm:flex-row items-center gap-4">
                    <Dialog>
                      <DialogTrigger asChild>
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-12 w-12 rounded-full border-border/50 hover:border-signal/50"
                        >
                          <Settings className="w-5 h-5" />
                        </Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>Analysis Parameters</DialogTitle>
                          <DialogDescription>
                            Fine-tune the behavioral heuristics for your conviction audit.
                          </DialogDescription>
                        </DialogHeader>
                        <div className="space-y-6 py-4">
                          <div className="space-y-3">
                            <label className="text-xs font-mono uppercase text-foreground-muted flex justify-between">
                              Time Horizon <span>{parameters.timeHorizon} Days</span>
                            </label>
                            <input
                              type="range"
                              min="30"
                              max="365"
                              step="30"
                              value={parameters.timeHorizon}
                              onChange={(e) =>
                                setParameters({
                                  timeHorizon: parseInt(e.target.value) as 30 | 90 | 180 | 365,
                                })
                              }
                              className="w-full h-1 bg-surface rounded-lg appearance-none cursor-pointer accent-signal"
                            />
                          </div>
                          <div className="space-y-3">
                            <label className="text-xs font-mono uppercase text-foreground-muted flex justify-between">
                              Min. Trade Value <span>${parameters.minTradeValue}</span>
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

                    <Button
                      size="lg"
                      className="h-12 px-8 text-base rounded-full"
                      onClick={() => analyzeWallet()}
                      disabled={isAnalyzing}
                    >
                      {isConnected ? "Start Deep Scan" : "Connect to Scan"}
                      <ArrowRight className="ml-2 w-4 h-4" />
                    </Button>
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

                  <div className="flex flex-col items-center gap-4">
                    <p className="text-[10px] font-mono text-foreground-muted uppercase tracking-widest">
                      Or analyze a public profile
                    </p>
                    <div className="flex flex-wrap justify-center gap-3">
                      {SHOWCASE_WALLETS.map((wallet) => (
                        <Button
                          key={wallet.id}
                          variant="outline"
                          className="border-border/50 hover:border-signal/50 hover:bg-surface-hover font-mono text-xs"
                          onClick={() => analyzeWallet(wallet.id)}
                        >
                          {wallet.name}
                        </Button>
                      ))}
                    </div>
                  </div>
                </div>
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
                className="w-full max-w-2xl mx-auto"
              >
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
                      analyzeWallet(isShowcaseMode ? SHOWCASE_WALLETS[0]?.id : undefined);
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
                          SIMULATION MODE
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
                                    symbolRate={dataQuality.dataCompleteness.symbolRate}
                                    priceRate={dataQuality.dataCompleteness.priceRate}
                                    avgTradeSize={dataQuality.avgTradeSize}
                                  />
                                )}
                              </div>
                              <CardDescription>
                                Behavioral score based on last {parameters.timeHorizon}d.
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
                                variant="ghost"
                                size="sm"
                                className="font-mono text-[10px] text-signal hover:bg-signal/10 h-7"
                                onClick={() => setShareDialogOpen(true)}
                              >
                                <Share2 className="w-3.5 h-3.5 mr-1.5" />
                                SHARE
                              </Button>
                            </div>
                          </div>
                        </CardHeader>
                        <CardContent className="flex flex-col xl:flex-row items-center xl:items-end justify-between gap-8 pt-4">
                          <div className="flex flex-col md:flex-row items-center md:items-end gap-6 md:gap-10">
                            <div className="space-y-2">
                              <div className="text-7xl md:text-8xl lg:text-9xl font-bold text-foreground tracking-tighter text-glow">
                                {convictionMetrics.score}
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
                            {/* Metrics Bars */}
                            <div className="space-y-1">
                              <div className="flex justify-between text-xs uppercase text-foreground-muted font-mono">
                                <span>Patience Tax</span>
                                <span className="text-foreground">
                                  -$
                                  {formatCurrency(
                                    convictionMetrics.patienceTax,
                                  )}
                                </span>
                              </div>
                              <div className="h-1 w-full bg-surface rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-impatience"
                                  style={{
                                    width: `${Math.min((convictionMetrics.patienceTax / 10000) * 100, 100)}%`,
                                  }}
                                />
                              </div>
                            </div>
                            <div className="space-y-1">
                              <div className="flex justify-between text-xs uppercase text-foreground-muted font-mono">
                                <span>Upside Capture</span>
                                <span className="text-foreground">
                                  {convictionMetrics.upsideCapture}%
                                </span>
                              </div>
                              <div className="h-1 w-full bg-surface rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-patience"
                                  style={{
                                    width: `${convictionMetrics.upsideCapture}%`,
                                  }}
                                />
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
                  <Card className="glass-panel border-border/50 bg-surface/40 flex flex-col justify-between h-full">
                    <CardHeader>
                      <div className="flex items-center justify-between mb-2">
                        <CardTitle className="text-sm font-mono text-foreground-muted tracking-wider uppercase">
                          Reputation
                        </CardTitle>
                        <ShieldCheck className="w-5 h-5 text-ethos" />
                      </div>

                      {/* Farcaster Identity Display - Hero */}
                      {farcasterIdentity && (
                        <div className="flex items-center gap-3 mb-4 p-3 rounded-lg bg-signal/5 border border-signal/20 max-h-[140px] overflow-hidden">
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
                                className="w-12 h-12 rounded-full ring-2 ring-signal/30 hover:ring-signal/50 transition-all"
                              />
                            </a>
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="text-base font-semibold text-foreground truncate">
                              {farcasterIdentity.displayName || farcasterIdentity.username}
                            </div>
                            <div className="text-sm text-foreground-muted truncate">
                              @{farcasterIdentity.username}
                            </div>
                            {farcasterIdentity.bio && (
                              <div className="text-xs text-foreground-muted mt-1 line-clamp-2">
                                {farcasterIdentity.bio}
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      <div className="text-3xl font-bold text-foreground">
                        {ethosScore ? "Verified" : farcasterIdentity ? "Farcaster Verified" : "Unknown"}
                      </div>
                      <CardDescription className="text-xs">
                        {ethosScore
                          ? "Verified via Ethos Network"
                          : "No reputation signal found"}
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="p-4 rounded-lg bg-surface/50 border border-border space-y-3">
                        <div className="flex justify-between items-center text-sm">
                          <span className="text-foreground-muted">
                            Credibility
                          </span>
                          <span className="font-mono text-foreground">
                            {ethosScore?.score ?? "---"}
                          </span>
                        </div>
                        <div className="flex justify-between items-center text-sm">
                          <span className="text-foreground-muted">
                            Tier
                          </span>
                          <span className={cn(
                            "font-mono text-xs px-2 py-1 rounded",
                            (ethosScore?.score ?? 0) >= 2000 ? "bg-patience/20 text-patience" :
                              (ethosScore?.score ?? 0) >= 1000 ? "bg-signal/20 text-signal" :
                                (ethosScore?.score ?? 0) >= 500 ? "bg-foreground/20 text-foreground" :
                                  (ethosScore?.score ?? 0) >= 100 ? "bg-foreground-muted/20 text-foreground-muted" :
                                    "bg-surface text-foreground-muted"
                          )}>
                            {(ethosScore?.score ?? 0) >= 2000 ? "Elite" :
                              (ethosScore?.score ?? 0) >= 1000 ? "High" :
                                (ethosScore?.score ?? 0) >= 500 ? "Medium" :
                                  (ethosScore?.score ?? 0) >= 100 ? "Low" : "Unknown"}
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
                      <Button
                        variant="outline"
                        className="w-full mt-4 border-border hover:bg-surface text-xs font-mono"
                        disabled={!ethosProfile?.username && !farcasterIdentity?.username}
                        onClick={() => {
                          // Try to open Ethos profile - multiple fallback strategies
                          if (ethosProfile) {
                            const profileUrl = ethosClient.getProfileUrl(ethosProfile);
                            window.open(profileUrl, "_blank", "noopener,noreferrer");
                          } else if (farcasterIdentity?.username) {
                            // Fallback: Try to find profile via X.com username
                            window.open(`https://app.ethos.network/profile/x/${farcasterIdentity.username}/score`, "_blank", "noopener,noreferrer");
                          } else if (activeAddress) {
                            // Last resort: Try address lookup
                            window.open(`https://app.ethos.network/profile/${activeAddress}`, "_blank", "noopener,noreferrer");
                          }
                        }}
                      >
                        VIEW ETHOS PROFILE
                      </Button>
                    </CardContent>
                  </Card>
                </motion.div>

                {/* Behavioral Insights (Only show if we have data) */}
                {convictionMetrics && (
                  <motion.div
                    variants={{
                      hidden: { opacity: 0, y: 20 },
                      visible: { opacity: 1, y: 0 },
                    }}
                    className="col-span-1 md:col-span-6 lg:col-span-8"
                  >
                    <BehavioralInsights
                      metrics={convictionMetrics}
                      positionCount={positionAnalyses.length}
                    />
                  </motion.div>
                )}

                {/* Position Explorer - HERO SECTION */}
                {positionAnalyses.length > 0 && analysisChain && (
                  <motion.div
                    variants={{
                      hidden: { opacity: 0, y: 20 },
                      visible: { opacity: 1, y: 0 },
                    }}
                    className="col-span-1 md:col-span-6 lg:col-span-12"
                  >
                    <Card className="glass-panel border-border/50 bg-surface/40">
                      <CardHeader>
                        <CardTitle className="text-sm font-mono text-foreground-muted tracking-wider uppercase flex items-center gap-2">
                          <Activity className="w-4 h-4" />
                          Position Breakdown
                        </CardTitle>
                        <CardDescription>
                          Drill into individual trades to see entry/exit timing and counterfactual analysis.
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <PositionExplorer
                          positions={positionAnalyses}
                          chain={analysisChain}
                        />
                      </CardContent>
                    </Card>
                  </motion.div>
                )}

                {/* Historical Tracking Panel - Hide for showcase mode */}
                {!isShowcaseMode && (
                  <motion.div
                    variants={{
                      hidden: { opacity: 0, y: 20 },
                      visible: { opacity: 1, y: 0 },
                    }}
                    className="col-span-1 md:col-span-6 lg:col-span-4"
                  >
                    <Card className="glass-panel border-border/50 bg-surface/40">
                      <CardHeader>
                        <CardTitle className="text-sm font-mono text-foreground-muted tracking-wider uppercase flex items-center gap-2">
                          <Clock className="w-4 h-4" />
                          Historical Tracking
                        </CardTitle>
                        <CardDescription>
                          Your conviction score evolution over time
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <HistoryPanel
                          currentAddress={activeAddress}
                        />
                      </CardContent>
                    </Card>
                  </motion.div>
                )}

                {/* Reputation Perks Panel - Always show for progression visibility */}
                <motion.div
                  variants={{
                    hidden: { opacity: 0, y: 20 },
                    visible: { opacity: 1, y: 0 },
                  }}
                  className="col-span-1 md:col-span-6 lg:col-span-12"
                >
                  <ReputationPerks />
                </motion.div>

                {/* Locked Features Message for users below Ethos 1000 */}
                {!isShowcaseMode && isConnected && (ethosScore?.score ?? 0) < 1000 && (
                  <motion.div
                    variants={{
                      hidden: { opacity: 0, y: 20 },
                      visible: { opacity: 1, y: 0 },
                    }}
                    className="col-span-1 md:col-span-6 lg:col-span-12"
                  >
                    <Card className="glass-panel border-border/50 bg-surface/40 border-signal/20">
                      <CardContent className="p-8 text-center">
                        <div className="space-y-4">
                          <Lock className="w-12 h-12 text-signal mx-auto" />
                          <div>
                            <h3 className="text-xl font-bold text-foreground mb-2">
                              Advanced Features Locked
                            </h3>
                            <p className="text-foreground-muted max-w-2xl mx-auto">
                              Alpha Discovery, Token Heatmap, Conviction Alerts, and Cohort Analysis require an Ethos score of 1000+.
                              {ethosScore?.score ? (
                                <span className="block mt-2 text-signal font-mono">
                                  Your score: {ethosScore.score} / 1000 ({Math.round((ethosScore.score / 1000) * 100)}% unlocked)
                                </span>
                              ) : (
                                <span className="block mt-2 text-signal">
                                  Connect your wallet to check your Ethos score
                                </span>
                              )}
                            </p>
                          </div>
                          <Button
                            variant="outline"
                            className="border-signal/50 text-signal hover:bg-signal/10"
                            onClick={() => window.open('https://ethos.network', '_blank', 'noopener,noreferrer')}
                          >
                            Build Reputation on Ethos →
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  </motion.div>
                )}

                {/* Advanced Features - Gated for connected wallets with Ethos > 1000 */}
                {!isShowcaseMode && isConnected && (ethosScore?.score ?? 0) >= 1000 && (
                  <>
                    {/* Alpha Discovery Panel */}
                    <motion.div
                      variants={{
                        hidden: { opacity: 0, y: 20 },
                        visible: { opacity: 1, y: 0 },
                      }}
                      className="col-span-1 md:col-span-6 lg:col-span-8"
                    >
                      <AlphaDiscovery />
                    </motion.div>

                    {/* Token Conviction Heatmap */}
                    <motion.div
                      variants={{
                        hidden: { opacity: 0, y: 20 },
                        visible: { opacity: 1, y: 0 },
                      }}
                      className="col-span-1 md:col-span-6 lg:col-span-4"
                    >
                      <TokenHeatmap />
                    </motion.div>

                    {/* Real-Time Alerts Panel */}
                    <motion.div
                      variants={{
                        hidden: { opacity: 0, y: 20 },
                        visible: { opacity: 1, y: 0 },
                      }}
                      className="col-span-1 md:col-span-6 lg:col-span-6"
                    >
                      <ConvictionAlerts />
                    </motion.div>

                    {/* Cohort Analysis Panel */}
                    <motion.div
                      variants={{
                        hidden: { opacity: 0, y: 20 },
                        visible: { opacity: 1, y: 0 },
                      }}
                      className="col-span-1 md:col-span-6 lg:col-span-6"
                    >
                      <CohortAnalysis />
                    </motion.div>
                  </>
                )}

              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>

      {/* Attestation Dialog */}
      <AttestationDialog />

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
