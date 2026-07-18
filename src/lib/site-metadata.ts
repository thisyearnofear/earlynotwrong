import type { Metadata } from "next";

/** Canonical public site URL (no trailing slash). */
export function getSiteUrl(): string {
  const raw = process.env.NEXT_PUBLIC_APP_URL || "https://earlynotwrong.vercel.app";
  return raw.startsWith("http") ? raw.replace(/\/$/, "") : `https://${raw.replace(/\/$/, "")}`;
}

export const SITE = {
  name: "Early, Not Wrong",
  shortName: "ENW",
  tagline: "Early feels wrong. Until it doesn't.",
  category: "Conviction infrastructure",
  description:
    "Autonomous conviction agent with on-chain proof, behavioral wallet analysis, and hireable live signals.",
  twitterHandle: "@earlynotwrong",
} as const;

const OG_WIDTH = 1200;
const OG_HEIGHT = 630;

/** Brand card for site links — never use bare `/api/og` (that used to render a fake score-0 share). */
export function ogBrandImageUrl(baseUrl: string = getSiteUrl()): string {
  return `${baseUrl}/api/og?variant=brand`;
}

export function ogShareImageUrl(
  params: Record<string, string>,
  baseUrl: string = getSiteUrl(),
): string {
  const qs = new URLSearchParams({ ...params, variant: "share" });
  return `${baseUrl}/api/og?${qs.toString()}`;
}

export const OG_IMAGE_SIZE = { width: OG_WIDTH, height: OG_HEIGHT } as const;

type PageMetaKey = "home" | "agent" | "analyzer" | "discovery" | "leaderboard";

const PAGE_COPY: Record<
  PageMetaKey,
  { title: string; description: string; path: string }
> = {
  home: {
    title: SITE.name,
    description: SITE.description,
    path: "/",
  },
  agent: {
    title: "Autonomous Agent",
    description:
      "Live conviction cycles, on-chain thesis anchors, and hireable signals — BSC trading with verifiable proof.",
    path: "/agent",
  },
  analyzer: {
    title: "Wallet Analyzer",
    description:
      "Audit any wallet for behavioral conviction — patience tax, upside capture, and archetype scoring.",
    path: "/analyzer",
  },
  discovery: {
    title: "Conviction Discovery",
    description:
      "Ethos-weighted trader list and token heatmap from analyzed wallet ledgers.",
    path: "/discovery",
  },
  leaderboard: {
    title: "Conviction Leaderboard",
    description:
      "Community wallet scans ranked by behavioral conviction — compare to the live autonomous agent.",
    path: "/leaderboard",
  },
};

function ogImageMeta(baseUrl: string) {
  return [
    {
      url: ogBrandImageUrl(baseUrl),
      width: OG_WIDTH,
      height: OG_HEIGHT,
      alt: `${SITE.name} — ${SITE.category}`,
    },
  ];
}

/** Root layout defaults (home). */
export function buildRootMetadata(baseUrl: string = getSiteUrl()): Metadata {
  return {
    metadataBase: new URL(baseUrl),
    title: {
      default: SITE.name,
      template: `%s | ${SITE.name}`,
    },
    description: SITE.description,
    openGraph: {
      title: SITE.name,
      description: SITE.description,
      url: baseUrl,
      siteName: SITE.name,
      images: ogImageMeta(baseUrl),
      locale: "en_US",
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: SITE.name,
      description: SITE.description,
      images: [ogBrandImageUrl(baseUrl)],
      creator: SITE.twitterHandle,
    },
  };
}

/** Per-route metadata — same brand OG image, route-specific title/description. */
export function buildPageMetadata(
  page: PageMetaKey,
  baseUrl: string = getSiteUrl(),
): Metadata {
  const copy = PAGE_COPY[page];
  const url = `${baseUrl}${copy.path}`;
  const title = page === "home" ? SITE.name : copy.title;

  return {
    title: copy.title,
    description: copy.description,
    openGraph: {
      title,
      description: copy.description,
      url,
      siteName: SITE.name,
      images: ogImageMeta(baseUrl),
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description: copy.description,
      images: [ogBrandImageUrl(baseUrl)],
    },
  };
}
