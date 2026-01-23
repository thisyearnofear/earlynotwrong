"use client";

import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Shield, TrendingUp, Award, ExternalLink, Info } from "lucide-react";
import { motion } from "framer-motion";
import type { UnifiedTrustScore } from "@/lib/services/trust-resolver";
import { FairScaleBadgeGrid } from "./fairscale-badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip";

interface UnifiedTrustDisplayProps {
  trust: UnifiedTrustScore;
  className?: string;
  variant?: 'full' | 'compact';
}

// Tier colors
const TIER_COLORS = {
  diamond: "text-cyan-400",
  platinum: "text-purple-400",
  gold: "text-amber-400",
  silver: "text-gray-400",
  bronze: "text-orange-400",
  unknown: "text-foreground-muted",
};

const TIER_BG = {
  diamond: "bg-cyan-400/10 border-cyan-400/30",
  platinum: "bg-purple-400/10 border-purple-400/30",
  gold: "bg-amber-400/10 border-amber-400/30",
  silver: "bg-gray-400/10 border-gray-400/30",
  bronze: "bg-orange-400/10 border-orange-400/30",
  unknown: "bg-surface/20 border-border/50",
};

/**
 * Unified Trust Display
 * Shows combined trust score from Ethos (ETH/Base) and FairScale (Solana)
 * with provider-specific details
 */
export function UnifiedTrustDisplay({
  trust,
  className,
  variant = 'full',
}: UnifiedTrustDisplayProps) {
  const tierColor = TIER_COLORS[trust.tier];
  const tierBg = TIER_BG[trust.tier];

  if (variant === 'compact') {
    return (
      <div className={cn("flex items-center gap-3", className)}>
        {/* Score Badge */}
        <div className={cn(
          "flex items-center gap-2 px-4 py-2 rounded-lg border",
          tierBg
        )}>
          <Shield className={cn("w-5 h-5", tierColor)} />
          <div className="flex flex-col">
            <span className="text-xs font-mono text-foreground-muted uppercase tracking-wider">
              Trust Score
            </span>
            <span className={cn("text-xl font-bold", tierColor)}>
              {trust.score}
            </span>
          </div>
        </div>

        {/* Tier Badge */}
        <div className="flex flex-col">
          <span className="text-[10px] font-mono text-foreground-muted uppercase tracking-wider">
            Tier
          </span>
          <span className={cn("text-sm font-bold uppercase", tierColor)}>
            {trust.tier}
          </span>
        </div>

        {/* Provider */}
        <div className="flex flex-col">
          <span className="text-[10px] font-mono text-foreground-muted uppercase tracking-wider">
            Via
          </span>
          <span className="text-sm font-mono text-foreground capitalize">
            {trust.primaryProvider}
          </span>
        </div>
      </div>
    );
  }

  return (
    <Card className={cn("bg-surface/40 border-border/50", className)}>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-signal" />
            <span className="font-mono text-sm uppercase tracking-wider">
              Trust Score
            </span>
          </div>
          <Tooltip>
            <TooltipTrigger>
              <Info className="w-4 h-4 text-foreground-muted hover:text-foreground transition-colors" />
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              <p className="text-xs">
                Unified trust score combining Ethos (ETH/Base) and FairScale (Solana) reputation systems.
                Normalized to 0-100 scale for cross-chain consistency.
              </p>
            </TooltipContent>
          </Tooltip>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Main Score Display */}
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.4 }}
          className={cn(
            "p-6 rounded-xl border backdrop-blur-sm",
            tierBg
          )}
        >
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-mono text-foreground-muted uppercase tracking-wider mb-1">
                Unified Score
              </div>
              <div className={cn("text-5xl font-bold", tierColor)}>
                {trust.score}
                <span className="text-2xl text-foreground-muted">/100</span>
              </div>
            </div>
            <div className="text-right">
              <div className="text-sm font-mono text-foreground-muted uppercase tracking-wider mb-1">
                Tier
              </div>
              <div className={cn("text-2xl font-bold uppercase", tierColor)}>
                {trust.tier}
              </div>
              <div className="text-xs font-mono text-foreground-muted capitalize mt-1">
                {trust.credibilityLevel}
              </div>
            </div>
          </div>
        </motion.div>

        {/* Provider Breakdown */}
        <div className="space-y-3">
          <div className="text-xs font-mono text-foreground-muted uppercase tracking-wider">
            Provider Breakdown
          </div>

          {/* Ethos */}
          {trust.providers.ethos && (
            <div className="p-3 rounded-lg bg-ethos/10 border border-ethos/20">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Shield className="w-4 h-4 text-ethos" />
                  <span className="text-sm font-mono font-semibold text-foreground">
                    Ethos Network
                  </span>
                </div>
                <button
                  onClick={() => window.open('https://ethos.network', '_blank')}
                  className="text-ethos hover:text-ethos/80 transition-colors"
                >
                  <ExternalLink className="w-3 h-3" />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                <div>
                  <span className="text-foreground-muted">Raw Score:</span>
                  <span className="text-foreground ml-1">{trust.providers.ethos.rawScore}</span>
                </div>
                <div>
                  <span className="text-foreground-muted">Normalized:</span>
                  <span className="text-foreground ml-1">{trust.providers.ethos.normalizedScore}/100</span>
                </div>
                <div className="col-span-2">
                  <span className="text-foreground-muted">Tier:</span>
                  <span className="text-foreground ml-1 capitalize">{trust.providers.ethos.tier}</span>
                </div>
              </div>
            </div>
          )}

          {/* FairScale */}
          {trust.providers.fairscale && (
            <div className="p-3 rounded-lg bg-signal/10 border border-signal/20">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-signal" />
                  <span className="text-sm font-mono font-semibold text-foreground">
                    FairScale
                  </span>
                </div>
                <button
                  onClick={() => window.open('https://fairscale.xyz', '_blank')}
                  className="text-signal hover:text-signal/80 transition-colors"
                >
                  <ExternalLink className="w-3 h-3" />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs font-mono mb-3">
                <div>
                  <span className="text-foreground-muted">FairScore:</span>
                  <span className="text-foreground ml-1">{trust.providers.fairscale.fairscore.toFixed(1)}</span>
                </div>
                <div>
                  <span className="text-foreground-muted">Tier:</span>
                  <span className="text-foreground ml-1 capitalize">{trust.providers.fairscale.tier}</span>
                </div>
                <div>
                  <span className="text-foreground-muted">Wallet:</span>
                  <span className="text-foreground ml-1">{trust.providers.fairscale.walletScore.toFixed(1)}</span>
                </div>
                <div>
                  <span className="text-foreground-muted">Social:</span>
                  <span className="text-foreground ml-1">{trust.providers.fairscale.socialScore.toFixed(1)}</span>
                </div>
              </div>
              
              {/* Badges */}
              {trust.providers.fairscale.badges.length > 0 && (
                <div>
                  <div className="text-[10px] font-mono text-foreground-muted uppercase tracking-wider mb-2">
                    Badges Earned
                  </div>
                  <FairScaleBadgeGrid badges={trust.providers.fairscale.badges} maxVisible={4} />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Feature Access */}
        <div className="p-3 rounded-lg bg-surface/20 border border-border/50">
          <div className="text-xs font-mono text-foreground-muted uppercase tracking-wider mb-2">
            Feature Access
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs font-mono">
            {Object.entries(trust.features).map(([key, unlocked]) => (
              <div key={key} className="flex items-center gap-2">
                <div className={cn(
                  "w-2 h-2 rounded-full",
                  unlocked ? "bg-patience" : "bg-foreground-muted/30"
                )} />
                <span className={unlocked ? "text-foreground" : "text-foreground-muted"}>
                  {key.replace('canAccess', '')}
                </span>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
