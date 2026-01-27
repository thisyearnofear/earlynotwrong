"use client";

import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { TrendingUp, ExternalLink, Info, Clock, Shield, Zap, Activity } from "lucide-react";
import { motion } from "framer-motion";
import type { UnifiedTrustScore } from "@/lib/services/trust-resolver";
import { FairScaleBadgeGrid } from "./fairscale-badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip";
import type { FairScaleFeatures } from "@/lib/fairscale";

interface FairScaleCardProps {
  trust: UnifiedTrustScore | null;
  className?: string;
}

// Tier colors for FairScale
const FAIRSCALE_TIER_COLORS = {
  diamond: "text-cyan-400",
  platinum: "text-purple-400",
  gold: "text-amber-400",
  silver: "text-gray-400",
  bronze: "text-orange-400",
  unknown: "text-foreground-muted",
};

const FAIRSCALE_TIER_BG = {
  diamond: "bg-cyan-400/10 border-cyan-400/30",
  platinum: "bg-purple-400/10 border-purple-400/30",
  gold: "bg-amber-400/10 border-amber-400/30",
  silver: "bg-gray-400/10 border-gray-400/30",
  bronze: "bg-orange-400/10 border-orange-400/30",
  unknown: "bg-surface/20 border-border/50",
};

/**
 * FairScaleCard
 * Dedicated card for displaying FairScale trust metrics for Solana wallets
 */
export function FairScaleCard({ trust, className }: FairScaleCardProps) {
  const hasFairScaleData = trust?.providers.fairscale;
  const fairScaleData = trust?.providers.fairscale;

  if (!hasFairScaleData) {
    return (
      <Card className={cn("glass-panel border-border/50 bg-surface/40 h-full", className)}>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-mono text-foreground-muted tracking-wider uppercase">
              FairScale
            </CardTitle>
            <TrendingUp className="w-5 h-5 text-signal" />
          </div>
        </CardHeader>
        <CardContent className="flex-1 flex flex-col justify-center">
          <div className="text-center py-10 relative px-4">
            <div className="absolute inset-0 bg-signal/5 blur-3xl rounded-full -z-10" />
            <div className="mx-auto bg-surface/40 rounded-2xl p-4 w-16 h-16 flex items-center justify-center mb-4 border border-border/50 shadow-inner group-hover:scale-110 transition-transform">
              <TrendingUp className="w-8 h-8 text-foreground-muted/50" />
            </div>
            <div className="space-y-2">
              <p className="text-base font-semibold text-foreground tracking-tight">
                {trust?.solanaAddress ? "Solana Wallet Found" : "No FairScale Signal"}
              </p>

              {trust?.solanaAddress ? (
                <div className="space-y-3">
                  <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface/50 border border-border/50 mx-auto">
                    <span className="font-mono text-xs text-signal">
                      {trust.solanaAddress.slice(0, 4)}...{trust.solanaAddress.slice(-4)}
                    </span>
                    <a
                      href={`https://solscan.io/account/${trust.solanaAddress}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-foreground-muted hover:text-foreground transition-colors"
                    >
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                  <p className="text-[10px] text-foreground-muted max-w-[200px] mx-auto">
                    Wallet identified but lacks FairScale history.
                  </p>
                </div>
              ) : (
                <p className="text-xs text-foreground-muted leading-relaxed max-w-[200px] mx-auto">
                  Solana-native trust scoring requires a verified FairScale profile.
                </p>
              )}
            </div>
            {!trust?.solanaAddress && (
              <div className="mt-8 flex justify-center gap-1">
                <div className="w-1.5 h-1.5 rounded-full bg-border" />
                <div className="w-1.5 h-1.5 rounded-full bg-border/50" />
                <div className="w-1.5 h-1.5 rounded-full bg-border/20" />
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!fairScaleData) return null; // This shouldn't happen due to the condition above

  const tierColor = FAIRSCALE_TIER_COLORS[fairScaleData.tier.toLowerCase() as keyof typeof FAIRSCALE_TIER_COLORS] || FAIRSCALE_TIER_COLORS.unknown;
  const tierBg = FAIRSCALE_TIER_BG[fairScaleData.tier.toLowerCase() as keyof typeof FAIRSCALE_TIER_BG] || FAIRSCALE_TIER_BG.unknown;

  return (
    <Card className={cn("glass-panel border-border/50 bg-surface/40 h-full", className)}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-mono text-foreground-muted tracking-wider uppercase flex items-center gap-2">
            FairScale
            <Tooltip>
              <TooltipTrigger>
                <Info className="w-3 h-3 text-foreground-muted hover:text-foreground transition-colors" />
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                <p className="text-xs">
                  FairScale provides trust scoring for Solana wallets based on on-chain activity, trading behavior, and social signals.
                </p>
              </TooltipContent>
            </Tooltip>
          </CardTitle>
          <TrendingUp className="w-5 h-5 text-signal" />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Main Score Display */}
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.4 }}
          className={cn(
            "p-4 rounded-lg border backdrop-blur-sm",
            tierBg
          )}
        >
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs font-mono text-foreground-muted uppercase tracking-wider mb-1">
                FairScore
              </div>
              <div className={cn("text-3xl font-bold", tierColor)}>
                {fairScaleData.fairscore.toFixed(1)}
                <span className="text-lg text-foreground-muted">/10</span>
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs font-mono text-foreground-muted uppercase tracking-wider mb-1">
                Tier
              </div>
              <div className={cn("text-lg font-bold uppercase", tierColor)}>
                {fairScaleData.tier}
              </div>
            </div>
          </div>
        </motion.div>

        {/* Conviction Metrics - surfacing FairScale features that align with ENW thesis */}
        {fairScaleData.features && (
          <div className="space-y-2">
            <div className="text-[10px] font-mono text-foreground-muted uppercase tracking-wider">
              Conviction Metrics
            </div>
            <div className="grid grid-cols-2 gap-2">
              <ConvictionMetric
                icon={<Clock className="w-3 h-3" />}
                label="Hold Time"
                value={`${(fairScaleData.features as FairScaleFeatures).median_hold_days?.toFixed(0) || 0}d`}
                tooltip="Median days held per position"
              />
              <ConvictionMetric
                icon={<Shield className="w-3 h-3" />}
                label="Conviction"
                value={`${((fairScaleData.features as FairScaleFeatures).conviction_ratio * 100)?.toFixed(0) || 0}%`}
                tooltip="Ratio of positions held with conviction"
              />
              <ConvictionMetric
                icon={<Zap className="w-3 h-3" />}
                label="No Dumps"
                value={`${((fairScaleData.features as FairScaleFeatures).no_instant_dumps * 100)?.toFixed(0) || 0}%`}
                tooltip="Percentage avoiding instant dumps"
              />
              <ConvictionMetric
                icon={<Activity className="w-3 h-3" />}
                label="Age"
                value={`${(fairScaleData.features as FairScaleFeatures).wallet_age_days?.toFixed(0) || 0}d`}
                tooltip="Wallet age in days"
              />
            </div>
          </div>
        )}

        {/* Score Breakdown - condensed */}
        <div className="grid grid-cols-2 gap-2">
          <div className="p-2 rounded-lg bg-surface/20 border border-border/50">
            <div className="text-[10px] font-mono text-foreground-muted uppercase tracking-wider">
              Wallet
            </div>
            <div className="text-sm font-bold text-foreground">
              {fairScaleData.walletScore.toFixed(1)}
            </div>
          </div>
          <div className="p-2 rounded-lg bg-surface/20 border border-border/50">
            <div className="text-[10px] font-mono text-foreground-muted uppercase tracking-wider">
              Social
            </div>
            <div className="text-sm font-bold text-foreground">
              {fairScaleData.socialScore.toFixed(1)}
            </div>
          </div>
        </div>

        {/* Badges Section - condensed */}
        {fairScaleData.badges.length > 0 && (
          <div>
            <div className="text-[10px] font-mono text-foreground-muted uppercase tracking-wider mb-1.5">
              Badges ({fairScaleData.badges.length})
            </div>
            <FairScaleBadgeGrid badges={fairScaleData.badges} maxVisible={3} />
          </div>
        )}

        {/* CTA */}
        <button
          onClick={() => window.open('https://fairscale.xyz', '_blank')}
          className="w-full flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg border border-border hover:bg-surface text-[10px] font-mono text-foreground-muted hover:text-foreground transition-colors"
        >
          <ExternalLink className="w-2.5 h-2.5" />
          BUILD REPUTATION
        </button>
      </CardContent>
    </Card>
  );
}

/**
 * ConvictionMetric - compact metric display for FairScale features
 */
function ConvictionMetric({
  icon,
  label,
  value,
  tooltip,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tooltip: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex items-center gap-1.5 p-1.5 rounded bg-surface/30 border border-border/30 cursor-help">
          <span className="text-signal">{icon}</span>
          <div className="min-w-0 flex-1">
            <div className="text-[9px] font-mono text-foreground-muted uppercase truncate">
              {label}
            </div>
            <div className="text-xs font-bold text-foreground">
              {value}
            </div>
          </div>
        </div>
      </TooltipTrigger>
      <TooltipContent>
        <p className="text-xs">{tooltip}</p>
      </TooltipContent>
    </Tooltip>
  );
}