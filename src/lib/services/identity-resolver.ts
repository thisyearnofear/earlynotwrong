/**
 * Identity Resolution Service
 * 
 * Resolves wallet addresses, ENS names, Farcaster handles, and other identities
 * into a unified identity object with all available data.
 * 
 * Core Principles:
 * - DRY: Single source for identity resolution
 * - PERFORMANT: Parallel resolution with caching
 * - CLEAN: Clear input/output types
 */

import { serverCache } from '@/lib/server-cache';
import { cachedEthosService } from './ethos-cache';
import { ethosClient } from '@/lib/ethos';
import type { EthosScore, EthosProfile, FarcasterIdentity } from '@/lib/ethos';

/**
 * Input types that can be resolved
 */
export type IdentityInput = 
  | string  // Can be: 0x address, ENS, Farcaster handle, Lens handle, etc.

/**
 * Normalized identity with all available data
 */
export interface ResolvedIdentity {
  // Core address (normalized to lowercase)
  address: string;
  
  // Identity services
  ens: {
    name: string | null;
    avatar: string | null;
  };
  
  farcaster: FarcasterIdentity | null;
  
  ethos: {
    score: EthosScore | null;
    profile: EthosProfile | null;
  };
  
  lens: {
    handle: string | null;
    profileId: string | null;
  } | null;
  
  // Metadata
  resolvedFrom: 'address' | 'ens' | 'farcaster' | 'lens' | 'userkey';
  resolvedAt: string;
}

/**
 * Cache TTL for identity resolution
 */
const IDENTITY_CACHE_TTL = {
  ENS: 24 * 60 * 60 * 1000,       // 24 hours - ENS rarely changes
  FARCASTER: 60 * 60 * 1000,      // 1 hour - Farcaster data semi-stable
  FULL_IDENTITY: 60 * 60 * 1000,  // 1 hour - full resolution
} as const;

/**
 * Identity Resolution Service
 */
export class IdentityResolverService {
  /**
   * Resolve any input to a complete identity
   */
  async resolve(input: string): Promise<ResolvedIdentity | null> {
    const normalizedInput = input.trim().toLowerCase();
    
    // Generate cache key
    const cacheKey = `identity:resolved:${normalizedInput}`;
    
    // Try cache first
    const cached = await serverCache.get(
      cacheKey,
      async () => {
        // Determine input type and resolve accordingly
        if (this.isAddress(normalizedInput)) {
          return this.resolveFromAddress(normalizedInput);
        } else if (this.isENS(normalizedInput)) {
          return this.resolveFromENS(normalizedInput);
        } else if (this.isFarcasterHandle(normalizedInput)) {
          return this.resolveFromFarcaster(normalizedInput);
        } else if (this.isLensHandle(normalizedInput)) {
          return this.resolveFromLens(normalizedInput);
        }
        
        return null;
      },
      IDENTITY_CACHE_TTL.FULL_IDENTITY
    );
    
    return cached;
  }

  /**
   * Resolve from Ethereum/Solana address
   */
  private async resolveFromAddress(address: string): Promise<ResolvedIdentity> {
    // Parallel fetch all identity services
    const [ensData, farcasterData, ethosData] = await Promise.allSettled([
      this.lookupENS(address),
      this.lookupFarcaster(address),
      cachedEthosService.getWalletEthosData(address),
    ]);

    return {
      address,
      ens: ensData.status === 'fulfilled' ? ensData.value : { name: null, avatar: null },
      farcaster: farcasterData.status === 'fulfilled' ? farcasterData.value : null,
      ethos: ethosData.status === 'fulfilled' 
        ? { score: ethosData.value.score, profile: ethosData.value.profile }
        : { score: null, profile: null },
      lens: null, // TODO: Add Lens integration if needed
      resolvedFrom: 'address',
      resolvedAt: new Date().toISOString(),
    };
  }

  /**
   * Resolve from ENS name
   */
  private async resolveFromENS(ensName: string): Promise<ResolvedIdentity | null> {
    const address = await this.resolveENSToAddress(ensName);
    
    if (!address) {
      return null;
    }

    const identity = await this.resolveFromAddress(address);
    
    return {
      ...identity,
      ens: {
        name: ensName,
        avatar: identity.ens.avatar,
      },
      resolvedFrom: 'ens',
    };
  }

  /**
   * Resolve from Farcaster handle (@username)
   */
  private async resolveFromFarcaster(handle: string): Promise<ResolvedIdentity | null> {
    // Remove @ if present
    const cleanHandle = handle.startsWith('@') ? handle.slice(1) : handle;
    
    // Use existing Farcaster API
    try {
      const response = await fetch('/api/farcaster/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: cleanHandle }),
      });

      if (!response.ok) {
        return null;
      }

      const data = await response.json();
      const farcasterIdentity = data.identity;
      
      if (!farcasterIdentity || !farcasterIdentity.verifiedAddresses?.ethAddresses?.[0]) {
        return null;
      }

      const address = farcasterIdentity.verifiedAddresses.ethAddresses[0].toLowerCase();
      const identity = await this.resolveFromAddress(address);
      
      return {
        ...identity,
        farcaster: farcasterIdentity,
        resolvedFrom: 'farcaster',
      };
    } catch (error) {
      console.warn('Farcaster resolution failed:', error);
      return null;
    }
  }

  /**
   * Resolve from Lens handle
   */
  private async resolveFromLens(handle: string): Promise<ResolvedIdentity | null> {
    // TODO: Implement Lens resolution if needed
    // For now, return null
    console.warn('Lens resolution not yet implemented');
    return null;
  }

  /**
   * Batch resolve multiple identities
   */
  async resolveBatch(inputs: string[]): Promise<Map<string, ResolvedIdentity | null>> {
    const results = await Promise.all(
      inputs.map(async (input) => ({
        input,
        identity: await this.resolve(input),
      }))
    );

    return new Map(results.map(r => [r.input, r.identity]));
  }

  // Helper methods for lookups

  private async lookupENS(address: string): Promise<{ name: string | null; avatar: string | null }> {
    try {
      // Use public ENS resolver
      // Note: In production, use a dedicated ENS service or library
      const response = await fetch(`https://api.ensideas.com/ens/resolve/${address}`);
      
      if (!response.ok) {
        return { name: null, avatar: null };
      }

      const data = await response.json();
      return {
        name: data.name || null,
        avatar: data.avatar || null,
      };
    } catch (error) {
      console.warn('ENS lookup failed:', error);
      return { name: null, avatar: null };
    }
  }

  private async resolveENSToAddress(ensName: string): Promise<string | null> {
    try {
      // Use public ENS resolver
      const response = await fetch(`https://api.ensideas.com/ens/resolve/${ensName}`);
      
      if (!response.ok) {
        return null;
      }

      const data = await response.json();
      return data.address?.toLowerCase() || null;
    } catch (error) {
      console.warn('ENS resolution failed:', error);
      return null;
    }
  }

  private async lookupFarcaster(address: string): Promise<FarcasterIdentity | null> {
    try {
      const response = await fetch('/api/farcaster/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address }),
      });

      if (!response.ok) {
        return null;
      }

      const data = await response.json();
      return data.identity || null;
    } catch (error) {
      console.warn('Farcaster lookup failed:', error);
      return null;
    }
  }

  // Input type detection

  private isAddress(input: string): boolean {
    // Ethereum address (0x + 40 hex chars) or Solana address (32-44 alphanumeric)
    return /^0x[a-f0-9]{40}$/i.test(input) || /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(input);
  }

  private isENS(input: string): boolean {
    // ENS name (something.eth)
    return input.endsWith('.eth');
  }

  private isFarcasterHandle(input: string): boolean {
    // Farcaster handle (@username or username)
    return input.startsWith('@') || (!input.includes('.') && !this.isAddress(input));
  }

  private isLensHandle(input: string): boolean {
    // Lens handle (something.lens)
    return input.endsWith('.lens');
  }

  /**
   * Invalidate cached identity
   */
  invalidate(input: string): void {
    const normalizedInput = input.trim().toLowerCase();
    const cacheKey = `identity:resolved:${normalizedInput}`;
    serverCache.invalidate(cacheKey);
  }

  /**
   * Clear all identity cache
   */
  clearCache(): number {
    return serverCache.invalidatePattern(/^identity:/);
  }
}

// Singleton instance
export const identityResolver = new IdentityResolverService();
