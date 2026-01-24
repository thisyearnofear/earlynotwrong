"use client";

import { Navbar } from "@/components/layout/navbar";
import { TunnelBackground } from "@/components/ui/tunnel-background";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import Link from "next/link";
import {
  Activity,
  Users,
  Bell,
  Shield,
  Zap,
  ArrowRight,
  Target,
  Clock,
  BarChart3,
} from "lucide-react";

const FEATURES = [
  {
    id: "conviction-analysis",
    icon: Activity,
    title: "Conviction Analysis",
    subtitle: "Audit your trading behavior",
    description:
      "Connect any wallet to analyze trading history across Solana and Base. We calculate your Conviction Index based on how you handle winners vs losers, measuring behavior under uncertainty rather than raw performance.",
    metrics: [
      "Patience Tax — dollar value of missed upside from early exits",
      "Upside Capture — percentage of potential gains realized",
      "Conviction Wins — positions held through significant drawdowns",
      "Behavioral Archetype — Iron Pillar, Diamond Hand, Profit Phantom, or Exit Voyager",
    ],
  },
  {
    id: "alpha-discovery",
    icon: Users,
    title: "Alpha Discovery",
    subtitle: "Find high-conviction traders",
    description:
      "Discover wallets exhibiting strong conviction behavior, weighted by Ethos reputation. Surface traders who are accumulating before the crowd, filtered to exclude low-credibility wallets.",
    metrics: [
      "Reputation-weighted rankings (Ethos + FairScale)",
      "Real-time leaderboard of Iron Pillar traders",
      "Token conviction heatmap showing credible holder concentration",
      "Cross-chain discovery across Solana and Base",
    ],
    href: "/discovery",
  },
  {
    id: "cluster-alerts",
    icon: Bell,
    title: "Cluster Alerts",
    subtitle: "Social signal detection",
    description:
      "Get notified when multiple high-trust traders enter the same token within a short time window. Cluster signals indicate potential confluence among credible participants.",
    metrics: [
      "Real-time detection: 3+ traders with trust score ≥65",
      "15-minute sliding window with 30-minute cooldown",
      "Email notifications via Resend",
      "Telegram push notifications via bot",
      "Configurable thresholds and filters",
    ],
    isNew: true,
  },
  {
    id: "reputation-gating",
    icon: Shield,
    title: "Reputation Gating",
    subtitle: "Progressive feature unlocking",
    description:
      "Features unlock as your Ethos credibility grows. This creates a sybil-resistant environment where advanced analytics are only accessible to users with proven on-chain reputation.",
    metrics: [
      "Ethos 1000+ — Alpha Discovery, Token Heatmap",
      "Ethos 1200+ — Community Endorsements",
      "Ethos 1400+ — Data Export, Cohort Analysis",
      "Ethos 1700+ — Real-time Alerts, Whale Tracking",
      "Ethos 2000+ — Elite Dashboard, Early Access",
    ],
  },
  {
    id: "cross-chain",
    icon: Zap,
    title: "Cross-Chain Support",
    subtitle: "Unified analysis",
    description:
      "Analyze wallets on both Solana and Base with unified conviction scoring. Trust scores are normalized across Ethos (EVM) and FairScale (Solana) to provide consistent reputation data.",
    metrics: [
      "Solana: Helius webhooks for real-time transaction ingestion",
      "Base: Alchemy polling for ERC-20 transfers",
      "Unified Trust Score (0-100) across providers",
      "Cross-chain identity resolution via Farcaster verified addresses",
    ],
  },
  {
    id: "attestations",
    icon: Target,
    title: "On-Chain Attestations",
    subtitle: "Permanent reputation",
    description:
      "Write your Conviction Index to Ethos Network as an immutable attestation. Your behavioral reputation becomes portable and composable across the crypto ecosystem.",
    metrics: [
      "EIP-712 signed attestations",
      "Stored on Ethereum Attestation Service (EAS)",
      "Queryable by any dApp via Ethos API",
      "Shareable conviction receipts",
    ],
  },
];

export default function FeaturesPage() {
  return (
    <div className="min-h-screen text-foreground selection:bg-signal/20 overflow-x-hidden relative">
      <TunnelBackground />
      <Navbar />

      <main className="pt-24 pb-12 px-4 sm:px-6 lg:px-8 max-w-5xl mx-auto">
        {/* Hero */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center space-y-4 mb-12"
        >
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-border bg-surface/50 backdrop-blur-sm text-xs font-mono text-foreground-muted">
            <BarChart3 className="w-3.5 h-3.5" />
            HOW IT WORKS
          </div>
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight">
            Conviction Intelligence
          </h1>
          <p className="text-foreground-muted max-w-2xl mx-auto text-lg">
            A reputation-native platform for understanding trading behavior.
            Not signals. Not copy-trading. Meta-signal about the trader.
          </p>
        </motion.div>

        {/* Core Thesis */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="mb-16"
        >
          <Card className="glass-panel border-signal/30 bg-signal/5">
            <CardContent className="p-6 md:p-8">
              <div className="grid md:grid-cols-3 gap-6 text-center">
                <div>
                  <Clock className="w-8 h-8 text-signal mx-auto mb-3" />
                  <h3 className="font-bold text-foreground mb-1">Asymmetry</h3>
                  <p className="text-sm text-foreground-muted">
                    Losses capped at −1x. Wins uncapped. The most expensive
                    mistake is selling winners too early.
                  </p>
                </div>
                <div>
                  <Activity className="w-8 h-8 text-signal mx-auto mb-3" />
                  <h3 className="font-bold text-foreground mb-1">Behavior</h3>
                  <p className="text-sm text-foreground-muted">
                    Conviction Index measures behavior under uncertainty, not
                    raw performance. How you hold matters.
                  </p>
                </div>
                <div>
                  <Shield className="w-8 h-8 text-signal mx-auto mb-3" />
                  <h3 className="font-bold text-foreground mb-1">Reputation</h3>
                  <p className="text-sm text-foreground-muted">
                    All features weighted by Ethos credibility. Sybil-resistant
                    by design.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Features List */}
        <div className="space-y-8">
          {FEATURES.map((feature, index) => (
            <motion.div
              key={feature.id}
              id={feature.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 + index * 0.05 }}
            >
              <Card className="glass-panel border-border/50 bg-surface/30 overflow-hidden">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-signal/10 flex items-center justify-center">
                        <feature.icon className="w-5 h-5 text-signal" />
                      </div>
                      <div>
                        <CardTitle className="text-lg font-bold flex items-center gap-2">
                          {feature.title}
                          {feature.isNew && (
                            <span className="px-2 py-0.5 text-[10px] font-mono bg-signal/20 text-signal rounded">
                              NEW
                            </span>
                          )}
                        </CardTitle>
                        <p className="text-xs text-foreground-muted font-mono uppercase tracking-wider">
                          {feature.subtitle}
                        </p>
                      </div>
                    </div>
                    {feature.href && (
                      <Link href={feature.href}>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-signal hover:bg-signal/10"
                        >
                          Explore <ArrowRight className="w-3 h-3 ml-1" />
                        </Button>
                      </Link>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-foreground-muted">{feature.description}</p>
                  <ul className="grid md:grid-cols-2 gap-2">
                    {feature.metrics.map((metric, i) => (
                      <li
                        key={i}
                        className="flex items-start gap-2 text-sm text-foreground"
                      >
                        <span className="text-signal mt-1">•</span>
                        {metric}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>

        {/* CTA */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          className="mt-16 text-center"
        >
          <Link href="/">
            <Button className="bg-signal hover:bg-signal/90 text-background font-mono">
              Analyze Your Wallet <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </Link>
          <p className="text-xs text-foreground-muted mt-4">
            No sign-up required. Connect wallet or use Demo Mode.
          </p>
        </motion.div>
      </main>
    </div>
  );
}
