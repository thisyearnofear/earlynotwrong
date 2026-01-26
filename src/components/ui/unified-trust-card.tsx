"use client";

import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Shield, TrendingUp, Award, ExternalLink, Info } from "lucide-react";
import { motion } from "framer-motion";
import type { UnifiedTrustScore } from "@/lib/services/trust-resolver";
import { FairScaleBadgeGrid } from "./fairscale-badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip";

interface UnifiedTrustCardProps {
  trust: UnifiedTrustScore | null;
  className?: string;
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
 * UnifiedTrustCard
 * Shows combined trust score from Ethos (ETH/Base) and FairScale (Solana)
 * with provider-specific details
 */
export function UnifiedTrustCard({ trust, className }: UnifiedTrustCardProps) {
  if (!trust || trust.score <= 0) {
    return (
      <Card className={cn("glass-panel border-border/50 bg-surface/40 h-full", className)}>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-mono text-foreground-muted tracking-wider uppercase flex items-center gap-2">
              Unified Trust
              <Tooltip>
                <TooltipTrigger>
                  <Info className="w-3 h-3 text-foreground-muted hover:text-foreground transition-colors" />
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <p className="text-xs">
                    Combined trust score from Ethos (EVM) and FairScale (Solana) reputation systems.
                  </p>
                </TooltipContent>
              </Tooltip>
            </CardTitle>
            <Shield className="w-5 h-5 text-signal" />
          </div>
        </CardHeader>
        <CardContent className="flex-1 flex flex-col justify-center">
          <div className="text-center py-10 relative">
            <div className="absolute inset-0 bg-signal/5 blur-3xl rounded-full -z-10" />
            <div className="mx-auto bg-surface/40 rounded-2xl p-4 w-16 h-16 flex items-center justify-center mb-4 border border-border/50 shadow-inner group-hover:scale-110 transition-transform">
              <Shield className="w-8 h-8 text-foreground-muted/50" />
            </div>
            <div className="space-y-2">
              <p className="text-base font-semibold text-foreground tracking-tight">
                Trust Signal Missing
              </p>
              <p className="text-xs text-foreground-muted leading-relaxed max-w-[200px] mx-auto">
                Reputation data from Ethos and FairScale will appear here once identified.
              </p>
            </div>
            <div className="mt-8 flex justify-center gap-1">
              <div className="w-1.5 h-1.5 rounded-full bg-border" />
              <div className="w-1.5 h-1.5 rounded-full bg-border/50" />
              <div className="w-1.5 h-1.5 rounded-full bg-border/20" />
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const tierColor = TIER_COLORS[trust.tier];
  const tierBg = TIER_BG[trust.tier];

  return (
    <Card className={cn("glass-panel border-border/50 bg-surface/40 h-full", className)}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-mono text-foreground-muted tracking-wider uppercase flex items-center gap-2">
            Unified Trust
            <Tooltip>
              <TooltipTrigger>
                <Info className="w-3 h-3 text-foreground-muted hover:text-foreground transition-colors" />
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                <p className="text-xs">
                  Combined trust score from Ethos (EVM) and FairScale (Solana) reputation systems.
                  Normalized to 0-100 scale for cross-chain consistency.
                </p>
              </TooltipContent>
            </Tooltip>
          </CardTitle>
          <Shield className="w-5 h-5 text-signal" />
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
                Unified Score
              </div>
              <div className={cn("text-3xl font-bold", tierColor)}>
                {trust.score}
                <span className="text-lg text-foreground-muted">/100</span>
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs font-mono text-foreground-muted uppercase tracking-wider mb-1">
                Tier
              </div>
              <div className={cn("text-lg font-bold uppercase", tierColor)}>
                {trust.tier}
              </div>
              <div className="text-[10px] font-mono text-foreground-muted capitalize mt-1">
                {trust.credibilityLevel}
              </div>
            </div>
          </div>
        </motion.div>

        {/* Provider Indicators */}
        <div className="grid grid-cols-2 gap-3">
          <div className={cn(
            "p-3 rounded-lg border flex items-center gap-2",
            trust.providers.ethos ? "bg-ethos/10 border-ethos/20" : "bg-surface/20 border-border/50"
          )}>
            <Shield className={cn("w-4 h-4", trust.providers.ethos ? "text-ethos" : "text-foreground-muted")} />
            <div>
              <div className="text-xs font-mono text-foreground-muted uppercase tracking-wider">
                Ethos
              </div>
              <div className="text-sm font-bold">
                {trust.providers.ethos ? `${trust.providers.ethos.normalizedScore}/100` : "N/A"}
              </div>
            </div>
          </div>
          <div className={cn(
            "p-3 rounded-lg border flex items-center gap-2",
            trust.providers.fairscale ? "bg-signal/10 border-signal/20" : "bg-surface/20 border-border/50"
          )}>
            <TrendingUp className={cn("w-4 h-4", trust.providers.fairscale ? "text-signal" : "text-foreground-muted")} />
            <div>
              <div className="text-xs font-mono text-foreground-muted uppercase tracking-wider">
                FairScale
              </div>
              <div className="text-sm font-bold">
                {trust.providers.fairscale ? `${trust.providers.fairscale.fairscore.toFixed(1)}/10` : "N/A"}
              </div>
            </div>
          </div>
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

        {/* Primary Provider */}
        <div className="text-center pt-2">
          <div className="text-xs font-mono text-foreground-muted uppercase tracking-wider">
            Powered by {trust.primaryProvider}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}