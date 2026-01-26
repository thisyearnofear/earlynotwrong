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

import { serverCache } from "@/lib/server-cache";
import { cachedEthosService } from "./ethos-cache";
import { trustResolver } from "./trust-resolver";
import type { EthosScore, EthosProfile, FarcasterIdentity } from "@/lib/ethos";
import type { UnifiedTrustScore } from "./trust-resolver";

/**
 * Input types that can be resolved
 */
export type IdentityInput = string; // Can be: 0x address, ENS, Farcaster handle, Lens handle, etc.

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

  // Connected wallets
  solanaAddress?: string | null;

  // Unified trust score (Phase 2: cross-provider)
  trust?: UnifiedTrustScore;

  // Metadata
  resolvedFrom: "address" | "ens" | "farcaster" | "lens" | "userkey";
  resolvedAt: string;

  // Observability (optional, for debugging)
  _meta?: {
    resolutionPath: string[];
    ethosSource?: "direct" | "userkey" | "linked-address" | "multi-address-best";
    linkedAddressesChecked?: number;
    durationMs?: number;
  };
}

/**
 * Cache TTL for identity resolution
 */
const IDENTITY_CACHE_TTL = {
  ENS: 24 * 60 * 60 * 1000, // 24 hours - ENS rarely changes
  FARCASTER: 60 * 60 * 1000, // 1 hour - Farcaster data semi-stable
  FULL_IDENTITY: 60 * 60 * 1000, // 1 hour - full resolution
} as const;

/**
 * Identity Resolution Service
 */
export class IdentityResolverService {
  /**
   * Resolve any input to a complete identity
   */
  async resolve(input: string): Promise<ResolvedIdentity | null> {
    const startTime = Date.now();
    const trimmed = input.trim();

    // Solana addresses are case-sensitive. Ethereum are not.
    // We only lowercase if it's clearly not a raw wallet address (e.g. has dots or is short).
    const isProbablyAddress =
      /^[a-zA-Z0-9]{30,65}$/.test(trimmed) || trimmed.startsWith("0x");
    const normalizedInput = isProbablyAddress ? trimmed : trimmed.toLowerCase();

    // Generate cache key
    const cacheKey = `identity:resolved:${normalizedInput}`;

    try {
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

          // Fallback for unresolvable inputs that look like wallets but didn't match formats exactly.
          // This ensures that wallets without social profiles can still be analyzed.
          if (
            normalizedInput.length >= 30 &&
            !normalizedInput.includes(".") &&
            !normalizedInput.includes(" ")
          ) {
            return this.resolveFromAddress(normalizedInput);
          }

          return null;
        },
        IDENTITY_CACHE_TTL.FULL_IDENTITY,
      );

      // Add observability metadata
      const durationMs = Date.now() - startTime;

      if (cached) {
        // Log successful resolution
        console.log('[Identity Resolution Success]', {
          input: normalizedInput.substring(0, 10) + '...',
          resolvedFrom: cached.resolvedFrom,
          hasEthos: !!cached.ethos.score,
          hasFarcaster: !!cached.farcaster,
          hasENS: !!cached.ens.name,
          ethosSource: cached._meta?.ethosSource,
          durationMs,
        });
      }

      return cached;
    } catch (error) {
      const durationMs = Date.now() - startTime;
      console.error('[Identity Resolution Failed]', {
        input: normalizedInput.substring(0, 10) + '...',
        error: error instanceof Error ? error.message : 'Unknown',
        durationMs,
      });
      return null;
    }
  }

  /**
   * Resolve from Ethereum/Solana address
   */
  private async resolveFromAddress(address: string): Promise<ResolvedIdentity> {
    const isEvm = address.startsWith("0x");
    const resolutionPath: string[] = [];
    let ethosSource: "direct" | "userkey" | "linked-address" | "multi-address-best" | undefined;
    let linkedAddressesChecked = 0;

    // Parallel fetch all identity services
    const [ensData, farcasterData, ethosData] = await Promise.allSettled([
      isEvm
        ? this.lookupENS(address)
        : Promise.resolve({ name: null, avatar: null }),
      this.lookupFarcaster(address),
      isEvm
        ? cachedEthosService.getWalletEthosData(address)
        : Promise.resolve({ score: null, profile: null, attestations: [] }),
    ]);

    if (isEvm && ensData.status === "fulfilled" && ensData.value.name) {
      resolutionPath.push('ens-found');
    }

    if (farcasterData.status === "fulfilled" && farcasterData.value) {
      resolutionPath.push('farcaster-found');
    }

    let finalEthosData = ethosData.status === "fulfilled"
      ? { score: ethosData.value.score, profile: ethosData.value.profile }
      : { score: null, profile: null };

    if (finalEthosData.score) {
      resolutionPath.push('ethos-direct');
      ethosSource = 'direct';
    }

    // Get Farcaster identity for multi-address aggregation
    const farcasterIdentity = farcasterData.status === "fulfilled" ? farcasterData.value : null;

    // Multi-address Ethos aggregation: Check all verified addresses
    if (farcasterIdentity?.verifiedAddresses) {
      const allVerifiedAddresses = [
        ...(farcasterIdentity.verifiedAddresses.ethAddresses || []),
        // Note: Solana addresses can't have Ethos directly, so we skip them for now
      ].filter(addr => addr.toLowerCase() !== address.toLowerCase());

      linkedAddressesChecked = allVerifiedAddresses.length;

      if (allVerifiedAddresses.length > 0) {
        resolutionPath.push(`checking-${allVerifiedAddresses.length}-linked-addresses`);

        // Fetch Ethos data for all linked addresses in parallel
        const linkedEthosResults = await Promise.allSettled(
          allVerifiedAddresses.map(addr => cachedEthosService.getWalletEthosData(addr))
        );

        // Aggregate all Ethos data (primary + linked addresses)
        const allEthosData = [
          finalEthosData,
          ...linkedEthosResults
            .filter(result => result.status === "fulfilled")
            .map(result => ({
              score: result.value.score,
              profile: result.value.profile,
            }))
        ];

        const originalScore = finalEthosData.score?.score || 0;
        // Select best Ethos score across all addresses
        finalEthosData = this.selectBestEthosData(allEthosData);

        if (finalEthosData.score && finalEthosData.score.score > originalScore) {
          resolutionPath.push('ethos-multi-address-best');
          ethosSource = 'multi-address-best';
        }
      }
    }

    // For Solana addresses without Ethos data, try Twitter → Ethos UserKey bridge
    // Always try to find linked social handles and wallets via Web3.bio
    // This addresses the issue where we have an EVM address but miss the linked Solana wallet
    let twitterHandle: string | undefined;
    let foundSolanaAddress: string | null = null;

    // Check Web3.bio for cross-chain identity connections
    const socialHandles = await this.lookupSocialHandles(address);
    if (socialHandles) {
      twitterHandle = socialHandles.twitter;
      if (socialHandles.solana) {
        foundSolanaAddress = socialHandles.solana;
        resolutionPath.push(`solana-linked:${foundSolanaAddress.slice(0, 8)}`);
      }
    }

    // Also check Farcaster profile for verified Solana addresses (direct from Neynar)
    if (!foundSolanaAddress && farcasterIdentity?.verifiedAddresses?.solAddresses?.length) {
      foundSolanaAddress = farcasterIdentity.verifiedAddresses.solAddresses[0];
      resolutionPath.push(`solana-farcaster:${foundSolanaAddress.slice(0, 8)}`);
    }

    // For addresses without Ethos data (e.g. Solana-only), try Twitter → Ethos UserKey bridge
    if (!finalEthosData.score && twitterHandle) {
      resolutionPath.push(`twitter-found:${twitterHandle}`);
      const userKey = `service:x.com:username:${twitterHandle}`;

      const [scoreByUserKey, profileByUserKey] = await Promise.allSettled([
        cachedEthosService.getScoreByUserKey(userKey),
        cachedEthosService.getProfileByUserKey(userKey),
      ]);

      const scoreFromUserKey = scoreByUserKey.status === "fulfilled" ? scoreByUserKey.value : null;
      const profileFromUserKey = profileByUserKey.status === "fulfilled" ? profileByUserKey.value : null;

      if (scoreFromUserKey?.score && scoreFromUserKey.score > 0) {
        finalEthosData = {
          score: scoreFromUserKey,
          profile: profileFromUserKey,
        };
        resolutionPath.push('ethos-via-userkey');
        ethosSource = 'userkey';
      }
    }

    // Get unified trust score (Ethos + FairScale for Solana)
    const unifiedTrust = await trustResolver.resolve(address, twitterHandle, foundSolanaAddress || undefined);
    if (unifiedTrust.score > 0) {
      resolutionPath.push(`trust-resolved:${unifiedTrust.primaryProvider}`);
    }

    return {
      address,
      ens:
        ensData.status === "fulfilled"
          ? ensData.value
          : { name: null, avatar: null },
      farcaster: farcasterIdentity,
      ethos: finalEthosData,
      lens: null, // TODO: Add Lens integration if needed
      solanaAddress: foundSolanaAddress,
      trust: unifiedTrust,
      resolvedFrom: "address",
      resolvedAt: new Date().toISOString(),
      _meta: {
        resolutionPath,
        ethosSource,
        linkedAddressesChecked,
      },
    };
  }

  /**
   * Resolve from ENS name
   */
  private async resolveFromENS(
    ensName: string,
  ): Promise<ResolvedIdentity | null> {
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
      resolvedFrom: "ens",
    };
  }

  /**
   * Resolve from Farcaster handle (@username)
   */
  private async resolveFromFarcaster(
    handle: string,
  ): Promise<ResolvedIdentity | null> {
    // Remove @ if present
    const cleanHandle = handle.startsWith("@") ? handle.slice(1) : handle;

    // Use existing Farcaster API
    try {
      // Internal server-side fetches must use absolute URLs.
      const baseUrl =
        process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
      const response = await fetch(`${baseUrl}/api/farcaster/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: cleanHandle }),
      });

      if (!response.ok) {
        return null;
      }

      const data = await response.json();
      const farcasterIdentity = data.identity;

      if (
        !farcasterIdentity ||
        !farcasterIdentity.verifiedAddresses?.ethAddresses?.[0]
      ) {
        return null;
      }

      const address =
        farcasterIdentity.verifiedAddresses.ethAddresses[0].toLowerCase();
      const identity = await this.resolveFromAddress(address);

      return {
        ...identity,
        farcaster: farcasterIdentity,
        resolvedFrom: "farcaster",
      };
    } catch (error) {
      console.warn("Farcaster resolution failed:", error);
      return null;
    }
  }

  /**
   * Resolve from Lens handle
   */
  private async resolveFromLens(
    _handle: string,
  ): Promise<ResolvedIdentity | null> {
    // TODO: Implement Lens resolution if needed
    // For now, return null
    void _handle;
    console.warn("Lens resolution not yet implemented");
    return null;
  }

  /**
   * Batch resolve multiple identities
   */
  async resolveBatch(
    inputs: string[],
  ): Promise<Map<string, ResolvedIdentity | null>> {
    const results = await Promise.all(
      inputs.map(async (input) => ({
        input,
        identity: await this.resolve(input),
      })),
    );

    return new Map(results.map((r) => [r.input, r.identity]));
  }

  // Helper methods for lookups

  private async lookupENS(
    address: string,
  ): Promise<{ name: string | null; avatar: string | null }> {
    try {
      // Use public ENS resolver
      // Note: In production, use a dedicated ENS service or library
      const response = await fetch(
        `https://api.ensideas.com/ens/resolve/${address}`,
      );

      if (!response.ok) {
        return { name: null, avatar: null };
      }

      const data = await response.json();
      return {
        name: data.name || null,
        avatar: data.avatar || null,
      };
    } catch (error) {
      console.warn("ENS lookup failed:", error);
      return { name: null, avatar: null };
    }
  }

  private async resolveENSToAddress(ensName: string): Promise<string | null> {
    try {
      // Use public ENS resolver
      const response = await fetch(
        `https://api.ensideas.com/ens/resolve/${ensName}`,
      );

      if (!response.ok) {
        return null;
      }

      const data = await response.json();
      return data.address?.toLowerCase() || null;
    } catch (error) {
      console.warn("ENS resolution failed:", error);
      return null;
    }
  }

  private async lookupFarcaster(
    address: string,
  ): Promise<FarcasterIdentity | null> {
    try {
      // Internal server-side fetches must use absolute URLs.
      const baseUrl =
        process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
      const response = await fetch(`${baseUrl}/api/farcaster/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address }),
      });

      if (!response.ok) {
        return null;
      }

      const data = await response.json();
      return data.identity || null;
    } catch (error) {
      console.warn("Farcaster lookup failed:", error);
      return null;
    }
  }

  private async lookupSocialHandles(
    address: string,
  ): Promise<{ twitter?: string; farcaster?: string; github?: string; lens?: string; solana?: string } | null> {
    try {
      const { getSocialHandles } = await import("@/lib/web3bio");
      return await getSocialHandles(address);
    } catch (error) {
      console.warn("Social handles lookup failed:", error);
      return null;
    }
  }

  /**
   * Select best Ethos data from multiple sources
   * Prioritizes highest score and most complete profile
   */
  private selectBestEthosData(
    datasets: Array<{ score: EthosScore | null; profile: EthosProfile | null }>
  ): { score: EthosScore | null; profile: EthosProfile | null } {
    const validDatasets = datasets.filter(
      (d): d is { score: EthosScore; profile: EthosProfile | null } => d.score !== null
    );

    if (validDatasets.length === 0) {
      return { score: null, profile: null };
    }

    // Sort by score (highest first)
    const sorted = validDatasets.sort((a, b) =>
      (b.score.score || 0) - (a.score.score || 0)
    );

    return sorted[0];
  }

  // Input type detection

  private isAddress(input: string): boolean {
    // Ethereum address (0x + 40 hex chars) or Solana address (32-44 alphanumeric)
    // Solana addresses are case-sensitive and use Base58.
    return (
      /^0x[a-fA-F0-9]{40}$/.test(input) ||
      /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(input) ||
      // Lenient fallback for other wallet formats or those with minor typos
      (/^[a-zA-Z0-9]{30,65}$/.test(input) && !input.includes("."))
    );
  }

  private isENS(input: string): boolean {
    // ENS name (something.eth)
    return input.endsWith(".eth");
  }

  private isFarcasterHandle(input: string): boolean {
    // Farcaster handle (@username or username)
    return (
      input.startsWith("@") || (!input.includes(".") && !this.isAddress(input))
    );
  }

  private isLensHandle(input: string): boolean {
    // Lens handle (something.lens)
    return input.endsWith(".lens");
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
