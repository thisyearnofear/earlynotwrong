/**
 * Crypto volatility pricing baseline — the quantitative anchor for
 * threshold-style crypto markets ("Will BTC close above $150k on Aug 24?").
 *
 * Instead of asking an LLM to price a log-normal process from vibes, we
 * compute it: P(close > threshold at expiry) from the current spot price,
 * realized daily volatility (from SoSoValue klines), and time to expiry.
 *
 * Model: driftless log-normal diffusion (risk-neutral-ish; drift over a
 * 1-14 day window is unidentifiable noise, vol is not). P(S_T > K) =
 * Φ(ln(S0/K) / (σ·√T)), where Φ is the standard normal CDF.
 *
 * This is the Delphi analog of the edge report's naive baseline: a computed
 * reference probability the LLM estimate gets blended with (and, for crypto
 * threshold markets where parsing + pricing succeed, can replace entirely
 * when the LLM is unavailable). Pure functions, zero inference cost.
 */

// =============================================================================
// Normal CDF (Abramowitz–Stegun erf approximation)
// =============================================================================

/**
 * Standard normal CDF. Abramowitz–Stegun 7.1.26 via erf — accurate to
 * ~1e-7, plenty for probability pricing.
 */
export function normCdf(z: number): number {
  // Φ(z) = 0.5 * (1 + erf(z / √2))
  const x = z / Math.SQRT2;
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const poly =
    t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf = 1 - poly * Math.exp(-ax * ax);
  return 0.5 * (1 + sign * erf);
}

// =============================================================================
// Realized volatility from klines
// =============================================================================

/**
 * Annualized-free realized DAILY volatility from a series of closes:
 * the standard deviation of log returns. Returns null with fewer than 3
 * closes (no variance to estimate).
 */
export function estimateDailyVolFromCloses(closes: number[]): number | null {
  const valid = closes.filter((c) => typeof c === "number" && c > 0);
  if (valid.length < 3) return null;
  const logReturns: number[] = [];
  for (let i = 1; i < valid.length; i++) {
    logReturns.push(Math.log(valid[i] / valid[i - 1]));
  }
  const mean = logReturns.reduce((a, b) => a + b, 0) / logReturns.length;
  const variance =
    logReturns.reduce((acc, r) => acc + (r - mean) ** 2, 0) / (logReturns.length - 1);
  const vol = Math.sqrt(variance);
  if (!Number.isFinite(vol) || vol <= 0) return null;
  // Sanity clamp: crypto daily vol lives in roughly [0.5%, 30%].
  return Math.min(0.3, Math.max(0.005, vol));
}

// =============================================================================
// Threshold probability
// =============================================================================

export interface CryptoThresholdInput {
  /** Current spot price of the asset. */
  spotPrice: number;
  /** Realized daily volatility (from estimateDailyVolFromCloses). */
  volDaily: number;
  /** Days until the market's resolution date. */
  daysToExpiry: number;
  /** The price threshold in the market question. */
  threshold: number;
}

/**
 * P(close above threshold at expiry) under the driftless log-normal model.
 * Returns null for degenerate inputs (non-positive price/vol/expiry, or the
 * expiry already passed).
 */
export function cryptoThresholdProbability(input: CryptoThresholdInput): number | null {
  const { spotPrice, volDaily, daysToExpiry, threshold } = input;
  if (spotPrice <= 0 || volDaily <= 0 || daysToExpiry <= 0 || threshold <= 0) return null;
  const t = daysToExpiry; // daily vol → T in days
  const z = Math.log(spotPrice / threshold) / (volDaily * Math.sqrt(t));
  const p = normCdf(z);
  // Clamp away from 0/1 — same convention as the LLM path, keeps the edge
  // gate and Brier scoring well-behaved at extremes.
  return Math.min(0.99, Math.max(0.01, p));
}

// =============================================================================
// Market question parsing
// =============================================================================

/**
 * Extract a USD price threshold from a market question. Handles
 * "$150,000", "$150k", "$1.5M", "150000 USD", with or without "above".
 * Returns the threshold number, or null when the question has no parseable
 * price level (multi-outcome ranges, non-threshold markets).
 */
export function parsePriceThreshold(question: string): number | null {
  // Order matters: match "$X k/M" with multipliers first, then plain $ amounts.
  const patterns = [
    /\$\s?([\d,]+(?:\.\d+)?)\s?(k|K)\b/, // $150k
    /\$\s?([\d,]+(?:\.\d+)?)\s?(m|M)\b/, // $1.5M
    /\$\s?([\d,]+(?:\.\d+)?)/, // $150,000 or $150000
    /([\d,]+(?:\.\d+)?)\s*(?:USD|dollars)\b/i, // 150000 USD
  ];
  for (const re of patterns) {
    const m = question.match(re);
    if (!m) continue;
    const value = parseFloat(m[1].replace(/,/g, ""));
    if (!Number.isFinite(value) || value <= 0) continue;
    const suffix = m[2]?.toLowerCase();
    const multiplier = suffix === "k" ? 1_000 : suffix === "m" ? 1_000_000 : 1;
    return value * multiplier;
  }
  return null;
}

/**
 * Extract a resolution date from a market question and return days from
 * `now` until it. Matches "on Aug 24", "by August 24", "on 2026-08-24",
 * "before Sep 1", "by the end of August 2026". Returns null when no date is
 * found or it's in the past.
 */
export function parseDaysToExpiry(question: string, now: number = Date.now()): number | null {
  const MONTHS: Record<string, number> = {
    january: 0, jan: 0, february: 1, feb: 1, march: 2, mar: 2, april: 3, apr: 3,
    may: 4, june: 5, jun: 5, july: 6, jul: 6, august: 7, aug: 7,
    september: 8, sep: 8, sept: 8, october: 9, oct: 9, november: 10, nov: 10,
    december: 11, dec: 11,
  };

  const monthDay = question.match(
    /\b(?:on|by|before|until)\s+([A-Za-z]+)\.? (\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b/i,
  );
  const iso = question.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  const endOfMonth = question.match(/\b(?:by|before)\s+the\s+end\s+of\s+([A-Za-z]+)\s+(\d{4})\b/i);

  let date: Date | null = null;
  const current = new Date(now);

  if (iso) {
    date = new Date(Date.UTC(+iso[1], +iso[2] - 1, +iso[3]));
  } else if (endOfMonth) {
    const monthIdx = MONTHS[endOfMonth[1].toLowerCase()];
    const year = +endOfMonth[2];
    if (monthIdx !== undefined && year >= 2000) {
      date = new Date(Date.UTC(year, monthIdx + 1, 0)); // last day of month
    }
  } else if (monthDay) {
    const monthIdx = MONTHS[monthDay[1].toLowerCase()];
    if (monthIdx !== undefined) {
      let year = monthDay[3] ? +monthDay[3] : current.getUTCFullYear();
      const day = +monthDay[2];
      // "by Aug 24" with no year, and the date already passed this year →
      // assume next year only for short-dated markets? No: a prediction
      // market resolves in the future, but an ambiguous past date this year
      // means the question is malformed for pricing — return null rather
      // than guess.
      date = new Date(Date.UTC(year, monthIdx, day));
      if (year === current.getUTCFullYear() && date.getTime() < now) {
        date = null;
      }
    }
  }

  if (!date) return null;
  const days = (date.getTime() - now) / 86_400_000;
  return days > 0 ? days : null;
}

/**
 * Recognized crypto asset keywords per symbol, matched against the question
 * text. Deliberately conservative — only assets we can price from the
 * SoSoValue feed get a vol baseline.
 */
export function detectCryptoSymbol(question: string): string | null {
  const q = question.toLowerCase();
  const patterns: Array<[string, RegExp]> = [
    ["BTC", /\b(bitcoin|btc)\b/],
    ["ETH", /\b(ethereum|ether|eth)\b/],
    ["SOL", /\b(solana|sol)\b/],
    ["XRP", /\b(xrp|ripple)\b/],
    ["BNB", /\b(bnb|binance coin)\b/],
    ["DOGE", /\b(dogecoin|doge)\b/],
    ["ADA", /\b(cardano|ada)\b/],
  ];
  for (const [symbol, re] of patterns) {
    if (re.test(q)) return symbol;
  }
  return null;
}

/**
 * Which side of the threshold the market's Yes outcome asks about.
 * `cryptoThresholdProbability` always prices the ABOVE side; questions
 * phrased "at or below $K" need the complement.
 */
export type ThresholdDirection = "above" | "below";

/**
 * Detect whether a threshold question asks about prices ABOVE or BELOW
 * the parsed level. Returns null when the wording is ambiguous — callers
 * must then skip the vol blend (no baseline is better than a flipped one).
 */
export function detectThresholdDirection(question: string): ThresholdDirection | null {
  const q = question.toLowerCase();
  if (/\b(above|higher|or more|at or above|exceeds?|overs?|reach(?:es)?|hits?)\b/.test(q)) {
    return "above";
  }
  if (/\b(below|lower|under|at or below|less than|falls? short)\b/.test(q)) {
    return "below";
  }
  return null;
}

/**
 * One-call convenience: does this question look like a priceable crypto
 * threshold market? Returns the parsed pieces (incl. direction), or null
 * when any part fails — including when the direction can't be detected.
 * `category` gates the whole thing — only crypto-category markets qualify.
 */
export function matchCryptoThresholdMarket(
  question: string,
  category: string | undefined,
  now: number = Date.now(),
): { symbol: string; threshold: number; daysToExpiry: number; direction: ThresholdDirection } | null {
  if (category && category.toLowerCase() !== "crypto") return null;
  const symbol = detectCryptoSymbol(question);
  if (!symbol) return null;
  const threshold = parsePriceThreshold(question);
  if (threshold === null) return null;
  const daysToExpiry = parseDaysToExpiry(question, now);
  if (daysToExpiry === null) return null;
  const direction = detectThresholdDirection(question);
  if (direction === null) return null;
  return { symbol, threshold, daysToExpiry, direction };
}
