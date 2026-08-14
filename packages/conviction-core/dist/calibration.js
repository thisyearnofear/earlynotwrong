/**
 * Calibration scoring for probability forecasts.
 *
 * The behavioral metrics in `scoring.ts` grade *holding behavior* (win rate,
 * upside capture, patience tax). Prediction markets grade *estimation
 * accuracy*: how close were the agent's probability forecasts to realized
 * outcomes? This module provides the pure functions for that yardstick —
 * Brier score, log loss, hit rate, and a reliability diagram.
 *
 * A forecast of 0.62 on an outcome that happens scores (1 − 0.62)² = 0.1444
 * Brier points; a forecast of 0.62 that misses scores 0.3844. Lower Brier is
 * better; 0 is perfect, 0.25 is "always say 50/50". The reliability buckets
 * answer "when the agent says 60–70%, does it happen 60–70% of the time?"
 */
// =============================================================================
// Core scores
// =============================================================================
/**
 * Brier score: mean (forecast − outcome)² over resolved forecasts.
 * Returns null when there are no resolved forecasts.
 */
export function brierScore(forecasts) {
    const resolved = forecasts.filter((f) => f.outcome !== undefined);
    if (resolved.length === 0)
        return null;
    const sum = resolved.reduce((acc, f) => acc + (f.forecast - f.outcome) ** 2, 0);
    return sum / resolved.length;
}
/**
 * Log loss: mean −log(p) where p is the probability assigned to the realized
 * outcome. Forecasts are clamped to [1e-6, 1 − 1e-6] so a confident wrong
 * forecast produces a large but finite penalty. Returns null when nothing is
 * resolved.
 */
export function logLoss(forecasts) {
    const resolved = forecasts.filter((f) => f.outcome !== undefined);
    if (resolved.length === 0)
        return null;
    const sum = resolved.reduce((acc, f) => {
        const p = Math.min(1 - 1e-6, Math.max(1e-6, f.forecast));
        const likelihood = f.outcome === 1 ? p : 1 - p;
        return acc - Math.log(likelihood);
    }, 0);
    return sum / resolved.length;
}
/**
 * Hit rate: fraction of resolved forecasts on the correct side of 50%
 * (forecast > 0.5 and outcome 1, or forecast < 0.5 and outcome 0).
 * Forecasts of exactly 0.5 count as misses — a coin call claims no edge.
 * Returns null when nothing is resolved.
 */
export function hitRate(forecasts) {
    const resolved = forecasts.filter((f) => f.outcome !== undefined);
    if (resolved.length === 0)
        return null;
    const hits = resolved.filter((f) => (f.forecast > 0.5 && f.outcome === 1) || (f.forecast < 0.5 && f.outcome === 0)).length;
    return hits / resolved.length;
}
// =============================================================================
// Reliability diagram
// =============================================================================
/**
 * 10 equal-width reliability buckets over the RESOLVED forecasts. Empty bins
 * are still returned (count 0, nulls) so consumers can render a stable
 * 10-column diagram without special-casing.
 */
export function reliabilityBuckets(forecasts) {
    const resolved = forecasts.filter((f) => f.outcome !== undefined);
    const buckets = [];
    for (let b = 0; b < 10; b++) {
        const lower = b / 10;
        const upper = (b + 1) / 10;
        const inBin = resolved.filter((f) => f.forecast >= lower && (b === 9 ? f.forecast <= upper : f.forecast < upper));
        if (inBin.length === 0) {
            buckets.push({ bucket: b, lower, upper, count: 0, meanForecast: null, meanOutcome: null, gap: null });
            continue;
        }
        const meanForecast = inBin.reduce((a, f) => a + f.forecast, 0) / inBin.length;
        const meanOutcome = inBin.reduce((a, f) => a + f.outcome, 0) / inBin.length;
        buckets.push({
            bucket: b,
            lower,
            upper,
            count: inBin.length,
            meanForecast,
            meanOutcome,
            gap: Math.abs(meanForecast - meanOutcome),
        });
    }
    return buckets;
}
/**
 * Full calibration report over a forecast set — the single entry point for
 * consumers (agent runner, post-mortem report, dashboard).
 */
export function calculateCalibrationMetrics(forecasts) {
    const resolved = forecasts.filter((f) => f.outcome !== undefined);
    return {
        resolved: resolved.length,
        unresolved: forecasts.length - resolved.length,
        brierScore: brierScore(forecasts),
        logLoss: logLoss(forecasts),
        hitRate: hitRate(forecasts),
        buckets: reliabilityBuckets(forecasts),
    };
}
