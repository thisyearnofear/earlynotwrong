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
  Info,
  Circle,
  BarChart3,
  Search,
  AlertCircle
} from "lucide-react";
import {
  getEthosTier,
  getTierInfo,
  FEATURES,
  type FeatureKey,
} from "@/lib/ethos-gates";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { LucideIcon } from "lucide-react";

interface ReputationPerksProps {
  className?: string;
  compact?: boolean;
}

const TierIcon = ({ icon, className }: { icon: string; className?: string }) => {
  const iconClass = cn("w-5 h-5", className);
  switch (icon) {
    case "crown": return <Crown className={iconClass} />;
    case "zap": return <Zap className={iconClass} />;
    case "users": return <Users className={iconClass} />;
    default: return <Shield className={iconClass} />;
  }
};

const MILESTONES: { score: number; label: string; icon: LucideIcon; color: string; features: FeatureKey[] }[] = [
  { score: 1000, label: "Entry", icon: Shield, color: "text-foreground-muted", features: ["extendedLookback", "advancedFilters"] },
  { score: 1200, label: "Neutral", icon: Star, color: "text-signal", features: ["communityEndorse"] },
  { score: 1400, label: "Known", icon: Users, color: "text-foreground", features: ["dataExport", "tokenHeatmap", "cohortData", "communityCurate"] },
  { score: 1700, label: "Reputable", icon: Zap, color: "text-signal", features: ["alphaDiscovery", "realTimeAlerts", "communityNominate", "communityModerate"] },
  { score: 1800, label: "Advanced", icon: BarChart3, color: "text-patience", features: ["advancedAnalytics"] },
  { score: 2000, label: "Exemplary", icon: Crown, color: "text-patience", features: ["fastRefresh"] as any },
];

export function ReputationPerks({ className, compact = false }: ReputationPerksProps) {
  const { ethosScore } = useAppStore();
  const currentScore = ethosScore?.score || 0;

  const tier = getEthosTier(currentScore);
  const tierInfo = getTierInfo(tier);

  if (compact) {
    return (
      <div className={cn("flex items-center gap-3 p-3 rounded-lg border", tierInfo.bgColor, tierInfo.borderColor, className)}>
        <TierIcon icon={tierInfo.icon} className={tierInfo.color} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={cn("font-bold uppercase text-sm", tierInfo.color)}>{tierInfo.name}</span>
            <span className="text-xs text-foreground-muted font-mono">{currentScore} Ethos</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <Card className={cn("glass-panel border-border/50 bg-surface/40", className)}>
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-mono text-foreground-muted tracking-wider uppercase flex items-center gap-2">
            <Shield className="w-4 h-4" />
            Reputation Roadmap
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

      <CardContent className="space-y-8">
        {/* Progress Timeline */}
        <div className="relative pt-2 pb-4 px-2">
          {/* Vertical Line */}
          <div className="absolute left-6 top-0 bottom-0 w-px bg-border/50" />

          <div className="space-y-6">
            {MILESTONES.map((milestone, idx) => {
              const Icon = milestone.icon;
              const isUnlocked = currentScore >= milestone.score;
              const isNext = !isUnlocked && (idx === 0 || currentScore >= MILESTONES[idx - 1].score);

              return (
                <div key={milestone.score} className={cn(
                  "relative flex items-start gap-6 transition-opacity",
                  !isUnlocked && !isNext && "opacity-40"
                )}>
                  {/* Node */}
                  <div className={cn(
                    "relative z-10 w-9 h-9 rounded-full border flex items-center justify-center bg-surface shrink-0",
                    isUnlocked ? "border-patience/50 shadow-[0_0_15px_rgba(52,211,153,0.2)]" : isNext ? "border-signal/50 animate-pulse" : "border-border"
                  )}>
                    {isUnlocked ? (
                      <Check className="w-5 h-5 text-patience" />
                    ) : (
                      <Icon className={cn("w-4 h-4", isNext ? "text-signal" : "text-foreground-dim")} />
                    )}
                  </div>

                  {/* Content */}
                  <div className="flex-1 pt-1">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex flex-col">
                        <span className={cn(
                          "text-sm font-bold uppercase tracking-tight",
                          isUnlocked ? "text-foreground" : isNext ? "text-signal" : "text-foreground-muted"
                        )}>
                          {milestone.label}
                        </span>
                        <span className="text-[10px] font-mono text-foreground-muted">
                          {milestone.score} Ethos Required
                        </span>
                      </div>
                      {isUnlocked && (
                        <div className="px-2 py-0.5 rounded bg-patience/10 border border-patience/20 text-[10px] font-mono text-patience uppercase">
                          Active
                        </div>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-1.5">
                      {milestone.features.map(fKey => {
                        const feature = FEATURES[fKey];
                        if (!feature) return null;

                        return (
                          <Tooltip key={fKey}>
                            <TooltipTrigger asChild>
                              <div className={cn(
                                "inline-flex items-center gap-1.5 px-2 py-1 rounded text-[11px] cursor-help transition-colors",
                                isUnlocked
                                  ? "bg-surface/60 border border-border/50 text-foreground"
                                  : "bg-surface/20 border border-border/20 text-foreground-dim"
                              )}>
                                {feature.name}
                                <Info className="w-3 h-3 opacity-50" />
                              </div>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="max-w-[200px] space-y-1">
                              <p className="font-bold">{feature.name}</p>
                              <p className="text-foreground-muted">{feature.description}</p>
                              <p className="text-signal italic pt-1">{feature.valueTeaser}</p>
                            </TooltipContent>
                          </Tooltip>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Action */}
        <div className="pt-4 border-t border-border/50">
          <p className="text-xs text-foreground-muted mb-4 leading-relaxed">
            Reputation is cross-chain. Your Ethos score updates in real-time as you build trust within the ecosystem.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="w-full h-10 group"
            onClick={() => window.open("https://ethos.network", "_blank")}
          >
            <ExternalLink className="w-4 h-4 mr-2 text-foreground-muted group-hover:text-signal transition-colors" />
            Grow Influence on Ethos
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
