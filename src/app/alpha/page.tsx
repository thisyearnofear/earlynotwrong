"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAccount } from "wagmi";
import { Navbar } from "@/components/layout/navbar";
import { TierGate } from "@/components/reputation/tier-gate";
import { AlphaTraderCard } from "@/components/alpha/alpha-trader-card";
import { TokenHeatmap } from "@/components/alpha/token-heatmap";
import { useAlphaData } from "@/hooks/use-alpha-data";
import { useAppStore } from "@/lib/store";
import { ALPHA_GATE_SCORE } from "@/lib/alpha/constants";
import {
  SHOWCASE_ALPHA_TRADERS,
  SHOWCASE_TOKEN_HEATMAP,
} from "@/lib/alpha/showcase";
import {
  Zap,
  Flame,
  TrendingUp,
  Users,
  Loader2,
  Database,
} from "lucide-react";
import { cn } from "@/lib/utils";

type AlphaTab = "traders" | "tokens";
type ChainFilter = "all" | "solana" | "base";

export default function AlphaPage() {
  const { address: evmAddress } = useAccount();
  const { isShowcaseMode } = useAppStore();
  const [tab, setTab] = useState<AlphaTab>("traders");
  const [chain, setChain] = useState<ChainFilter>("all");

  const effectiveAddress = isShowcaseMode
    ? "0x32DA784C5A5813bAB4D52e84840869c273E15E28"
    : (evmAddress ?? null);
  const effectiveChain = chain === "all" ? undefined : chain;

  const data = useAlphaData({
    address: effectiveAddress,
    chain: effectiveChain,
  });

  // When gated or DB-empty, fall back to showcase data for the preview layer.
  const showShowcase =
    isShowcaseMode ||
    data.isGated ||
    (data.traders.length === 0 && data.tokens.length === 0);

  const displayTraders =
    data.traders.length > 0 ? data.traders : SHOWCASE_ALPHA_TRADERS;
  const displayTokens =
    data.tokens.length > 0 ? data.tokens : SHOWCASE_TOKEN_HEATMAP;

  const tabs: { key: AlphaTab; label: string; icon: typeof Zap }[] = [
    { key: "traders", label: "High-Conviction Traders", icon: TrendingUp },
    { key: "tokens", label: "Token Conviction Heatmap", icon: Flame },
  ];

  const chainFilters: { key: ChainFilter; label: string }[] = [
    { key: "all", label: "All Chains" },
    { key: "solana", label: "Solana" },
    { key: "base", label: "Base" },
  ];

  return (
    <main className="min-h-screen bg-background text-foreground">
      <Navbar />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-24 pb-20">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="mb-8"
        >
          <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-signal mb-2">
            <Zap className="w-3 h-3" />
            Alpha Discovery
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold text-foreground tracking-tight">
            Reputation-Weighted Alpha
          </h1>
          <p className="mt-2 text-sm text-foreground-muted max-w-2xl">
            High-conviction wallets and the tokens they hold — ranked by
            conviction score weighted by Ethos credibility. Sybil-resistant
            signal, not speculation.
          </p>
        </motion.div>

        {/* Gate check */}
        {data.isGated && !isShowcaseMode && (
          <div className="mb-8">
            <TierGate
              requiredScore={ALPHA_GATE_SCORE}
              currentScore={data.gate?.score ?? null}
              feature="Alpha Discovery"
              description="Reputation-weighted trader list and token heatmap. Analyze a wallet to build your Ethos score and unlock this feature."
              preview={
                <div className="space-y-2">
                  {SHOWCASE_ALPHA_TRADERS.slice(0, 3).map((t) => (
                    <div
                      key={t.address}
                      className="flex items-center justify-between p-3 rounded-lg bg-surface border border-border"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold">
                          {t.displayName ?? t.address.slice(0, 8)}
                        </span>
                      </div>
                      <span className="text-sm font-mono text-signal">
                        {t.weightedScore}
                      </span>
                    </div>
                  ))}
                </div>
              }
            />
          </div>
        )}

        {/* Tabs + chain filter */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
          <div className="flex gap-1 p-1 rounded-lg bg-surface/40 border border-border w-fit">
            {tabs.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={cn(
                  "px-4 py-2 text-xs font-mono uppercase tracking-wider rounded-md flex items-center gap-2 transition-colors",
                  tab === key
                    ? "bg-foreground text-background"
                    : "text-foreground-muted hover:text-foreground",
                )}
              >
                <Icon className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{label}</span>
                <span className="sm:hidden">
                  {key === "traders" ? "Traders" : "Tokens"}
                </span>
              </button>
            ))}
          </div>

          {!data.isGated && (
            <div className="flex gap-1 p-1 rounded-lg bg-surface/40 border border-border w-fit">
              {chainFilters.map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setChain(key)}
                  className={cn(
                    "px-3 py-1.5 text-[10px] font-mono uppercase tracking-wider rounded-md transition-colors",
                    chain === key
                      ? "bg-foreground text-background"
                      : "text-foreground-muted hover:text-foreground",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Loading */}
        {data.isLoading && !data.isGated && (
          <div className="flex items-center justify-center py-16 text-foreground-muted">
            <Loader2 className="w-5 h-5 animate-spin mr-2" />
            <span className="text-sm font-mono">Scanning conviction ledger…</span>
          </div>
        )}

        {/* Content */}
        {!data.isLoading && (
          <AnimatePresence mode="wait">
            {tab === "traders" ? (
              <motion.div
                key={`traders-${chain}`}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.2 }}
              >
                {/* Stat strip */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
                  <StatStrip
                    icon={<Users className="w-3.5 h-3.5" />}
                    label="Traders"
                    value={displayTraders.length}
                  />
                  <StatStrip
                    icon={<TrendingUp className="w-3.5 h-3.5" />}
                    label="Avg Conviction"
                    value={Math.round(
                      displayTraders.reduce((a, t) => a + t.convictionScore, 0) /
                        Math.max(1, displayTraders.length),
                    )}
                  />
                  <StatStrip
                    icon={<Zap className="w-3.5 h-3.5" />}
                    label="Top Weighted"
                    value={
                      displayTraders[0]?.weightedScore ?? 0
                    }
                  />
                  <StatStrip
                    icon={<Database className="w-3.5 h-3.5" />}
                    label="Source"
                    value={showShowcase ? "Showcase" : "Live"}
                  />
                </div>

                {/* List */}
                <div className="space-y-2">
                  {displayTraders.map((trader, i) => (
                    <AlphaTraderCard
                      key={`${trader.address}-${trader.chain}`}
                      trader={trader}
                      rank={i + 1}
                    />
                  ))}
                </div>
              </motion.div>
            ) : (
              <motion.div
                key={`tokens-${chain}`}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.2 }}
              >
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
                  <StatStrip
                    icon={<Flame className="w-3.5 h-3.5" />}
                    label="Tokens"
                    value={displayTokens.length}
                  />
                  <StatStrip
                    icon={<Users className="w-3.5 h-3.5" />}
                    label="Unique Holders"
                    value={displayTokens.reduce(
                      (a, t) => a + t.holderCount,
                      0,
                    )}
                  />
                  <StatStrip
                    icon={<TrendingUp className="w-3.5 h-3.5" />}
                    label="Top Intensity"
                    value={
                      displayTokens[0]?.convictionIntensity ?? 0
                    }
                  />
                  <StatStrip
                    icon={<Database className="w-3.5 h-3.5" />}
                    label="Source"
                    value={showShowcase ? "Showcase" : "Live"}
                  />
                </div>

                <TokenHeatmap tokens={displayTokens} />
              </motion.div>
            )}
          </AnimatePresence>
        )}

        {/* Empty state (non-gated, non-loading, no data, no showcase) */}
        {!data.isLoading &&
          !data.isGated &&
          displayTraders.length === 0 &&
          displayTokens.length === 0 &&
          !showShowcase && (
            <div className="text-center py-16 text-foreground-muted">
              <Database className="w-10 h-10 mx-auto mb-3 opacity-40" />
              <p className="text-sm font-mono">
                No alpha data yet. Scan a wallet to start populating the
                conviction ledger.
              </p>
            </div>
          )}
      </div>
    </main>
  );
}

function StatStrip({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface/30 px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-foreground-muted">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-lg font-bold tabular-nums text-foreground">
        {value}
      </div>
    </div>
  );
}
