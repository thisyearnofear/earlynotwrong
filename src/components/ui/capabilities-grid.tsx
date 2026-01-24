"use client";

import { cn } from "@/lib/utils";
import {
  Activity,
  Users,
  Bell,
  TrendingUp,
  Shield,
  Zap,
} from "lucide-react";
import Link from "next/link";

interface Capability {
  icon: React.ReactNode;
  title: string;
  description: string;
  href?: string;
  badge?: string;
}

const CAPABILITIES: Capability[] = [
  {
    icon: <Activity className="w-5 h-5" />,
    title: "Conviction Analysis",
    description: "Audit your trades to separate bad timing from bad thesis",
  },
  {
    icon: <Users className="w-5 h-5" />,
    title: "Alpha Discovery",
    description: "Find high-conviction traders filtered by Ethos reputation",
    href: "/discovery",
  },
  {
    icon: <Bell className="w-5 h-5" />,
    title: "Cluster Alerts",
    description: "Get notified when high-trust traders enter the same token",
    badge: "NEW",
  },
  {
    icon: <TrendingUp className="w-5 h-5" />,
    title: "Leaderboards",
    description: "Compare conviction scores across the cohort",
    href: "/leaderboard",
  },
  {
    icon: <Shield className="w-5 h-5" />,
    title: "Reputation Gating",
    description: "Features unlock as your Ethos credibility grows",
  },
  {
    icon: <Zap className="w-5 h-5" />,
    title: "Cross-Chain",
    description: "Unified analysis across Solana and Base networks",
  },
];

interface CapabilitiesGridProps {
  className?: string;
}

export function CapabilitiesGrid({ className }: CapabilitiesGridProps) {
  return (
    <div className={cn("w-full", className)}>
      <div className="text-center mb-6">
        <p className="text-[10px] font-mono text-foreground-muted uppercase tracking-widest">
          Platform Capabilities
        </p>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {CAPABILITIES.map((cap) => {
          const content = (
            <div
              className={cn(
                "group p-4 rounded-lg border border-border/50 bg-surface/30 hover:bg-surface/50 hover:border-signal/30 transition-all",
                cap.href && "cursor-pointer"
              )}
            >
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-signal/10 flex items-center justify-center text-signal shrink-0 group-hover:bg-signal/20 transition-colors">
                  {cap.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-xs font-bold uppercase font-mono text-foreground truncate">
                      {cap.title}
                    </h3>
                    {cap.badge && (
                      <span className="px-1.5 py-0.5 text-[9px] font-mono bg-signal/20 text-signal rounded">
                        {cap.badge}
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-foreground-muted leading-relaxed mt-1">
                    {cap.description}
                  </p>
                </div>
              </div>
            </div>
          );

          return cap.href ? (
            <Link key={cap.title} href={cap.href}>
              {content}
            </Link>
          ) : (
            <div key={cap.title}>{content}</div>
          );
        })}
      </div>
    </div>
  );
}
