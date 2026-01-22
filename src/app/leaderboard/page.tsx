"use client";

import { Navbar } from "@/components/layout/navbar";
import { TunnelBackground } from "@/components/ui/tunnel-background";
import { LeaderboardPanel } from "@/components/ui/leaderboard-panel";
import { motion } from "framer-motion";
import { Trophy, TrendingUp, ShieldCheck } from "lucide-react";

export default function LeaderboardPage() {
    return (
        <div className="min-h-screen text-foreground selection:bg-signal/20 overflow-x-hidden relative">
            <TunnelBackground />
            <Navbar />

            <main className="pt-24 pb-12 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
                <div className="max-w-4xl mx-auto space-y-8">
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="text-center space-y-4"
                    >
                        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-border bg-surface/50 backdrop-blur-sm text-xs font-mono text-signal">
                            <Trophy className="w-3.5 h-3.5" />
                            GLOBAL CONVICTION RANKINGS
                        </div>
                        <h1 className="text-4xl font-bold tracking-tight">The Iron Pillar</h1>
                        <p className="text-foreground-muted max-w-xl mx-auto">
                            Real-time leaderboard of traders with the highest conviction scores.
                            These wallets demonstrate the highest upside capture and longest holding periods.
                        </p>
                    </motion.div>

                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.1 }}
                    >
                        <LeaderboardPanel />
                    </motion.div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-8">
                        <div className="glass-panel p-6 border-border/50 bg-surface/30 space-y-3">
                            <div className="w-10 h-10 rounded-full bg-patience/10 flex items-center justify-center border border-patience/20">
                                <ShieldCheck className="w-5 h-5 text-patience" />
                            </div>
                            <h3 className="text-sm font-bold uppercase font-mono">Verified Conviction</h3>
                            <p className="text-xs text-foreground-muted leading-relaxed">
                                Rankings are based on behavioral heuristics, not just P&L. We reward patience and strategy.
                            </p>
                        </div>
                        <div className="glass-panel p-6 border-border/50 bg-surface/30 space-y-3">
                            <div className="w-10 h-10 rounded-full bg-signal/10 flex items-center justify-center border border-signal/20">
                                <TrendingUp className="w-5 h-5 text-signal" />
                            </div>
                            <h3 className="text-sm font-bold uppercase font-mono">Dynamic Ranking</h3>
                            <p className="text-xs text-foreground-muted leading-relaxed">
                                Positions update every hour based on latest chain data and Ethos credibility signals.
                            </p>
                        </div>
                        <div className="glass-panel p-6 border-border/50 bg-surface/30 space-y-3">
                            <div className="w-10 h-10 rounded-full bg-blue-500/10 flex items-center justify-center border border-blue-500/20">
                                <Trophy className="w-5 h-5 text-blue-400" />
                            </div>
                            <h3 className="text-sm font-bold uppercase font-mono">Hall of Fame</h3>
                            <p className="text-xs text-foreground-muted leading-relaxed">
                                Reach the Top 10 to earn 'Exemplary' status and bypass community nomination review.
                            </p>
                        </div>
                    </div>
                </div>
            </main>
        </div>
    );
}
