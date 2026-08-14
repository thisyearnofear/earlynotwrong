/**
 * Conviction Discovery gate threshold (Ethos).
 * Shared between API routes, the /discovery page, and the TierGate preview.
 *
 * Access gate only (sybil resistance). Ethos never affects ordering or the
 * heatmap cohort — both rank on behavioral conviction. See getAlphaTraders.
 */
export const ALPHA_GATE_SCORE = 1000;
