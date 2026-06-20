"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ShieldCheck, Shield, Users, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/lib/store";
import { ethosClient } from "@/lib/ethos";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ReputationTierCard } from "@/components/reputation/reputation-tier-card";
import { CohortComparison } from "@/components/analysis/cohort-comparison";

interface ReputationHubProps {
  isConnected: boolean;
  activeAddress: string | undefined;
  isShowcaseMode: boolean;
  className?: string;
}

type TabId = "reputation" | "tiers" | "cohort";

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: "reputation", label: "Reputation", icon: <ShieldCheck className="w-3 h-3" /> },
  { id: "tiers", label: "Tiers", icon: <Shield className="w-3 h-3" /> },
  { id: "cohort", label: "Cohort", icon: <Users className="w-3 h-3" /> },
];

export function ReputationHub({
  isConnected,
  activeAddress,
  isShowcaseMode,
  className,
}: ReputationHubProps) {
  const [activeTab, setActiveTab] = useState<TabId>("reputation");
  const [collapsed, setCollapsed] = useState(false);

  const {
    ethosScore,
    ethosProfile,
    farcasterIdentity,
    unifiedTrustScore,
    targetAddress,
    convictionMetrics,
    analysisChain,
  } = useAppStore();

  return (
    <Card
      className={cn(
        "glass-panel border-border/50 bg-surface/40 flex flex-col h-full relative overflow-hidden",
        className,
      )}
    >
      {/* Collapse toggle — top-right */}
      <button
        onClick={() => setCollapsed((prev) => !prev)}
        className="absolute top-3 right-3 z-10 p-1 rounded text-foreground-muted hover:text-foreground hover:bg-surface/60 transition-all"
      >
        {collapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
      </button>

      {/* Tab Bar */}
      <div className="flex border-b border-border/50 bg-surface-hover/40">
        {TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 text-[10px] font-mono uppercase tracking-wider transition-all relative",
                isActive
                  ? "text-foreground"
                  : "text-foreground-muted hover:text-foreground/80",
              )}
            >
              {tab.icon}
              {tab.label}
              {isActive && (
                <motion.div
                  layoutId="reputation-hub-active-tab"
                  className="absolute bottom-0 left-2 right-2 h-0.5 bg-signal rounded-full"
                />
              )}
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto min-h-0">
        <AnimatePresence mode="wait">
          {!collapsed && activeTab === "reputation" && (
            <motion.div
              key="reputation"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.15 }}
            >
              {/* Analyzing Other Wallet Indicator */}
              {isConnected &&
                targetAddress &&
                targetAddress !== activeAddress && (
                  <div className="bg-signal/10 border-b border-signal/20 py-1 px-4 flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-signal animate-pulse" />
                    <span className="text-[10px] font-mono text-signal uppercase font-bold tracking-widest">
                      Inspecting Public Profile
                    </span>
                  </div>
                )}

              <CardHeader
                className={cn(
                  isConnected && targetAddress && targetAddress !== activeAddress
                    ? "pt-3"
                    : "pt-4",
                  "pb-1",
                )}
              >
                {/* Farcaster Identity Display */}
                {farcasterIdentity && (
                  <div className="flex items-center gap-3 mb-3 p-3 rounded-lg bg-signal/5 border border-signal/20 max-h-35 overflow-hidden">
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

                <div className="flex items-center justify-between mb-1">
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

              <CardContent className="space-y-3 pt-2 pb-4">
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
              </CardContent>
            </motion.div>
          )}

          {!collapsed && activeTab === "tiers" && (
            <motion.div
              key="tiers"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.15 }}
              className="p-1"
            >
              <ReputationTierCard
                currentScore={
                  isShowcaseMode ? 2200 : (ethosScore?.score ?? null)
                }
              />
            </motion.div>
          )}

          {!collapsed && activeTab === "cohort" && (
            <motion.div
              key="cohort"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.15 }}
              className="p-1"
            >
              {convictionMetrics ? (
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
              ) : (
                <div className="rounded-xl border border-border bg-surface/30 p-5 text-center">
                  <p className="text-xs font-mono text-foreground-muted">
                    Run an analysis first to see cohort comparison data.
                  </p>
                </div>
              )}
            </motion.div>
          )}

          {collapsed && (
            <motion.div
              key="collapsed"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex items-center justify-center py-6 text-[10px] font-mono text-foreground-muted"
            >
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setCollapsed(false)}
                className="text-[10px] font-mono text-foreground-muted hover:text-foreground gap-1"
              >
                <ChevronDown className="w-3 h-3" />
                Expand
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </Card>
  );
}
