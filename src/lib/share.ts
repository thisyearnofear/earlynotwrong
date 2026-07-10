/**
 * Share Utilities
 * Generate shareable links and social share URLs for conviction cards.
 */

import { ConvictionMetrics } from "./market";

export interface ShareData {
  id: string;
  score: number;
  archetype: string;
  /** Real cohort rank — null when unavailable; omitted from share copy then. */
  percentile: number | null;
  /** Cohort size behind the percentile, for honest captioning. */
  cohortSize?: number;
  patienceTax: number;
  upsideCapture: number;
  chain: "solana" | "base";
  timestamp: number;
}

export function encodeShareData(
  metrics: ConvictionMetrics,
  chain: "solana" | "base"
): string {
  const data: ShareData = {
    id: generateShareId(),
    score: metrics.score,
    archetype: metrics.archetype || "Diamond Hand",
    percentile: metrics.percentile,
    cohortSize: metrics.cohortSize,
    patienceTax: metrics.patienceTax,
    upsideCapture: metrics.upsideCapture,
    chain,
    timestamp: Date.now(),
  };

  return btoa(JSON.stringify(data));
}

export function decodeShareData(encoded: string): ShareData | null {
  try {
    return JSON.parse(atob(encoded));
  } catch {
    return null;
  }
}

export function generateShareId(): string {
  return Math.random().toString(36).substring(2, 10);
}

import { APP_CONFIG } from "./config";

export function getShareUrl(data: ShareData, baseUrl: string = APP_CONFIG.baseUrl): string {
  const encoded = btoa(JSON.stringify(data));
  return `${baseUrl}/share/${encoded}`;
}

export function getOgImageUrl(data: ShareData, baseUrl: string = APP_CONFIG.baseUrl): string {
  const params = new URLSearchParams({
    score: String(data.score),
    archetype: data.archetype,
    patienceTax: String(data.patienceTax),
    upsideCapture: String(data.upsideCapture),
    chain: data.chain,
  });
  if (data.percentile != null) {
    params.set("percentile", String(data.percentile));
  }

  return `${baseUrl}/api/og?${params.toString()}`;
}

/** "Top X% of analyzed wallets" line, or empty when no real cohort rank exists. */
function percentileLine(data: ShareData): string {
  if (data.percentile == null) return "";
  const cohort = data.cohortSize ? ` (of ${data.cohortSize} analyzed wallets)` : " of analyzed wallets";
  return `Top ${data.percentile}%${cohort}\n`;
}

export function getTwitterShareUrl(data: ShareData, baseUrl: string = APP_CONFIG.baseUrl): string {
  const shareUrl = getShareUrl(data, baseUrl);
  const text = `My Conviction Score: ${data.score}/100 | ${data.archetype}\n\n${percentileLine(data)}Patience Tax: $${data.patienceTax.toLocaleString()}\n\nBeing early feels like being wrong. Until it doesn't.`;

  return `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(shareUrl)}`;
}

export function getFarcasterShareUrl(data: ShareData, baseUrl: string = APP_CONFIG.baseUrl): string {
  const shareUrl = getShareUrl(data, baseUrl);
  const text = `My Conviction Score: ${data.score}/100 | ${data.archetype}\n\n${percentileLine(data)}Being early feels like being wrong. Until it doesn't.`;

  return `https://warpcast.com/~/compose?text=${encodeURIComponent(text)}&embeds[]=${encodeURIComponent(shareUrl)}`;
}

export function copyToClipboard(text: string): Promise<boolean> {
  return navigator.clipboard
    .writeText(text)
    .then(() => true)
    .catch(() => false);
}
