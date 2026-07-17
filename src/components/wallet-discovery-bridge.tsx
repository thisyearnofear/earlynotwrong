"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Activity, Search, ShoppingBag } from "lucide-react";
import { HireSignalsCta } from "@/components/hire-signals-cta";
import type { SignalsLiveTeaser } from "@/lib/signals-teaser-types";
import { HIRE_AGENT_HREF } from "@/lib/croo-store";
import { cn } from "@/lib/utils";

const PATHS = [
  {
    href: "/analyzer",
    label: "Analyze a wallet",
    sub: "Behavioral conviction score",
    icon: Search,
  },
  {
    href: "/agent",
    label: "Watch the agent",
    sub: "Live BSC book + on-chain proof",
    icon: Activity,
  },
  {
    href: HIRE_AGENT_HREF,
    label: "Hire signals-live",
    sub: "MCP + CROO · v1.1",
    icon: ShoppingBag,
  },
] as const;

interface WalletDiscoveryBridgeProps {
  variant: "leaderboard" | "alpha";
  className?: string;
}

export function WalletDiscoveryBridge({
  variant,
  className,
}: WalletDiscoveryBridgeProps) {
  const [teaser, setTeaser] = useState<SignalsLiveTeaser | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/agent/proxy?endpoint=signals/teaser")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data) setTeaser(data as SignalsLiveTeaser);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const blurb =
    variant === "leaderboard"
      ? "Community wallet scans ranked by behavioral conviction — the same framework the live agent uses on itself each cycle."
      : "Aggregated patterns from analyzed wallets. Live cycle signals, macro gates, and cross-chain proof come from hiring the autonomous agent.";

  return (
    <div className={cn("space-y-4", className)}>
      <p className="text-[11px] font-mono text-foreground-muted leading-relaxed max-w-2xl">
        {blurb}
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {PATHS.map(({ href, label, sub, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className="flex items-start gap-2.5 rounded-lg border border-border/50 bg-surface/30 px-3 py-2.5 hover:border-signal/30 hover:bg-surface/50 transition-colors"
          >
            <Icon className="w-4 h-4 text-signal shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-[11px] font-mono font-semibold text-foreground">{label}</p>
              <p className="text-[10px] font-mono text-foreground-dim mt-0.5">{sub}</p>
            </div>
          </Link>
        ))}
      </div>

      <HireSignalsCta teaser={teaser} compact />
    </div>
  );
}
