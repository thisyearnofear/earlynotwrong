/**
 * Small pure helpers used across the conviction framework.
 */

/** Clamp a number to [min, max]. */
export function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/** Round to one decimal place. */
export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Round to two decimal places. */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
