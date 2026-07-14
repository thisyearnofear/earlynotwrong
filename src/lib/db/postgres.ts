/**
 * Postgres Database Client
 * Uses Vercel Postgres (Neon) for persistent storage
 */

import { sql, db } from "@vercel/postgres";
import { ConvictionMetrics } from "../market";

// =============================================================================
// Types
// =============================================================================

export interface StoredAnalysis {
  id: number;
  address: string;
  chain: "solana" | "base";
  score: number;
  patienceTax: number;
  upsideCapture: number;
  earlyExits: number;
  convictionWins: number;
  percentile: number;
  archetype: string | null;
  totalPositions: number;
  avgHoldingPeriod: number;
  winRate: number;
  timeHorizon: number;
  analyzedAt: Date;
  ensName: string | null;
  farcasterUsername: string | null;
  ethosScore: number | null;
  unifiedTrustScore: number | null;
  unifiedTrustTier: string | null;
}

export interface WatchlistTrader {
  id: number;
  traderId: string;
  name: string;
  chain: "solana" | "base";
  wallets: string[];
  farcaster: string | null;
  twitter: string | null;
  ens: string | null;
  addedBy: string | null;
  addedByEthos: number;
  addedAt: Date;
  status: "nominated" | "approved" | "featured" | "rejected";
  endorsementCount: number;
  isActive: boolean;
  avgConvictionScore: number | null;
  totalAnalyses: number;
}

export interface CohortStats {
  chain: string;
  totalWallets: number;
  avgScore: number;
  medianScore: number;
  avgPatienceTax: number;
  avgWinRate: number;
  mostCommonArchetype: string;
}

// =============================================================================
// Analysis Storage
// =============================================================================

/**
 * Save a conviction analysis to the database
 */
export async function saveAnalysis(
  address: string,
  chain: "solana" | "base",
  metrics: ConvictionMetrics,
  timeHorizon: number = 30,
  identity?: {
    ensName?: string;
    farcasterUsername?: string;
    ethosScore?: number;
    unifiedTrustScore?: number;
    unifiedTrustTier?: string;
    scoutedBy?: string;
    scoutEthosScore?: number;
  }
): Promise<StoredAnalysis | null> {
  try {
    const result = await sql`
      INSERT INTO conviction_analyses (
        address, chain, score, patience_tax, upside_capture,
        early_exits, conviction_wins, percentile, archetype,
        total_positions, avg_holding_period, win_rate, time_horizon,
        ens_name, farcaster_username, ethos_score,
        unified_trust_score, unified_trust_tier,
        scouted_by, scout_ethos_score
      ) VALUES (
        ${address.toLowerCase()},
        ${chain},
        ${metrics.score},
        ${metrics.patienceTax},
        ${metrics.upsideCapture},
        ${metrics.earlyExits},
        ${metrics.convictionWins},
        ${metrics.percentile ?? 0},
        ${metrics.archetype || null},
        ${metrics.totalPositions},
        ${metrics.avgHoldingPeriod},
        ${metrics.winRate},
        ${timeHorizon},
        ${identity?.ensName || null},
        ${identity?.farcasterUsername || null},
        ${identity?.ethosScore || null},
        ${identity?.unifiedTrustScore || null},
        ${identity?.unifiedTrustTier || null},
        ${identity?.scoutedBy || null},
        ${identity?.scoutEthosScore || null}
      )
      ON CONFLICT (address, chain, time_horizon, analyzed_date)
      DO UPDATE SET
        score = EXCLUDED.score,
        patience_tax = EXCLUDED.patience_tax,
        upside_capture = EXCLUDED.upside_capture,
        early_exits = EXCLUDED.early_exits,
        conviction_wins = EXCLUDED.conviction_wins,
        percentile = EXCLUDED.percentile,
        archetype = EXCLUDED.archetype,
        total_positions = EXCLUDED.total_positions,
        avg_holding_period = EXCLUDED.avg_holding_period,
        win_rate = EXCLUDED.win_rate,
        unified_trust_score = EXCLUDED.unified_trust_score,
        unified_trust_tier = EXCLUDED.unified_trust_tier,
        scouted_by = COALESCE(conviction_analyses.scouted_by, EXCLUDED.scouted_by),
        scout_ethos_score = COALESCE(conviction_analyses.scout_ethos_score, EXCLUDED.scout_ethos_score),
        analyzed_at = CURRENT_TIMESTAMP
      RETURNING *
    `;

    return mapAnalysisRow(result.rows[0]);
  } catch (error) {
    console.warn("Failed to save analysis to Postgres:", error);
    return null;
  }
}

/**
 * Get recent analyses for an address
 */
export async function getAnalysesByAddress(
  address: string,
  limit: number = 10
): Promise<StoredAnalysis[]> {
  try {
    const result = await sql`
      SELECT * FROM conviction_analyses
      WHERE address = ${address.toLowerCase()}
      ORDER BY analyzed_at DESC
      LIMIT ${limit}
    `;

    return result.rows.map(mapAnalysisRow);
  } catch (error) {
    console.warn("Failed to fetch analyses:", error);
    return [];
  }
}

/**
 * Cohort rank for a score among stored analyses (last 90 days).
 *
 * Returns the honest "Top X%" figure plus the cohort size so the UI can
 * caption it ("among N analyzed wallets"). Returns null when the DB is
 * unavailable or the cohort is too small for a rank to mean anything —
 * callers must omit the stat rather than show a made-up number.
 */
export async function getCohortPercentile(
  score: number,
  chain?: "solana" | "base"
): Promise<{ topPercent: number; cohortSize: number } | null> {
  const MIN_COHORT_SIZE = 5;
  try {
    const result = chain
      ? await sql`
          SELECT COUNT(*) as total,
                 COUNT(*) FILTER (WHERE score < ${score}) as below
          FROM conviction_analyses
          WHERE chain = ${chain}
            AND analyzed_at > NOW() - INTERVAL '90 days'
        `
      : await sql`
          SELECT COUNT(*) as total,
                 COUNT(*) FILTER (WHERE score < ${score}) as below
          FROM conviction_analyses
          WHERE analyzed_at > NOW() - INTERVAL '90 days'
        `;

    const total = Number(result.rows[0]?.total ?? 0);
    const below = Number(result.rows[0]?.below ?? 0);
    if (total < MIN_COHORT_SIZE) return null;

    const topPercent = Math.max(
      1,
      Math.min(99, Math.round(100 - (below / total) * 100))
    );
    return { topPercent, cohortSize: total };
  } catch (error) {
    console.warn("Failed to calculate cohort percentile:", error);
    return null;
  }
}

/**
 * Get cohort statistics for comparison
 */
export async function getCohortStats(
  chain?: "solana" | "base"
): Promise<CohortStats | null> {
  try {
    const result = chain
      ? await sql`
          SELECT * FROM cohort_stats WHERE chain = ${chain}
        `
      : await sql`
          SELECT 
            'all' as chain,
            SUM(total_wallets) as total_wallets,
            AVG(avg_score) as avg_score,
            AVG(median_score) as median_score,
            AVG(avg_patience_tax) as avg_patience_tax,
            AVG(avg_win_rate) as avg_win_rate,
            MODE() WITHIN GROUP (ORDER BY most_common_archetype) as most_common_archetype
          FROM cohort_stats
        `;

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    return {
      chain: row.chain,
      totalWallets: Number(row.total_wallets),
      avgScore: Number(row.avg_score),
      medianScore: Number(row.median_score),
      avgPatienceTax: Number(row.avg_patience_tax),
      avgWinRate: Number(row.avg_win_rate),
      mostCommonArchetype: row.most_common_archetype,
    };
  } catch (error) {
    console.warn("Failed to get cohort stats:", error);
    return null;
  }
}

/**
 * Get leaderboard of top conviction scores
 */
export async function getLeaderboard(
  chain?: "solana" | "base",
  limit: number = 20
): Promise<StoredAnalysis[]> {
  try {
    const result = chain
      ? await sql`
          SELECT DISTINCT ON (address) *
          FROM conviction_analyses
          WHERE chain = ${chain}
          ORDER BY address, score DESC, analyzed_at DESC
          LIMIT ${limit}
        `
      : await sql`
          SELECT DISTINCT ON (address) *
          FROM conviction_analyses
          ORDER BY address, score DESC, analyzed_at DESC
          LIMIT ${limit}
        `;

    return result.rows.map(mapAnalysisRow).sort((a, b) => b.score - a.score);
  } catch (error) {
    console.warn("Failed to get leaderboard:", error);
    return [];
  }
}

// =============================================================================
// Watchlist Management
// =============================================================================

/**
 * Get all active watchlist traders
 */
export async function getWatchlist(
  chain?: "solana" | "base"
): Promise<WatchlistTrader[]> {
  try {
    const result = chain
      ? await sql`
          SELECT * FROM watchlist_traders
          WHERE is_active = true AND chain = ${chain}
          ORDER BY added_at DESC
        `
      : await sql`
          SELECT * FROM watchlist_traders
          WHERE is_active = true
          ORDER BY added_at DESC
        `;

    return result.rows.map(mapWatchlistRow);
  } catch (error) {
    console.warn("Failed to get watchlist:", error);
    return [];
  }
}

/**
 * Input type for adding to watchlist (only required fields)
 */
export interface AddWatchlistInput {
  traderId: string;
  name: string;
  chain: "solana" | "base";
  wallets: string[];
  farcaster?: string | null;
  twitter?: string | null;
  ens?: string | null;
  addedBy?: string | null;
  addedByEthos?: number;
  status?: "nominated" | "approved" | "featured";
}

/**
 * Add a trader to the watchlist
 */
export async function addToWatchlist(
  trader: AddWatchlistInput
): Promise<WatchlistTrader | null> {
  try {
    // Serialize wallets array as Postgres array literal
    const walletsArray = `{${trader.wallets.map((w) => `"${w}"`).join(",")}}`;

    const result = await sql`
      INSERT INTO watchlist_traders (
        trader_id, name, chain, wallets, farcaster, twitter, ens, added_by, added_by_ethos, status
      ) VALUES (
        ${trader.traderId},
        ${trader.name},
        ${trader.chain},
        ${walletsArray}::text[],
        ${trader.farcaster || null},
        ${trader.twitter || null},
        ${trader.ens || null},
        ${trader.addedBy || null},
        ${trader.addedByEthos || 0},
        ${trader.status || "approved"}
      )
      ON CONFLICT (trader_id) DO UPDATE SET
        name = EXCLUDED.name,
        wallets = EXCLUDED.wallets,
        farcaster = EXCLUDED.farcaster,
        twitter = EXCLUDED.twitter,
        ens = EXCLUDED.ens,
        is_active = true
      RETURNING *
    `;

    return mapWatchlistRow(result.rows[0]);
  } catch (error) {
    console.warn("Failed to add to watchlist:", error);
    return null;
  }
}

/**
 * Remove a trader from the watchlist (soft delete)
 */
export async function removeFromWatchlist(traderId: string): Promise<boolean> {
  try {
    await sql`
      UPDATE watchlist_traders
      SET is_active = false
      WHERE trader_id = ${traderId}
    `;
    return true;
  } catch (error) {
    console.warn("Failed to remove from watchlist:", error);
    return false;
  }
}

/**
 * Get all wallet addresses from watchlist
 */
export async function getWatchlistAddresses(
  chain?: "solana" | "base"
): Promise<string[]> {
  try {
    const traders = await getWatchlist(chain);
    return traders.flatMap((t) => t.wallets);
  } catch {
    return [];
  }
}

// =============================================================================
// Helpers
// =============================================================================

function mapAnalysisRow(row: Record<string, unknown>): StoredAnalysis {
  return {
    id: row.id as number,
    address: row.address as string,
    chain: row.chain as "solana" | "base",
    score: Number(row.score),
    patienceTax: Number(row.patience_tax),
    upsideCapture: Number(row.upside_capture),
    earlyExits: Number(row.early_exits),
    convictionWins: Number(row.conviction_wins),
    percentile: Number(row.percentile),
    archetype: row.archetype as string | null,
    totalPositions: Number(row.total_positions),
    avgHoldingPeriod: Number(row.avg_holding_period),
    winRate: Number(row.win_rate),
    timeHorizon: Number(row.time_horizon),
    analyzedAt: new Date(row.analyzed_at as string),
    ensName: row.ens_name as string | null,
    farcasterUsername: row.farcaster_username as string | null,
    ethosScore: row.ethos_score ? Number(row.ethos_score) : null,
    unifiedTrustScore: row.unified_trust_score ? Number(row.unified_trust_score) : null,
    unifiedTrustTier: row.unified_trust_tier as string | null,
  };
}

function mapWatchlistRow(row: Record<string, unknown>): WatchlistTrader {
  return {
    id: row.id as number,
    traderId: row.trader_id as string,
    name: row.name as string,
    chain: row.chain as "solana" | "base",
    wallets: row.wallets as string[],
    farcaster: row.farcaster as string | null,
    twitter: row.twitter as string | null,
    ens: row.ens as string | null,
    addedBy: row.added_by as string | null,
    addedByEthos: Number(row.added_by_ethos) || 0,
    addedAt: new Date(row.added_at as string),
    status: (row.status as WatchlistTrader["status"]) || "approved",
    endorsementCount: Number(row.endorsement_count) || 0,
    isActive: row.is_active as boolean,
    avgConvictionScore: row.avg_conviction_score ? Number(row.avg_conviction_score) : null,
    totalAnalyses: Number(row.total_analyses) || 0,
  };
}

// =============================================================================
// Personal Watchlist (My Radar)
// =============================================================================

export interface PersonalWatchlistEntry {
  id: number;
  userAddress: string;
  watchedAddress: string;
  chain: "solana" | "base";
  name: string | null;
  tags: string[];
  createdAt: Date;
  // Enriched data from latest analysis
  latestScore?: number;
  latestArchetype?: string | null;
  latestAnalyzedAt?: Date;
}

/**
 * Get a user's personal watchlist with live analysis data
 */
export async function getPersonalWatchlist(
  userAddress: string
): Promise<PersonalWatchlistEntry[]> {
  try {
    // Join with the latest analysis for each watched wallet to show fresh data
    const result = await sql`
      SELECT 
        pw.*,
        ca.score as latest_score,
        ca.archetype as latest_archetype,
        ca.analyzed_at as latest_analyzed_at
      FROM personal_watchlists pw
      LEFT JOIN LATERAL (
        SELECT score, archetype, analyzed_at
        FROM conviction_analyses ca
        WHERE ca.address = pw.watched_address
          AND ca.chain = pw.chain
        ORDER BY ca.analyzed_at DESC
        LIMIT 1
      ) ca ON true
      WHERE pw.user_address = ${userAddress.toLowerCase()}
      ORDER BY pw.created_at DESC
    `;

    return result.rows.map(mapPersonalWatchlistRow);
  } catch (error) {
    console.warn("Failed to get personal watchlist:", error);
    return [];
  }
}

/**
 * Add to personal watchlist
 */
export async function addToPersonalWatchlist(
  userAddress: string,
  watchedAddress: string,
  chain: "solana" | "base",
  name?: string,
  tags: string[] = []
): Promise<PersonalWatchlistEntry | null> {
  try {
    // Serialize tags array as Postgres array literal
    const tagsArray = `{${tags.map((t) => `"${t}"`).join(",")}}`;

    const result = await sql`
      INSERT INTO personal_watchlists (
        user_address, watched_address, chain, name, tags
      ) VALUES (
        ${userAddress.toLowerCase()},
        ${watchedAddress},
        ${chain},
        ${name || null},
        ${tagsArray}::varchar[]
      )
      ON CONFLICT (user_address, watched_address, chain) 
      DO UPDATE SET
        name = COALESCE(EXCLUDED.name, personal_watchlists.name),
        tags = EXCLUDED.tags
      RETURNING *
    `;

    return mapPersonalWatchlistRow(result.rows[0]);
  } catch (error) {
    console.warn("Failed to add to personal watchlist:", error);
    return null;
  }
}

/**
 * Remove from personal watchlist
 */
export async function removeFromPersonalWatchlist(
  userAddress: string,
  watchedAddress: string,
  chain: "solana" | "base"
): Promise<boolean> {
  try {
    await sql`
      DELETE FROM personal_watchlists
      WHERE user_address = ${userAddress.toLowerCase()}
        AND watched_address = ${watchedAddress}
        AND chain = ${chain}
    `;
    return true;
  } catch (error) {
    console.warn("Failed to remove from personal watchlist:", error);
    return false;
  }
}

function mapPersonalWatchlistRow(row: Record<string, unknown>): PersonalWatchlistEntry {
  return {
    id: row.id as number,
    userAddress: row.user_address as string,
    watchedAddress: row.watched_address as string,
    chain: row.chain as "solana" | "base",
    name: row.name as string | null,
    tags: (row.tags as string[]) || [],
    createdAt: new Date(row.created_at as string),
    latestScore: row.latest_score !== null ? Number(row.latest_score) : undefined,
    latestArchetype: row.latest_archetype as string | null || undefined,
    latestAnalyzedAt: row.latest_analyzed_at ? new Date(row.latest_analyzed_at as string) : undefined,
  };
}

// =============================================================================
// Position Storage (Token-Centric Queries)
// =============================================================================

export interface PositionSnapshot {
  walletAddress: string;
  chain: "solana" | "base";
  tokenAddress: string;
  tokenSymbol: string | null;
  realizedPnl: number | null;
  holdingDays: number | null;
  isEarlyExit: boolean;
  isProfitable: boolean;
}

/**
 * Save position snapshots for an analysis (for token-centric queries)
 */
export async function savePositions(
  analysisId: number,
  walletAddress: string,
  chain: "solana" | "base",
  positions: Array<{
    tokenAddress: string;
    tokenSymbol?: string;
    realizedPnL: number;
    holdingPeriodDays: number;
    isEarlyExit: boolean;
  }>
): Promise<void> {
  if (positions.length === 0) return;
  
  try {
    // Delete existing positions for this analysis (in case of re-analysis)
    await sql`DELETE FROM analysis_positions WHERE analysis_id = ${analysisId}`;
    
    // Insert new positions (batch insert)
    for (const pos of positions) {
      await sql`
        INSERT INTO analysis_positions (
          analysis_id, wallet_address, chain, token_address, token_symbol,
          realized_pnl, holding_days, is_early_exit, is_profitable
        ) VALUES (
          ${analysisId},
          ${walletAddress.toLowerCase()},
          ${chain},
          ${pos.tokenAddress.toLowerCase()},
          ${pos.tokenSymbol || null},
          ${pos.realizedPnL},
          ${pos.holdingPeriodDays},
          ${pos.isEarlyExit},
          ${pos.realizedPnL > 0}
        )
      `;
    }
  } catch (error) {
    console.warn("Failed to save positions:", error);
  }
}

/**
 * Find wallets that held a specific token
 */
export async function getWalletsByToken(
  tokenAddress: string,
  chain: "solana" | "base",
  limit: number = 20
): Promise<Array<{
  walletAddress: string;
  tokenSymbol: string | null;
  realizedPnl: number | null;
  holdingDays: number | null;
  isProfitable: boolean;
  convictionScore: number | null;
  farcasterUsername: string | null;
  analyzedAt: Date;
}>> {
  try {
    const result = await sql`
      SELECT DISTINCT ON (ap.wallet_address)
        ap.wallet_address,
        ap.token_symbol,
        ap.realized_pnl,
        ap.holding_days,
        ap.is_profitable,
        ca.score as conviction_score,
        ca.farcaster_username,
        ca.analyzed_at
      FROM analysis_positions ap
      JOIN conviction_analyses ca ON ap.analysis_id = ca.id
      WHERE ap.token_address = ${tokenAddress.toLowerCase()}
        AND ap.chain = ${chain}
      ORDER BY ap.wallet_address, ca.analyzed_at DESC
      LIMIT ${limit}
    `;
    
    return result.rows.map(row => ({
      walletAddress: row.wallet_address as string,
      tokenSymbol: row.token_symbol as string | null,
      realizedPnl: row.realized_pnl ? Number(row.realized_pnl) : null,
      holdingDays: row.holding_days ? Number(row.holding_days) : null,
      isProfitable: row.is_profitable as boolean,
      convictionScore: row.conviction_score ? Number(row.conviction_score) : null,
      farcasterUsername: row.farcaster_username as string | null,
      analyzedAt: new Date(row.analyzed_at as string),
    }));
  } catch (error) {
    console.warn("Failed to get wallets by token:", error);
    return [];
  }
}

/**
 * Check if wallets in a user's radar also hold a token
 */
export async function getRadarOverlapForToken(
  userAddress: string,
  tokenAddress: string,
  chain: "solana" | "base"
): Promise<Array<{
  walletAddress: string;
  name: string | null;
  isProfitable: boolean;
}>> {
  try {
    const result = await sql`
      SELECT 
        pw.watched_address as wallet_address,
        pw.name,
        ap.is_profitable
      FROM personal_watchlists pw
      JOIN analysis_positions ap ON ap.wallet_address = pw.watched_address AND ap.chain = pw.chain
      WHERE pw.user_address = ${userAddress.toLowerCase()}
        AND ap.token_address = ${tokenAddress.toLowerCase()}
        AND ap.chain = ${chain}
    `;
    
    return result.rows.map(row => ({
      walletAddress: row.wallet_address as string,
      name: row.name as string | null,
      isProfitable: row.is_profitable as boolean,
    }));
  } catch (error) {
    console.warn("Failed to get radar overlap:", error);
    return [];
  }
}

// =============================================================================
// Health Check
// =============================================================================

/**
 * Check if database is connected and working
 */
export async function healthCheck(): Promise<{
  connected: boolean;
  analysisCount: number;
  watchlistCount: number;
}> {
  try {
    const [analyses, watchlist] = await Promise.all([
      sql`SELECT COUNT(*) as count FROM conviction_analyses`,
      sql`SELECT COUNT(*) as count FROM watchlist_traders WHERE is_active = true`,
    ]);

    return {
      connected: true,
      analysisCount: Number(analyses.rows[0].count),
      watchlistCount: Number(watchlist.rows[0].count),
    };
  } catch {
    return {
      connected: false,
      analysisCount: 0,
      watchlistCount: 0,
    };
  }
}

// =============================================================================
// Alpha Discovery - Traders & Token Heatmap
// =============================================================================

export interface AlphaTrader {
  address: string;
  chain: "solana" | "base";
  convictionScore: number;
  patienceTax: number;
  winRate: number;
  archetype: string | null;
  totalPositions: number;
  displayName: string | null;
  farcaster: string | null;
  ens: string | null;
  ethosScore: number | null;
  rank: number | null;
  rankChange: number;
  firstSeenAt: Date;
  lastUpdatedAt: Date;
  /** Conviction score × Ethos multiplier, used for sorting */
  weightedScore: number;
}

/**
 * Ethos-weighted reputation multiplier for conviction score.
 * Matches the README's claim of Elite 1.5x / High 1.3x / Medium 1.15x / Low 1.05x.
 */
function ethosMultiplier(ethosScore: number | null): number {
  const s = ethosScore ?? 0;
  if (s >= 2000) return 1.5;
  if (s >= 1700) return 1.3;
  if (s >= 1400) return 1.15;
  if (s >= 1000) return 1.05;
  return 1.0;
}

function mapAlphaTrader(row: Record<string, unknown>): AlphaTrader {
  const ethos = row.ethos_score != null ? Number(row.ethos_score) : null;
  const conviction = Number(row.conviction_score);
  return {
    address: row.address as string,
    chain: row.chain as "solana" | "base",
    convictionScore: conviction,
    patienceTax: Number(row.patience_tax ?? 0),
    winRate: Number(row.win_rate ?? 0),
    archetype: (row.archetype as string) ?? null,
    totalPositions: Number(row.total_positions ?? 0),
    displayName: (row.display_name as string) ?? null,
    farcaster: (row.farcaster as string) ?? null,
    ens: (row.ens as string) ?? null,
    ethosScore: ethos,
    rank: row.rank != null ? Number(row.rank) : null,
    rankChange: Number(row.rank_change ?? 0),
    firstSeenAt: new Date(row.first_seen_at as string),
    lastUpdatedAt: new Date(row.last_updated_at as string),
    weightedScore: Math.round(conviction * ethosMultiplier(ethos)),
  };
}

/**
 * Top conviction traders from the alpha_leaderboard table, sorted by
 * conviction score × Ethos multiplier.
 */
export async function getAlphaTraders(
  chain?: "solana" | "base",
  limit: number = 25,
): Promise<AlphaTrader[]> {
  try {
    const result = chain
      ? await sql`
          SELECT * FROM alpha_leaderboard
          WHERE chain = ${chain}
          ORDER BY (conviction_score * (
            CASE
              WHEN ethos_score >= 2000 THEN 1.5
              WHEN ethos_score >= 1700 THEN 1.3
              WHEN ethos_score >= 1400 THEN 1.15
              WHEN ethos_score >= 1000 THEN 1.05
              ELSE 1.0
            END
          )) DESC
          LIMIT ${limit}
        `
      : await sql`
          SELECT * FROM alpha_leaderboard
          ORDER BY (conviction_score * (
            CASE
              WHEN ethos_score >= 2000 THEN 1.5
              WHEN ethos_score >= 1700 THEN 1.3
              WHEN ethos_score >= 1400 THEN 1.15
              WHEN ethos_score >= 1000 THEN 1.05
              ELSE 1.0
            END
          )) DESC
          LIMIT ${limit}
        `;
    return result.rows.map(mapAlphaTrader);
  } catch (error) {
    console.warn("Failed to fetch alpha traders:", error);
    return [];
  }
}

export interface TokenHeatmapEntry {
  tokenAddress: string;
  tokenSymbol: string | null;
  chain: "solana" | "base";
  holderCount: number;
  avgConvictionScore: number;
  totalValueHeld: number;
  /** Intensity 0-100: normalized (holderCount × avgConvictionScore) */
  convictionIntensity: number;
  topHolder: string | null;
}

/**
 * Tokens with the highest concentration of credible, high-conviction holders.
 * Pulls from analysis_positions JOIN conviction_analyses, filtered to wallets
 * with Ethos ≥ 1000 (premium) for sybil resistance.
 */
export async function getTokenHeatmap(
  chain?: "solana" | "base",
  limit: number = 25,
  minEthos: number = 1000,
): Promise<TokenHeatmapEntry[]> {
  try {
    const rows = chain
      ? await sql`
          SELECT
            ap.token_address,
            ap.token_symbol,
            ap.chain,
            COUNT(DISTINCT ap.wallet_address) AS holder_count,
            AVG(ca.score) AS avg_conviction_score,
            COALESCE(SUM(ap.realized_pnl), 0) AS total_value_held,
            MAX(ca.address) AS top_holder
          FROM analysis_positions ap
          JOIN conviction_analyses ca
            ON ap.analysis_id = ca.id
            AND ap.wallet_address = ca.address
            AND ap.chain = ca.chain
          WHERE ap.chain = ${chain}
            AND ca.ethos_score >= ${minEthos}
            AND ca.analyzed_at > NOW() - INTERVAL '90 days'
          GROUP BY ap.token_address, ap.token_symbol, ap.chain
          HAVING COUNT(DISTINCT ap.wallet_address) >= 1
          ORDER BY (COUNT(DISTINCT ap.wallet_address) * AVG(ca.score)) DESC
          LIMIT ${limit}
        `
      : await sql`
          SELECT
            ap.token_address,
            ap.token_symbol,
            ap.chain,
            COUNT(DISTINCT ap.wallet_address) AS holder_count,
            AVG(ca.score) AS avg_conviction_score,
            COALESCE(SUM(ap.realized_pnl), 0) AS total_value_held,
            MAX(ca.address) AS top_holder
          FROM analysis_positions ap
          JOIN conviction_analyses ca
            ON ap.analysis_id = ca.id
            AND ap.wallet_address = ca.address
            AND ap.chain = ca.chain
          WHERE ca.ethos_score >= ${minEthos}
            AND ca.analyzed_at > NOW() - INTERVAL '90 days'
          GROUP BY ap.token_address, ap.token_symbol, ap.chain
          HAVING COUNT(DISTINCT ap.wallet_address) >= 1
          ORDER BY (COUNT(DISTINCT ap.wallet_address) * AVG(ca.score)) DESC
          LIMIT ${limit}
        `;

    const raw = rows.rows.map((r: Record<string, unknown>) => ({
      tokenAddress: r.token_address as string,
      tokenSymbol: (r.token_symbol as string) ?? null,
      chain: r.chain as "solana" | "base",
      holderCount: Number(r.holder_count),
      avgConvictionScore: Number(r.avg_conviction_score ?? 0),
      totalValueHeld: Number(r.total_value_held ?? 0),
      topHolder: (r.top_holder as string) ?? null,
      rawIntensity: Number(r.holder_count) * Number(r.avg_conviction_score ?? 0),
    }));

    const maxIntensity = Math.max(1, ...raw.map((r) => r.rawIntensity));
    return raw.map((entry) => {
      const { rawIntensity, ...rest } = entry;
      return {
        ...rest,
        convictionIntensity: Math.round((rawIntensity / maxIntensity) * 100),
      };
    });
  } catch (error) {
    console.warn("Failed to fetch token heatmap:", error);
    return [];
  }
}
