"use client";

import { Navbar } from "@/components/layout/navbar";
import { TunnelBackground } from "@/components/ui/tunnel-background";
import { AlphaDiscovery } from "@/components/ui/alpha-discovery";
import { motion } from "framer-motion";
import { Zap, Search, Target } from "lucide-react";

export default function DiscoveryPage() {
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
                            <Zap className="w-3.5 h-3.5" />
                            CONVICTION DISCOVERY ENGINE
                        </div>
                        <h1 className="text-4xl font-bold tracking-tight">Alpha Discovery</h1>
                        <p className="text-foreground-muted max-w-xl mx-auto">
                            Scan the network for early signs of high conviction. We surface wallets that
                            are accumulating before the herd, filtered by Ethos reputation.
                        </p>
                    </motion.div>

                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.1 }}
                    >
                        <AlphaDiscovery />
                    </motion.div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-8">
                        <div className="glass-panel p-6 border-border/50 bg-surface/30 space-y-3 flex items-start gap-4">
                            <div className="w-10 h-10 rounded-full bg-signal/10 flex items-center justify-center border border-signal/20 shrink-0">
                                <Target className="w-5 h-5 text-signal" />
                            </div>
                            <div>
                                <h3 className="text-sm font-bold uppercase font-mono">Algorithmic Detection</h3>
                                <p className="text-xs text-foreground-muted leading-relaxed">
                                    Our system scans millions of swaps on Base and Solana to identify "Iron Pillar" behavior in real-time.
                                </p>
                            </div>
                        </div>
                        <div className="glass-panel p-6 border-border/50 bg-surface/30 space-y-3 flex items-start gap-4">
                            <div className="w-10 h-10 rounded-full bg-patience/10 flex items-center justify-center border border-patience/20 shrink-0">
                                <Search className="w-5 h-5 text-patience" />
                            </div>
                            <div>
                                <h3 className="text-sm font-bold uppercase font-mono">Community Curated</h3>
                                <p className="text-xs text-foreground-muted leading-relaxed">
                                    Switch to the 'Curated' tab to see traders hand-picked and endorsed by the highest Ethos members.
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            </main>
        </div>
    );
}
