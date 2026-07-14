/**
 * Market Types
 *
 * Web-facing type aliases and extensions over the shared conviction-core
 * domain model. Keep this file thin: all pure logic lives in conviction-core.
 */

import {
  type LedgerEntry,
  type LedgerPosition,
  type BehavioralMetrics as CoreBehavioralMetrics,
  type ScoreBreakdown,
  type ScoreComponent,
  type PatienceTaxResult,
  type PricePoint,
} from "conviction-core";

export type TokenTransaction = LedgerEntry;

export type TokenPosition = LedgerPosition;

export type ConvictionAnalysis = PatienceTaxResult & {
  exitPrice: number;
  postExitHigh: number;
  potentialGain: number;
  isEarlyExit: boolean;
  daysHeld: number;
};

export type { ScoreComponent, ScoreBreakdown, PricePoint };

export interface ConvictionMetrics extends CoreBehavioralMetrics {
  /** Cohort size when percentile was computed. */
  cohortSize?: number;
}
