"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import {
  Shield,
  Users,
  Zap,
  Crown,
  Clock,
  Download,
  BarChart3,
  Bell,
  Lock,
  Check,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  getEthosTier,
  getTierInfo,
  getPerksList,
  TIER_REQUIREMENTS,
  type EthosTier,
  type TierPerk,
} from "@/lib/ethos-gates";

interface ReputationTierCardProps {
  currentScore: number | null;
  className?: string;
}

const PerkIcon = ({
  icon,
  className,
}: {
  icon: TierPerk["icon"];
  className?: string;
}) => {
  const cls = cn("w-3.5 h-3.5", className);
  switch (icon) {
    case "clock":
      return <Clock className={cls} />;
    case "download":
      return <Download className={cls} />;
    case "chart":
      return <BarChart3 className={cls} />;
    case "bell":
      return <Bell className={cls} />;
    case "crown":
      return <Crown className={cls} />;
    case "shield":
      return <Shield className={cls} />;
    case "zap":
      return <Zap className={cls} />;
    case "lock":
      return <Lock className={cls} />;
  }
};

const TierIcon = ({
  icon,
  className,
}: {
  icon: "shield" | "users" | "zap" | "crown";
  className?: string;
}) => {
  const cls = cn("w-5 h-5", className);
  switch (icon) {
    case "crown":
      return <Crown className={cls} />;
    case "zap":
      return <Zap className={cls} />;
    case "users":
      return <Users className={cls} />;
    default:
      return <Shield className={cls} />;
  }
};

export function ReputationTierCard({
  currentScore,
  className,
}: ReputationTierCardProps) {
  const score = currentScore ?? 0;
  const tier = getEthosTier(score);
  const tierInfo = getTierInfo(tier);
  const perks = useMemo(() => getPerksList(tier), [tier]);

  const tierOrder: EthosTier[] = [
    "visitor",
    "member",
    "premium",
    "whale",
    "alpha",
    "elite",
  ];
  const currentIdx = tierOrder.indexOf(tier);
  const nextTier: EthosTier | null =
    currentIdx < tierOrder.length - 1 ? tierOrder[currentIdx + 1] : null;
  const nextRequired = nextTier ? TIER_REQUIREMENTS[nextTier] : TIER_REQUIREMENTS.elite;
  const prevRequired = TIER_REQUIREMENTS[tier];
  const progressPct = nextTier
    ? Math.min(
        100,
        Math.max(
          0,
          ((score - prevRequired) / (nextRequired - prevRequired)) * 100,
        ),
      )
    : 100;
  const pointsToNext = nextTier ? Math.max(0, nextRequired - score) : 0;

  return (
    <div
      className={cn(
        "relative rounded-xl border border-border bg-surface/40 overflow-hidden",
        className,
      )}
    >
      {/* Header */}
      <div
        className={cn(
          "p-5 border-b border-border/50",
          tierInfo.bgColor,
        )}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div
              className={cn(
                "flex items-center justify-center w-11 h-11 rounded-full border",
                tierInfo.bgColor,
                tierInfo.borderColor,
              )}
            >
              <TierIcon icon={tierInfo.icon} className={tierInfo.color} />
            </div>
            <div>
              <div className="text-xs font-mono uppercase tracking-wider text-foreground-muted">
                Reputation Tier
              </div>
              <div className={cn("text-lg font-bold", tierInfo.color)}>
                {tierInfo.name}
              </div>
            </div>
          </div>

          <div className="text-right">
            <div className="text-3xl font-bold tabular-nums text-foreground">
              {score}
            </div>
            <div className="text-[10px] font-mono uppercase tracking-wider text-foreground-muted">
              Ethos Score
            </div>
          </div>
        </div>

        {/* Progress bar to next tier */}
        <div className="mt-4">
          <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-wider text-foreground-muted mb-1.5">
            <span>{tierInfo.name}</span>
            <span>
              {nextTier ? (
                <>
                  → {nextRequired}{" "}
                  <span className="text-foreground-dim">
                    ({getTierInfo(nextTier).name})
                  </span>
                </>
              ) : (
                "Max tier"
              )}
            </span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-background/60 overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${progressPct}%` }}
              transition={{ duration: 0.6, ease: "easeOut" }}
              className={cn(
                "h-full rounded-full",
                tier === "elite"
                  ? "bg-patience"
                  : tier === "alpha"
                  ? "bg-signal"
                  : "bg-foreground/70",
              )}
            />
          </div>
          {nextTier && (
            <div className="mt-1.5 text-[11px] font-mono text-foreground-dim">
              <span className="text-foreground-muted">{pointsToNext}</span>{" "}
              more points to{" "}
              <span className={getTierInfo(nextTier).color}>
                {getTierInfo(nextTier).name}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Perks */}
      <div className="p-5 space-y-5">
        {/* Unlocked perks */}
        {perks.unlocked.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Check className="w-3.5 h-3.5 text-patience" />
              <h4 className="text-xs font-mono uppercase tracking-wider text-foreground-muted">
                Active Perks ({perks.unlocked.length})
              </h4>
            </div>
            <ul className="space-y-2">
              {perks.unlocked.map((perk) => (
                <li
                  key={perk.key}
                  className="flex items-start gap-2.5 text-sm"
                >
                  <div className="flex items-center justify-center w-6 h-6 rounded-md bg-patience/10 text-patience shrink-0 mt-0.5">
                    <PerkIcon icon={perk.icon} />
                  </div>
                  <div className="min-w-0">
                    <div className="font-medium text-foreground leading-tight">
                      {perk.label}
                    </div>
                    <div className="text-xs text-foreground-muted leading-snug mt-0.5">
                      {perk.description}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Locked perks preview */}
        {perks.locked.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Sparkles className="w-3.5 h-3.5 text-foreground-dim" />
              <h4 className="text-xs font-mono uppercase tracking-wider text-foreground-muted">
                Locked ({perks.locked.length})
              </h4>
            </div>
            <ul className="space-y-2 opacity-70">
              {perks.locked.slice(0, 3).map(({ perk, requiredScore, requiredTier }) => (
                <li
                  key={perk.key}
                  className="flex items-start gap-2.5 text-sm"
                >
                  <div className="flex items-center justify-center w-6 h-6 rounded-md bg-foreground/5 text-foreground-dim shrink-0 mt-0.5">
                    <Lock className="w-3 h-3" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-foreground/80 leading-tight">
                      {perk.label}
                    </div>
                    <div className="text-xs text-foreground-dim leading-snug mt-0.5">
                      {perk.description}
                    </div>
                  </div>
                  <div className="text-[10px] font-mono text-foreground-dim whitespace-nowrap shrink-0">
                    {requiredScore}
                  </div>
                </li>
              ))}
              {perks.locked.length > 3 && (
                <li className="text-xs text-foreground-dim font-mono pl-8">
                  + {perks.locked.length - 3} more at higher tiers
                </li>
              )}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
