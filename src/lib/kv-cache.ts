/**
 * Vercel KV Cache
 * Persistent Redis-compatible cache that survives deployments
 *
 * Setup: Add KV_REST_API_URL and KV_REST_API_TOKEN to your environment
 * See: https://vercel.com/docs/storage/vercel-kv
 */

import { kv } from "@vercel/kv";

const DEFAULT_TTL = 5 * 60; // 5 minutes in seconds

export interface CacheOptions {
  ttl?: number; // TTL in seconds
}

/**
 * Get a value from cache
 */
export async function getCached<T>(key: string): Promise<T | null> {
  try {
    const value = await kv.get<T>(key);
    return value;
  } catch (error) {
    console.warn(`KV cache get error for ${key}:`, error);
    return null;
  }
}

/**
 * Set a value in cache with optional TTL
 */
export async function setCached<T>(
  key: string,
  value: T,
  options: CacheOptions = {}
): Promise<void> {
  try {
    const ttl = options.ttl ?? DEFAULT_TTL;
    await kv.set(key, value, { ex: ttl });
  } catch (error) {
    console.warn(`KV cache set error for ${key}:`, error);
  }
}

/**
 * Delete a value from cache
 */
export async function deleteCached(key: string): Promise<void> {
  try {
    await kv.del(key);
  } catch (error) {
    console.warn(`KV cache delete error for ${key}:`, error);
  }
}

/**
 * Get or set pattern - fetch from cache or execute fetcher and cache result
 */
export async function getOrSet<T>(
  key: string,
  fetcher: () => Promise<T>,
  options: CacheOptions = {}
): Promise<T> {
  const cached = await getCached<T>(key);
  if (cached !== null) {
    return cached;
  }

  const value = await fetcher();
  await setCached(key, value, options);
  return value;
}

/**
 * Push to a list (for storing alerts)
 */
export async function pushToList<T>(
  key: string,
  value: T,
  maxLength: number = 100
): Promise<void> {
  try {
    await kv.lpush(key, value);
    await kv.ltrim(key, 0, maxLength - 1);
  } catch (error) {
    console.warn(`KV list push error for ${key}:`, error);
  }
}

/**
 * Get list items
 */
export async function getList<T>(
  key: string,
  start: number = 0,
  end: number = -1
): Promise<T[]> {
  try {
    const items = await kv.lrange<T>(key, start, end);
    return items;
  } catch (error) {
    console.warn(`KV list get error for ${key}:`, error);
    return [];
  }
}

/**
 * Check if KV is available (for fallback to in-memory)
 */
export async function isKVAvailable(): Promise<boolean> {
  try {
    await kv.ping();
    return true;
  } catch {
    return false;
  }
}
