/**
 * Share Utilities
 * Generate shareable links and social share URLs for conviction cards.
 */

import { ConvictionMetrics } from "./market";

export interface ShareData {
  id: string;
  score: number;
  archetype: string;
  percentile: number;
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
    percentile: String(data.percentile),
    patienceTax: String(data.patienceTax),
    upsideCapture: String(data.upsideCapture),
    chain: data.chain,
  });

  return `${baseUrl}/api/og?${params.toString()}`;
}

export function getTwitterShareUrl(data: ShareData, baseUrl: string = APP_CONFIG.baseUrl): string {
  const shareUrl = getShareUrl(data, baseUrl);
  const text = `My Conviction Score: ${data.score}/100 | ${data.archetype}\n\nTop ${data.percentile}% of traders\nPatience Tax: $${data.patienceTax.toLocaleString()}\n\nBeing early feels like being wrong. Until it doesn't.`;

  return `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(shareUrl)}`;
}

export function getFarcasterShareUrl(data: ShareData, baseUrl: string = APP_CONFIG.baseUrl): string {
  const shareUrl = getShareUrl(data, baseUrl);
  const text = `My Conviction Score: ${data.score}/100 | ${data.archetype}\n\nTop ${data.percentile}% of traders. Being early feels like being wrong. Until it doesn't.`;

  return `https://warpcast.com/~/compose?text=${encodeURIComponent(text)}&embeds[]=${encodeURIComponent(shareUrl)}`;
}

export function copyToClipboard(text: string): Promise<boolean> {
  return navigator.clipboard
    .writeText(text)
    .then(() => true)
    .catch(() => false);
}
