/**
 * Cached FairScale Service Layer
 * 
 * Wraps all FairScale API calls with intelligent caching to prevent rate limits.
 * Mirrors ethos-cache.ts architecture for consistency.
 * 
 * Core Principles:
 * - DRY: Single source for all FairScale API interactions
 * - PERFORMANT: Aggressive caching with request deduplication
 * - CLEAN: Clear separation from business logic
 */

import { serverCache } from '@/lib/server-cache';
import { fairscaleClient } from '@/lib/fairscale';
import type { FairScaleScore } from '@/lib/fairscale';

/**
 * Cache TTLs optimized for FairScale data characteristics
 */
const FAIRSCALE_CACHE_TTL = {
  SCORE: 60 * 60 * 1000,        // 1 hour - scores change moderately
  FEATURES: 24 * 60 * 60 * 1000, // 24 hours - feature breakdown relatively stable
} as const;

/**
 * Cache key generators for FairScale data
 */
const FairScaleCacheKeys = {
  score: (wallet: string, twitter?: string) => 
    `fairscale:score:${wallet.toLowerCase()}${twitter ? `:twitter:${twitter}` : ''}`,
  walletScore: (wallet: string) => 
    `fairscale:wallet-score:${wallet.toLowerCase()}`,
  socialScore: (wallet: string, twitter: string) => 
    `fairscale:social-score:${wallet.toLowerCase()}:${twitter}`,
  fairScore: (wallet: string, twitter?: string) => 
    `fairscale:fair-score:${wallet.toLowerCase()}${twitter ? `:twitter:${twitter}` : ''}`,
} as const;

/**
 * Cached FairScale Service
 * All FairScale API interactions should go through this service
 */
export class CachedFairScaleService {
  /**
   * Get complete FairScale score with caching
   */
  async getScore(
    wallet: string,
    twitter?: string,
  ): Promise<FairScaleScore | null> {
    const key = FairScaleCacheKeys.score(wallet, twitter);

    return serverCache.get(
      key,
      () => fairscaleClient.getScore(wallet, twitter),
      FAIRSCALE_CACHE_TTL.SCORE
    );
  }

  /**
   * Get wallet score only with caching
   */
  async getWalletScore(
    wallet: string,
    twitter?: string,
  ): Promise<number | null> {
    const key = FairScaleCacheKeys.walletScore(wallet);

    return serverCache.get(
      key,
      () => fairscaleClient.getWalletScore(wallet, twitter),
      FAIRSCALE_CACHE_TTL.SCORE
    );
  }

  /**
   * Get social score with caching
   */
  async getSocialScore(
    wallet: string,
    twitter: string,
  ): Promise<number | null> {
    const key = FairScaleCacheKeys.socialScore(wallet, twitter);

    return serverCache.get(
      key,
      () => fairscaleClient.getSocialScore(wallet, twitter),
      FAIRSCALE_CACHE_TTL.SCORE
    );
  }

  /**
   * Get FairScore value (lightweight) with caching
   */
  async getFairScore(
    wallet: string,
    twitter?: string,
  ): Promise<number | null> {
    const key = FairScaleCacheKeys.fairScore(wallet, twitter);

    return serverCache.get(
      key,
      () => fairscaleClient.getFairScore(wallet, twitter),
      FAIRSCALE_CACHE_TTL.SCORE
    );
  }

  /**
   * Batch fetch FairScale scores for multiple wallets
   * Useful for leaderboards, discovery features
   */
  async getBatchScores(
    wallets: string[],
  ): Promise<Map<string, FairScaleScore | null>> {
    const results = await Promise.all(
      wallets.map(async (wallet) => ({
        wallet: wallet.toLowerCase(),
        score: await this.getScore(wallet),
      }))
    );

    return new Map(results.map(r => [r.wallet, r.score]));
  }

  /**
   * Invalidate cache for a specific wallet
   * Useful when user updates their profile or after significant activity
   */
  invalidateWallet(wallet: string): void {
    const normalizedWallet = wallet.toLowerCase();
    serverCache.invalidate(FairScaleCacheKeys.score(normalizedWallet));
    serverCache.invalidate(FairScaleCacheKeys.walletScore(normalizedWallet));
    serverCache.invalidate(FairScaleCacheKeys.fairScore(normalizedWallet));
  }

  /**
   * Invalidate all FairScale cache
   * Use sparingly - only for maintenance or major updates
   */
  invalidateAll(): number {
    return serverCache.invalidatePattern(/^fairscale:/);
  }

  /**
   * Check if FairScale is configured
   */
  isConfigured(): boolean {
    return fairscaleClient.isConfigured();
  }

  /**
   * Get cache statistics for monitoring
   */
  getCacheStats() {
    return serverCache.getStats();
  }
}

// Singleton instance
export const cachedFairScaleService = new CachedFairScaleService();
