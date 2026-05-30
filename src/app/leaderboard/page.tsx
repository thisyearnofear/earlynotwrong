import { Metadata } from "next";
import Link from "next/link";
import { LeaderboardTable } from "@/components/leaderboard/leaderboard-table";
import { APP_CONFIG } from "@/lib/config";
import { getLeaderboard } from "@/lib/db/postgres";

export const metadata: Metadata = {
  title: "Leaderboard | Early, Not Wrong",
  description:
    "Top-performing wallets ranked by conviction score. See who holds through volatility and captures upside.",
  openGraph: {
    title: "Conviction Leaderboard | Early, Not Wrong",
    description:
      "Top-performing wallets ranked by behavioral conviction score.",
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
    <div className="min-h-screen text-foreground">
      <main className="pt-24 pb-12 px-4 sm:px-6 lg:px-8 max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <p className="text-[10px] font-mono text-foreground-muted uppercase tracking-widest mb-3">
            Conviction Leaderboard
          </p>
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-foreground mb-2">
            Top Conviction Scores
          </h1>
          <p className="text-sm text-foreground-muted max-w-xl">
            Wallets ranked by behavioral conviction — how consistently they
            allow upside to compound and cap downside efficiently.
          </p>
        </div>

        {/* CTA */}
        <div className="mb-8">
          <Link
            href="/"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-signal text-background text-sm font-semibold hover:bg-signal/90 transition-colors"
          >
            Analyze Your Wallet →
          </Link>
        </div>

        {/* Table */}
        <LeaderboardTable initialEntries={entries} />
      </main>
    </div>
  );
}
