/**
 * Cached Ethos Service Layer
 * 
 * Wraps all Ethos API calls with intelligent caching to prevent rate limits.
 * Uses existing server-cache infrastructure with Ethos-specific TTLs.
 * 
 * Core Principles:
 * - DRY: Single source for all Ethos API interactions
 * - PERFORMANT: Aggressive caching with request deduplication
 * - CLEAN: Clear separation from business logic
 */

import { serverCache } from '@/lib/server-cache';
import { ethosClient } from '@/lib/ethos';
import type { EthosScore, EthosProfile, EthosUserStats } from '@/lib/ethos';

/**
 * Cache TTLs optimized for Ethos data characteristics
 */
const ETHOS_CACHE_TTL = {
  SCORE: 60 * 60 * 1000,        // 1 hour - scores change slowly
  PROFILE: 24 * 60 * 60 * 1000, // 24 hours - profiles rarely change
  REVIEWS: 30 * 60 * 1000,      // 30 minutes - reviews more dynamic
  SOCIAL_GRAPH: 60 * 60 * 1000, // 1 hour - connections relatively stable
} as const;

/**
 * Cache key generators for Ethos data
 */
const EthosCacheKeys = {
  score: (address: string) => `ethos:score:${address.toLowerCase()}`,
  scoreByUserKey: (userKey: string) => `ethos:score:userkey:${userKey}`,
  profile: (address: string) => `ethos:profile:${address.toLowerCase()}`,
  reviews: (address: string) => `ethos:reviews:${address.toLowerCase()}`,
  vouches: (address: string) => `ethos:vouches:${address.toLowerCase()}`,
  attestations: (address: string) => `ethos:attestations:${address.toLowerCase()}`,
  userStats: (userkey: string) => `ethos:stats:${userkey.toLowerCase()}`,
} as const;

/**
 * Cached Ethos Service
 * All Ethos API interactions should go through this service
 */
export class CachedEthosService {
  /**
   * Get Ethos score with caching
   */
  async getScoreByAddress(address: string): Promise<EthosScore | null> {
    const key = EthosCacheKeys.score(address);

    return serverCache.get(
      key,
      () => ethosClient.getScoreByAddress(address),
      ETHOS_CACHE_TTL.SCORE
    );
  }

  /**
   * Get Ethos score by user key (e.g., service:x.com:username:vitalik)
   */
  async getScoreByUserKey(userKey: string): Promise<EthosScore | null> {
    const key = EthosCacheKeys.scoreByUserKey(userKey);

    return serverCache.get(
      key,
      () => ethosClient.getScoreByUserKey(userKey),
      ETHOS_CACHE_TTL.SCORE
    );
  }

  /**
   * Get Ethos profile with caching
   */
  async getProfileByAddress(address: string): Promise<EthosProfile | null> {
    const key = EthosCacheKeys.profile(address);

    return serverCache.get(
      key,
      () => ethosClient.getProfileByAddress(address),
      ETHOS_CACHE_TTL.PROFILE
    );
  }

  /**
   * Get Ethos profile by user key with caching
   * Enables social identity → Ethos profile resolution
   */
  async getProfileByUserKey(userKey: string): Promise<EthosProfile | null> {
    const key = `ethos:profile:userkey:${userKey}`;

    return serverCache.get(
      key,
      () => ethosClient.getProfileByUserKey(userKey),
      ETHOS_CACHE_TTL.PROFILE
    );
  }

  /**
   * Get conviction attestations with caching
   */
  async getConvictionAttestations(address: string) {
    const key = EthosCacheKeys.attestations(address);

    return serverCache.get(
      key,
      () => ethosClient.getConvictionAttestations(address),
      ETHOS_CACHE_TTL.REVIEWS
    );
  }

  /**
   * Get comprehensive Ethos data for a wallet (parallel fetch with caching)
   * This is the main method for wallet analysis
   */
  async getWalletEthosData(address: string): Promise<{
    score: EthosScore | null;
    profile: EthosProfile | null;
    attestations: Awaited<ReturnType<typeof ethosClient.getConvictionAttestations>>;
  }> {
    // Parallel fetch with individual caching
    const [score, profile, attestations] = await Promise.all([
      this.getScoreByAddress(address),
      this.getProfileByAddress(address),
      this.getConvictionAttestations(address),
    ]);

    return {
      score,
      profile,
      attestations,
    };
  }

  /**
   * Batch fetch Ethos scores for multiple addresses
   * Useful for leaderboards, comparisons, discovery features
   */
  async getBatchScores(addresses: string[]): Promise<Map<string, EthosScore | null>> {
    const results = await Promise.all(
      addresses.map(async (address) => ({
        address: address.toLowerCase(),
        score: await this.getScoreByAddress(address),
      }))
    );

    return new Map(results.map(r => [r.address, r.score]));
  }

  /**
   * Calculate reputation perks (no caching needed - pure calculation)
   */
  getReputationPerks(ethosScore: number | null) {
    return ethosClient.getReputationPerks(ethosScore);
  }

  /**
   * Calculate reputation weighting (no caching needed - pure calculation)
   */
  calculateReputationWeighting(baseScore: number, ethosScore: number | null) {
    return ethosClient.calculateReputationWeighting(baseScore, ethosScore);
  }

  /**
   * Classify wallet for alpha discovery (no caching needed - pure calculation)
   */
  classifyWalletForAlpha(
    convictionScore: number,
    ethosScore: number | null,
    totalPositions: number
  ) {
    return ethosClient.classifyWalletForAlpha(convictionScore, ethosScore, totalPositions);
  }

  /**
   * Get Ethos profile URL (no caching needed - pure URL construction)
   */
  getProfileUrl(profile: EthosProfile): string {
    return ethosClient.getProfileUrl(profile);
  }

  /**
   * Invalidate cache for a specific address
   * Useful when user updates their profile or after attestation
   */
  invalidateAddress(address: string): void {
    const normalizedAddress = address.toLowerCase();
    serverCache.invalidate(EthosCacheKeys.score(normalizedAddress));
    serverCache.invalidate(EthosCacheKeys.profile(normalizedAddress));
    serverCache.invalidate(EthosCacheKeys.attestations(normalizedAddress));
    serverCache.invalidate(EthosCacheKeys.reviews(normalizedAddress));
    serverCache.invalidate(EthosCacheKeys.vouches(normalizedAddress));
  }

  /**
   * Invalidate all Ethos cache
   * Use sparingly - only for maintenance or major updates
   */
  invalidateAll(): number {
    return serverCache.invalidatePattern(/^ethos:/);
  }

  /**
   * Get cache statistics for monitoring
   */
  getCacheStats() {
    return serverCache.getStats();
  }
}

// Singleton instance
export const cachedEthosService = new CachedEthosService();
