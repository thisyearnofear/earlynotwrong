"use client";

import * as React from "react";
import { ConvictionBadge, Archetype } from "./conviction-badge";
import { Card, CardContent, CardHeader, CardTitle } from "./card";
import { SocialProofBadge } from "./social-proof-badge";
import { ShieldCheck, User, TrendingUp, AlertTriangle, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "./button";

export interface WalletComparisonData {
  address: string;
  name?: string;
  pfp?: string;
  convictionScore: number;
  ethosScore: number;
  archetype: Archetype;
  metrics: {
    winRate: number;
    upsideCapture: number;
    patienceTax: number;
  };
}

interface WalletComparisonCardProps {
  wallets: WalletComparisonData[];
  onAddWallet?: () => void;
  onRemoveWallet?: (address: string) => void;
  className?: string;
}

export function WalletComparisonCard({
  wallets,
  onAddWallet,
  onRemoveWallet,
  className,
}: WalletComparisonCardProps) {
  return (
    <div className={cn("grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4", className)}>
      <AnimatePresence mode="popLayout">
        {wallets.map((wallet) => (
          <motion.div
            key={wallet.address}
            layout
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ duration: 0.3 }}
          >
            <Card className="glass-panel border-border/50 bg-surface/40 h-full flex flex-col relative group">
              {onRemoveWallet && (
                <button
                  onClick={() => onRemoveWallet(wallet.address)}
                  className="absolute top-2 right-2 p-1 rounded-full bg-surface/50 text-foreground-muted hover:text-impatience opacity-0 group-hover:opacity-100 transition-opacity z-10"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
              
              <CardHeader className="pb-2">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-surface border border-border overflow-hidden flex items-center justify-center shrink-0">
                    {wallet.pfp ? (
                      <img src={wallet.pfp} alt={wallet.name} className="h-full w-full object-cover" />
                    ) : (
                      <User className="h-5 w-5 text-foreground-muted" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <CardTitle className="text-sm font-bold truncate">
                      {wallet.name || `${wallet.address.slice(0, 6)}...${wallet.address.slice(-4)}`}
                    </CardTitle>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <ShieldCheck className="h-3 w-3 text-ethos" />
                      <span className="text-[10px] font-mono text-foreground-muted">
                        Ethos: {wallet.ethosScore}
                      </span>
                    </div>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="space-y-4 pt-2">
                <div className="flex flex-col items-center py-4 border-y border-border/20">
                  <div className="text-4xl font-bold text-foreground mb-1">
                    {wallet.convictionScore}
                  </div>
                  <div className="text-[10px] font-mono text-signal uppercase tracking-[0.2em]">
                    Conviction Index
                  </div>
                </div>

                <div className="scale-75 origin-top mb-[-20px]">
                  <ConvictionBadge archetype={wallet.archetype} size="sm" className="w-full" />
                </div>

                <div className="space-y-2 pt-4">
                  <div className="flex justify-between items-center text-[10px] font-mono">
                    <span className="text-foreground-muted uppercase">Upside Capture</span>
                    <span className="text-patience">{wallet.metrics.upsideCapture}%</span>
                  </div>
                  <div className="h-1 w-full bg-surface rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-patience" 
                      style={{ width: `${wallet.metrics.upsideCapture}%` }} 
                    />
                  </div>

                  <div className="flex justify-between items-center text-[10px] font-mono">
                    <span className="text-foreground-muted uppercase">Patience Tax</span>
                    <span className="text-impatience">${wallet.metrics.patienceTax}</span>
                  </div>
                  <div className="h-1 w-full bg-surface rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-impatience" 
                      style={{ width: `${Math.min((wallet.metrics.patienceTax / 5000) * 100, 100)}%` }} 
                    />
                  </div>
                </div>
                
                <div className="flex flex-wrap gap-1.5 pt-2">
                  <SocialProofBadge type="vouches" count={Math.floor(wallet.ethosScore / 15)} />
                  <SocialProofBadge type="reviews" count={Math.floor(wallet.ethosScore / 50)} />
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ))}

        {onAddWallet && wallets.length < 3 && (
          <motion.div
            layout
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
          >
            <button
              onClick={onAddWallet}
              className="w-full h-full min-h-[300px] border-2 border-dashed border-border/30 rounded-xl flex flex-col items-center justify-center gap-3 text-foreground-muted hover:text-signal hover:border-signal/30 hover:bg-signal/5 transition-all group"
            >
              <div className="h-12 w-12 rounded-full border-2 border-dashed border-current flex items-center justify-center group-hover:scale-110 transition-transform">
                <Plus className="h-6 w-6" />
              </div>
              <span className="text-xs font-mono uppercase tracking-widest">Add Wallet to Compare</span>
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
