"use client";

import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAppStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import {
  Crown,
  Zap,
  Users,
  Shield,
  ExternalLink,
  ChevronRight,
  Star,
  Check,
  Lock,
} from "lucide-react";
import {
  getEthosTier,
  getTierInfo,
  getFeatureAccess,
  getNextTierUnlocks,
  FEATURES,
  type FeatureKey,
} from "@/lib/ethos-gates";

interface ReputationPerksProps {
  className?: string;
  compact?: boolean;
}

const TierIcon = ({ icon, className }: { icon: "shield" | "users" | "zap" | "crown"; className?: string }) => {
  const iconClass = cn("w-5 h-5", className);
  switch (icon) {
    case "crown": return <Crown className={iconClass} />;
    case "zap": return <Zap className={iconClass} />;
    case "users": return <Users className={iconClass} />;
    default: return <Shield className={iconClass} />;
  }
};

export function ReputationPerks({ className, compact = false }: ReputationPerksProps) {
  const { ethosScore } = useAppStore();
  const currentScore = ethosScore?.score || 0;
  
  const tier = getEthosTier(currentScore);
  const tierInfo = getTierInfo(tier);
  const access = getFeatureAccess(currentScore);
  const nextUnlocks = getNextTierUnlocks(currentScore);

  // Group features by unlock status
  const unlockedFeatures = Object.values(FEATURES).filter(
    f => currentScore >= f.requiredScore
  );
  const lockedFeatures = Object.values(FEATURES).filter(
    f => currentScore < f.requiredScore
  );

  if (compact) {
    return (
      <div className={cn("flex items-center gap-3 p-3 rounded-lg border", tierInfo.bgColor, tierInfo.borderColor, className)}>
        <TierIcon icon={tierInfo.icon} className={tierInfo.color} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={cn("font-bold uppercase text-sm", tierInfo.color)}>{tierInfo.name}</span>
            <span className="text-xs text-foreground-muted font-mono">{currentScore} Ethos</span>
          </div>
          {nextUnlocks && (
            <div className="text-xs text-foreground-muted truncate">
              {nextUnlocks.pointsAway} to {nextUnlocks.nextTier}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <Card className={cn("glass-panel border-border/50 bg-surface/40", className)}>
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-mono text-foreground-muted tracking-wider uppercase flex items-center gap-2">
            <Star className="w-4 h-4" />
            Ethos Access
          </CardTitle>
          <div className={cn(
            "flex items-center gap-2 px-3 py-1 rounded-full border text-xs font-mono",
            tierInfo.bgColor, tierInfo.borderColor
          )}>
            <TierIcon icon={tierInfo.icon} className={cn("w-4 h-4", tierInfo.color)} />
            <span className={cn("uppercase font-bold", tierInfo.color)}>{tierInfo.name}</span>
            <span className="text-foreground-muted">{currentScore}</span>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Unlocked Features */}
        {unlockedFeatures.length > 0 && (
          <div className="space-y-3">
            <h4 className="text-xs font-mono text-foreground-muted uppercase tracking-wider">
              Unlocked ({unlockedFeatures.length})
            </h4>
            <div className="grid grid-cols-2 gap-2">
              {unlockedFeatures.map((feature) => (
                <div
                  key={feature.key}
                  className="flex items-center gap-2 p-2 rounded bg-patience/5 border border-patience/20"
                >
                  <Check className="w-3 h-3 text-patience flex-shrink-0" />
                  <span className="text-xs text-foreground truncate">{feature.name}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Next Tier Progress */}
        {nextUnlocks && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-mono text-foreground-muted uppercase tracking-wider">
                Next: {getTierInfo(nextUnlocks.nextTier).name}
              </h4>
              <span className="text-xs font-mono text-foreground-muted">
                {currentScore} / {nextUnlocks.requiredScore}
              </span>
            </div>

            <div className="w-full bg-surface rounded-full h-2">
              <div
                className="bg-gradient-to-r from-signal to-patience h-2 rounded-full transition-all duration-500"
                style={{
                  width: `${Math.min(100, (currentScore / nextUnlocks.requiredScore) * 100)}%`
                }}
              />
            </div>

            <p className="text-xs text-foreground-muted">
              <span className="text-signal font-medium">{nextUnlocks.pointsAway}</span> points to unlock:
            </p>

            <div className="space-y-1">
              {nextUnlocks.unlocks.slice(0, 3).map((feature) => (
                <div key={feature.key} className="flex items-center gap-2 text-xs">
                  <ChevronRight className="w-3 h-3 text-foreground-muted" />
                  <span className="text-foreground">{feature.name}</span>
                  <span className="text-foreground-dim">— {feature.description}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Locked Features Preview */}
        {lockedFeatures.length > 0 && (
          <div className="space-y-3 pt-4 border-t border-border/50">
            <h4 className="text-xs font-mono text-foreground-muted uppercase tracking-wider">
              Locked ({lockedFeatures.length})
            </h4>
            <div className="grid grid-cols-2 gap-2">
              {lockedFeatures.slice(0, 4).map((feature) => (
                <div
                  key={feature.key}
                  className="flex items-center gap-2 p-2 rounded bg-surface/30 border border-border/50 opacity-60"
                >
                  <Lock className="w-3 h-3 text-foreground-muted flex-shrink-0" />
                  <div className="min-w-0">
                    <span className="text-xs text-foreground-muted truncate block">{feature.name}</span>
                    <span className="text-[10px] text-foreground-dim">{feature.requiredScore}+</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Elite Status */}
        {tier === "elite" && (
          <div className="p-4 rounded-lg bg-patience/5 border border-patience/20">
            <div className="flex items-center gap-2 mb-2">
              <Crown className="w-4 h-4 text-patience" />
              <span className="text-sm font-semibold text-patience">Elite Access Achieved</span>
            </div>
            <p className="text-xs text-foreground-muted">
              Full platform access unlocked. Thank you for building trust in the ecosystem.
            </p>
          </div>
        )}

        {/* CTA */}
        {tier !== "elite" && (
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => window.open("https://ethos.network", "_blank")}
          >
            <ExternalLink className="w-3 h-3 mr-2" />
            Build Reputation on Ethos
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
