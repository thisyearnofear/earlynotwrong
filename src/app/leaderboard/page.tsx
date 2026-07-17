import { Metadata } from "next";
import Link from "next/link";
import { Navbar } from "@/components/layout/navbar";
import { LeaderboardTable } from "@/components/leaderboard/leaderboard-table";
import { WalletDiscoveryBridge } from "@/components/wallet-discovery-bridge";
import { APP_CONFIG } from "@/lib/config";
import { getLeaderboard } from "@/lib/db/postgres";

export const metadata: Metadata = {
  title: "Leaderboard | Early, Not Wrong",
  description:
    "Wallets analyzed on Early, Not Wrong, ranked by behavioral conviction score — patience tax, upside capture, and archetype.",
  openGraph: {
    title: "Conviction Leaderboard | Early, Not Wrong",
    description:
      "Community wallet scans ranked by behavioral conviction — compare to the live autonomous agent.",
    url: `${APP_CONFIG.baseUrl}/leaderboard`,
  },
};

export default async function LeaderboardPage() {
  let entries: Awaited<ReturnType<typeof getLeaderboard>> = [];
  try {
    entries = await getLeaderboard(undefined, 20);
  } catch {
    entries = [];
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <Navbar />

      <div className="pt-24 pb-12 px-4 sm:px-6 lg:px-8 max-w-6xl mx-auto">
        <div className="mb-8">
          <p className="text-[10px] font-mono text-foreground-muted uppercase tracking-widest mb-3">
            Community conviction
          </p>
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-foreground mb-2">
            Wallet Leaderboard
          </h1>
          <p className="text-sm text-foreground-muted max-w-2xl leading-relaxed">
            Ranked among wallets scanned on the analyzer — who holds through drawdown,
            avoids patience tax, and lets winners run. Same behavioral framework the
            live agent scores on itself every cycle.
          </p>
        </div>

        <WalletDiscoveryBridge variant="leaderboard" className="mb-8" />

        <div className="mb-8 flex flex-wrap gap-3">
          <Link
            href="/analyzer"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-signal text-background text-sm font-semibold hover:bg-signal/90 transition-colors"
          >
            Analyze your wallet →
          </Link>
          <Link
            href="/agent"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full border border-border/60 text-sm font-mono text-foreground-muted hover:text-signal hover:border-signal/40 transition-colors"
          >
            Live agent dashboard
          </Link>
        </div>

        <LeaderboardTable initialEntries={entries} />
      </div>
    </main>
  );
}
