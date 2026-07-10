"use client";

import React from "react";
import { Coins, Landmark, Shield, TrendingUp } from "lucide-react";

const assets = [
  {
    symbol: "MNT",
    label: "Ecosystem Beta",
    thesis: "Governance and network conviction",
    signal: "Rewards patience through volatile ecosystem cycles.",
    icon: TrendingUp,
  },
  {
    symbol: "mETH",
    label: "Liquid Staking",
    thesis: "Yield plus drawdown tolerance",
    signal: "Tests whether holders can keep conviction while ETH beta reprices.",
    icon: Shield,
  },
  {
    symbol: "USDY",
    label: "RWA Yield",
    thesis: "Low-volatility carry discipline",
    signal: "Separates disciplined yield patience from reflexive rotation.",
    icon: Landmark,
  },
];

export function MantleStrategyLens() {
  return (
    <div className="p-4 rounded-xl border border-[#65b3ae]/20 bg-[#65b3ae]/5 backdrop-blur-sm space-y-4 h-full">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className="p-1.5 rounded-lg bg-[#65b3ae]/10 shrink-0">
            <Coins className="w-4 h-4 text-[#65b3ae]" />
          </div>
          <div className="min-w-0">
            <h4 className="text-xs font-bold font-mono text-foreground uppercase tracking-wider">
              Mantle Strategy Lens
            </h4>
            <p className="text-[10px] text-foreground-muted font-mono">
              Curated Phase II asset story
            </p>
          </div>
        </div>
        <div className="px-2 py-1 rounded-full bg-[#65b3ae]/15 border border-[#65b3ae]/25 text-[10px] font-mono font-bold text-[#65b3ae] uppercase shrink-0">
          Demo Lens
        </div>
      </div>

      <div className="space-y-2">
        {assets.map((asset) => {
          const Icon = asset.icon;
          return (
            <div
              key={asset.symbol}
              className="p-3 rounded-lg bg-background/35 border border-border/40"
            >
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-[#65b3ae]/10 border border-[#65b3ae]/20 flex items-center justify-center shrink-0">
                  <Icon className="w-4 h-4 text-[#65b3ae]" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-mono text-xs font-bold text-foreground">
                      {asset.symbol}
                    </div>
                    <div className="text-[10px] font-mono text-foreground-muted uppercase truncate">
                      {asset.label}
                    </div>
                  </div>
                  <div className="mt-1 text-[11px] font-mono text-foreground">
                    {asset.thesis}
                  </div>
                  <p className="mt-1 text-[10px] leading-relaxed text-foreground-muted">
                    {asset.signal}
                  </p>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-[10px] text-foreground-muted font-mono leading-relaxed italic">
        * This curated lens helps judges see how ENW extends from Solana/Base behavior into Mantle-native strategy intelligence.
      </p>
    </div>
  );
}
