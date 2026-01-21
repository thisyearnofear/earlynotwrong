import { Metadata } from "next";
import { decodeShareData, getOgImageUrl } from "@/lib/share";
import { redirect } from "next/navigation";

interface SharePageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({
  params,
}: SharePageProps): Promise<Metadata> {
  const { id } = await params;
  const data = decodeShareData(id);

  if (!data) {
    return {
      title: "Early, Not Wrong",
      description: "Conviction analysis for asymmetric markets",
    };
  }

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "https://earlynotwrong.com";
  const ogImageUrl = getOgImageUrl(data, baseUrl);

  const title = `Conviction Score: ${data.score} | ${data.archetype}`;
  const description = `Top ${data.percentile}% of traders. Patience Tax: $${data.patienceTax.toLocaleString()}. Upside Capture: ${data.upsideCapture}%. Being early feels like being wrong. Until it doesn't.`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      images: [
        {
          url: ogImageUrl,
          width: 1200,
          height: 630,
          alt: `Conviction Score: ${data.score}`,
        },
      ],
      type: "website",
      siteName: "Early, Not Wrong",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [ogImageUrl],
    },
  };
}

export default async function SharePage({ params }: SharePageProps) {
  const { id } = await params;
  const data = decodeShareData(id);

  if (!data) {
    redirect("/");
  }

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "https://earlynotwrong.com";
  const ogImageUrl = getOgImageUrl(data, baseUrl);

  const archetypeDescriptions: Record<string, string> = {
    "Iron Pillar": "Rare trades, large outcome dispersion, thesis-driven exits",
    "Profit Phantom": "Often underwater initially, disproportionate upside capture",
    "Exit Voyager": "High turnover, frequent early exits, low asymmetry",
    "Diamond Hand": "Holds through volatility, balanced conviction",
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-4xl mx-auto px-4 py-12">
        <div className="text-center mb-8">
          <p className="text-xs font-mono text-foreground-muted uppercase tracking-widest mb-4">
            Conviction Analysis • {data.chain.toUpperCase()}
          </p>
          <h1 className="text-6xl md:text-8xl font-bold text-foreground mb-4">
            {data.score}
          </h1>
          <div className="inline-flex items-center gap-3 px-4 py-2 rounded-full bg-signal/10 border border-signal/30">
            <span className="text-xl font-semibold text-signal">
              {data.archetype}
            </span>
            <span className="text-sm text-foreground-muted">
              Top {data.percentile}%
            </span>
          </div>
        </div>

        <div className="mb-8">
          <img
            src={ogImageUrl}
            alt={`Conviction Score: ${data.score}`}
            className="w-full rounded-lg border border-border shadow-2xl"
          />
        </div>

        <div className="grid grid-cols-2 gap-6 mb-8">
          <div className="p-6 rounded-lg bg-surface border border-border text-center">
            <p className="text-xs font-mono text-foreground-muted uppercase tracking-wider mb-2">
              Patience Tax
            </p>
            <p className="text-3xl font-bold text-impatience font-mono">
              ${data.patienceTax.toLocaleString()}
            </p>
          </div>
          <div className="p-6 rounded-lg bg-surface border border-border text-center">
            <p className="text-xs font-mono text-foreground-muted uppercase tracking-wider mb-2">
              Upside Capture
            </p>
            <p className="text-3xl font-bold text-patience font-mono">
              {data.upsideCapture}%
            </p>
          </div>
        </div>

        <div className="p-6 rounded-lg bg-surface/50 border border-border mb-8">
          <h2 className="text-lg font-semibold text-foreground mb-2">
            {data.archetype}
          </h2>
          <p className="text-foreground-muted">
            {archetypeDescriptions[data.archetype] || "Behavioral analysis based on on-chain trading patterns."}
          </p>
        </div>

        <div className="text-center">
          <a
            href="/"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-signal text-background font-semibold hover:bg-signal/90 transition-colors"
          >
            Analyze Your Wallet
          </a>
          <p className="mt-4 text-sm text-foreground-muted">
            Being early feels like being wrong. Until it doesn&apos;t.
          </p>
        </div>
      </div>
    </div>
  );
}
