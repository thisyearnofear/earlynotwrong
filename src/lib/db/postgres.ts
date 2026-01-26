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
        ${metrics.percentile},
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
 * Get real cohort percentile based on all stored analyses
 */
export async function getRealPercentile(
  score: number,
  chain?: "solana" | "base"
): Promise<number> {
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

    const { total, below } = result.rows[0];
    if (total === 0) return 50; // Default if no data
    return Math.round((below / total) * 100);
  } catch (error) {
    console.warn("Failed to calculate real percentile:", error);
    return 50;
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
