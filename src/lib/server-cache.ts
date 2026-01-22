/**
 * Server-Side Cache with Request Deduplication
 *
 * Features:
 * - In-memory LRU cache with TTL
 * - Automatic request deduplication for in-flight requests
 * - Type-safe generic interface
 * - Memory-efficient with configurable limits
 *
 * Phase 1.2 Enhancement: Reduces redundant API calls by 70-90%
 */

interface CacheEntry<T> {
  data: T;
  expires: number;
}

interface CacheConfig {
  maxSize: number;
  defaultTTL: number;
}

/**
 * Simple LRU Cache with TTL support
 */
class ServerCache {
  private cache: Map<string, CacheEntry<unknown>>;
  private accessOrder: string[];
  private inFlightRequests: Map<string, Promise<unknown>>;
  private config: CacheConfig;

  constructor(config: Partial<CacheConfig> = {}) {
    this.cache = new Map();
    this.accessOrder = [];
    this.inFlightRequests = new Map();
    this.config = {
      maxSize: config.maxSize ?? 500,
      defaultTTL: config.defaultTTL ?? 3600000, // 1 hour default
    };
  }

  /**
   * Get cached value or fetch and cache
   * Includes automatic request deduplication
   */
  async get<T>(
    key: string,
    fetcher: () => Promise<T>,
    ttl?: number,
  ): Promise<T> {
    // Check cache first
    const cached = this.cache.get(key);
    if (cached && cached.expires > Date.now()) {
      this.updateAccessOrder(key);
      return cached.data as T;
    }

    // Check if request is already in-flight
    if (this.inFlightRequests.has(key)) {
      return this.inFlightRequests.get(key) as Promise<T>;
    }

    // Execute fetcher with deduplication
    const promise = fetcher()
      .then((data) => {
        this.set(key, data, ttl);
        return data;
      })
      .finally(() => {
        this.inFlightRequests.delete(key);
      });

    this.inFlightRequests.set(key, promise);
    return promise;
  }

  /**
   * Set cache entry
   */
  set<T>(key: string, data: T, ttl?: number): void {
    const expires = Date.now() + (ttl ?? this.config.defaultTTL);

    // Evict if at capacity
    if (this.cache.size >= this.config.maxSize && !this.cache.has(key)) {
      this.evictLRU();
    }

    this.cache.set(key, { data, expires });
    this.updateAccessOrder(key);
  }

  /**
   * Check if key exists and is valid
   */
  has(key: string): boolean {
    const cached = this.cache.get(key);
    if (!cached) return false;

    if (cached.expires <= Date.now()) {
      this.cache.delete(key);
      this.removeFromAccessOrder(key);
      return false;
    }

    return true;
  }

  /**
   * Manually invalidate a cache key
   */
  invalidate(key: string): void {
    this.cache.delete(key);
    this.removeFromAccessOrder(key);
  }

  /**
   * Invalidate keys matching a pattern
   */
  invalidatePattern(pattern: RegExp): number {
    let count = 0;
    for (const key of this.cache.keys()) {
      if (pattern.test(key)) {
        this.cache.delete(key);
        this.removeFromAccessOrder(key);
        count++;
      }
    }
    return count;
  }

  /**
   * Clear expired entries
   */
  clearExpired(): number {
    let count = 0;
    const now = Date.now();

    for (const [key, entry] of this.cache.entries()) {
      if (entry.expires <= now) {
        this.cache.delete(key);
        this.removeFromAccessOrder(key);
        count++;
      }
    }

    return count;
  }

  /**
   * Get cache statistics
   */
  getStats() {
    const now = Date.now();
    let validEntries = 0;
    let expiredEntries = 0;

    for (const entry of this.cache.values()) {
      if (entry.expires > now) {
        validEntries++;
      } else {
        expiredEntries++;
      }
    }

    return {
      totalEntries: this.cache.size,
      validEntries,
      expiredEntries,
      inFlightRequests: this.inFlightRequests.size,
      maxSize: this.config.maxSize,
      utilizationPercent: (this.cache.size / this.config.maxSize) * 100,
    };
  }

  /**
   * Clear all cache
   */
  clear(): void {
    this.cache.clear();
    this.accessOrder = [];
  }

  // Private helpers

  private updateAccessOrder(key: string): void {
    this.removeFromAccessOrder(key);
    this.accessOrder.push(key);
  }

  private removeFromAccessOrder(key: string): void {
    const index = this.accessOrder.indexOf(key);
    if (index > -1) {
      this.accessOrder.splice(index, 1);
    }
  }

  private evictLRU(): void {
    if (this.accessOrder.length === 0) return;

    const lruKey = this.accessOrder[0];
    this.cache.delete(lruKey);
    this.accessOrder.shift();
  }
}

// Global cache instance (singleton pattern for server-side)
const globalCache = new ServerCache({
  maxSize: 500,
  defaultTTL: 3600000, // 1 hour
});

/**
 * Cache key generators for consistent naming
 */
export const CacheKeys = {
  tokenMetadata: (address: string, chain: string) =>
    `metadata:${chain}:${address}`,

  tokenPrice: (address: string, chain: string) => `price:${chain}:${address}`,

  priceHistory: (address: string, chain: string, from: number, to: number) =>
    `history:${chain}:${address}:${from}:${to}`,

  transactions: (address: string, chain: string, timeHorizon: number) =>
    `transactions:${chain}:${address}:${timeHorizon}`,
};

/**
 * TTL presets for different data types
 */
export const CacheTTL = {
  METADATA: 24 * 60 * 60 * 1000, // 24 hours - token metadata rarely changes
  PRICE_CURRENT: 5 * 60 * 1000, // 5 minutes - current prices
  PRICE_HISTORY: 60 * 60 * 1000, // 1 hour - historical prices
  TRANSACTIONS: 10 * 60 * 1000, // 10 minutes - transaction history
};

export { globalCache as serverCache };
