"use client";

import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { TrendingUp, Award, Target, Coins, ExternalLink, Info } from "lucide-react";
import { motion } from "framer-motion";
import type { UnifiedTrustScore } from "@/lib/services/trust-resolver";
import { FairScaleBadgeGrid } from "./fairscale-badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip";

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

        {/* Score Breakdown */}
        <div className="grid grid-cols-2 gap-3">
          <div className="p-3 rounded-lg bg-surface/20 border border-border/50">
            <div className="text-xs font-mono text-foreground-muted uppercase tracking-wider mb-1">
              Wallet Score
            </div>
            <div className="text-lg font-bold text-foreground">
              {fairScaleData.walletScore.toFixed(1)}
            </div>
          </div>
          <div className="p-3 rounded-lg bg-surface/20 border border-border/50">
            <div className="text-xs font-mono text-foreground-muted uppercase tracking-wider mb-1">
              Social Score
            </div>
            <div className="text-lg font-bold text-foreground">
              {fairScaleData.socialScore.toFixed(1)}
            </div>
          </div>
        </div>

        {/* Badges Section */}
        {fairScaleData.badges.length > 0 && (
          <div className="pt-2">
            <div className="text-xs font-mono text-foreground-muted uppercase tracking-wider mb-2 flex items-center gap-2">
              Achievements
              <Tooltip>
                <TooltipTrigger>
                  <Info className="w-2.5 h-2.5 text-foreground-muted hover:text-foreground transition-colors" />
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <p className="text-xs">
                    Badges earned based on on-chain behavior and trading patterns.
                  </p>
                </TooltipContent>
              </Tooltip>
            </div>
            <FairScaleBadgeGrid badges={fairScaleData.badges} maxVisible={4} />
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex flex-col gap-2 pt-2">
          <button
            onClick={() => window.open('https://fairscale.xyz', '_blank')}
            className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-lg border border-border hover:bg-surface text-xs font-mono text-foreground transition-colors"
          >
            <ExternalLink className="w-3 h-3" />
            VIEW FAIRSCALE PROFILE
          </button>
        </div>
      </CardContent>
    </Card>
  );
}