"use client";

import * as React from "react";
import { useAppStore } from "@/lib/store";
import { Lock, Shield, Zap, Users, Crown, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  type FeatureKey,
  FEATURES,
  getFeatureLockMessage,
  getEthosTier,
  getTierInfo,
  getNextTierUnlocks,
} from "@/lib/ethos-gates";

interface EthosGatedContentProps {
  /** Feature key for contextual messaging */
  feature?: FeatureKey;
  /** Fallback: minimum score required (used if no feature key) */
  minScore?: number;
  children: React.ReactNode;
  fallback?: React.ReactNode;
  /** Show blurred preview of content */
  showPreview?: boolean;
  className?: string;
  /** Optional title for custom messaging */
  title?: string;
  /** Optional description for custom messaging */
  description?: string;
}

const TierIcon = ({ icon }: { icon: "shield" | "users" | "zap" | "crown" }) => {
  const iconClass = "w-4 h-4";
  switch (icon) {
    case "crown": return <Crown className={iconClass} />;
    case "zap": return <Zap className={iconClass} />;
    case "users": return <Users className={iconClass} />;
    default: return <Shield className={iconClass} />;
  }
};

export function EthosGatedContent({
  feature,
  minScore,
  children,
  fallback,
  showPreview = false,
  className,
  title,
  description,
}: EthosGatedContentProps) {
  const { ethosScore, isShowcaseMode } = useAppStore();
  
  // In showcase mode, simulate high score for demo
  const currentScore = isShowcaseMode ? 9999 : (ethosScore?.score || 0);
  
  // Determine required score from feature or prop
  const requiredScore = feature ? FEATURES[feature].requiredScore : (minScore || 0);
  const isUnlocked = currentScore >= requiredScore;

  if (isUnlocked) {
    return <>{children}</>;
  }

  if (fallback) {
    return <>{fallback}</>;
  }

  // Get contextual lock info
  const lockInfo = feature
    ? getFeatureLockMessage(feature, currentScore)
    : null;

  const tier = getEthosTier(currentScore);
  const tierInfo = getTierInfo(tier);
  const nextUnlocks = getNextTierUnlocks(currentScore);

  return (
    <div className={cn("relative overflow-hidden rounded-lg border border-border bg-surface/30", className)}>
      {/* Blurred preview */}
      {showPreview && (
        <div className="absolute inset-0 blur-sm opacity-40 pointer-events-none">
          {children}
        </div>
      )}

      {/* Lock overlay */}
      <div className={cn(
        "relative z-10 flex flex-col items-center gap-4 p-8 text-center",
        showPreview && "bg-surface/80 backdrop-blur-sm"
      )}>
        {/* Lock icon with tier color */}
        <div className={cn(
          "flex h-12 w-12 items-center justify-center rounded-full border",
          tierInfo.bgColor,
          tierInfo.borderColor
        )}>
          <Lock className={cn("h-5 w-5", tierInfo.color)} />
        </div>

        {/* Title and description */}
        <div className="space-y-2 max-w-sm">
          <h3 className="font-semibold text-foreground">
            {title || lockInfo?.title || "Feature Locked"}
          </h3>
          <p className="text-sm text-foreground-muted">
            {description || lockInfo?.valueTeaser || lockInfo?.description || "Build your Ethos reputation to unlock this feature."}
          </p>
        </div>

        {/* Score comparison */}
        <div className="flex items-center gap-3 text-xs font-mono bg-surface/50 px-4 py-2 rounded-full border border-border">
          <div className="flex items-center gap-1.5">
            <TierIcon icon={tierInfo.icon} />
            <span className={tierInfo.color}>{currentScore}</span>
          </div>
          <ArrowRight className="w-3 h-3 text-foreground-muted" />
          <div className="flex items-center gap-1.5">
            <span className="text-foreground">{requiredScore}</span>
            <span className="text-foreground-muted">required</span>
          </div>
        </div>

        {/* Points away message */}
        {lockInfo && lockInfo.pointsAway > 0 && (
          <p className="text-xs text-foreground-muted">
            <span className="text-signal font-medium">{lockInfo.pointsAway}</span> points away
            {lockInfo.nextMilestone && lockInfo.nextMilestone.score < requiredScore && (
              <span>
                {" • Next tier: "}
                <span className="text-foreground">{getTierInfo(lockInfo.nextMilestone.tier).name}</span>
                {" at "}{lockInfo.nextMilestone.score}
              </span>
            )}
          </p>
        )}

        {/* Next tier unlocks teaser */}
        {nextUnlocks && nextUnlocks.unlocks.length > 0 && (
          <div className="text-xs text-foreground-muted mt-2">
            <span className="text-foreground-dim">At {nextUnlocks.requiredScore}: </span>
            {nextUnlocks.unlocks.slice(0, 2).map(f => f.name).join(", ")}
            {nextUnlocks.unlocks.length > 2 && ` +${nextUnlocks.unlocks.length - 2} more`}
          </div>
        )}

        {/* CTA */}
        <Button
          variant="outline"
          size="sm"
          className="mt-2"
          onClick={() => window.open("https://ethos.network", "_blank")}
        >
          Build Reputation on Ethos
        </Button>
      </div>
    </div>
  );
}

/**
 * Hook to check feature access
 */
export function useFeatureAccess(feature: FeatureKey): {
  isUnlocked: boolean;
  currentScore: number;
  requiredScore: number;
  pointsAway: number;
} {
  const { ethosScore, isShowcaseMode } = useAppStore();
  const currentScore = isShowcaseMode ? 9999 : (ethosScore?.score || 0);
  const featureInfo = FEATURES[feature];
  
  return {
    isUnlocked: currentScore >= featureInfo.requiredScore,
    currentScore,
    requiredScore: featureInfo.requiredScore,
    pointsAway: Math.max(0, featureInfo.requiredScore - currentScore),
  };
}
