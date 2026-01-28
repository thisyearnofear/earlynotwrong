/**
 * Memory Protocol Integration
 * Cross-chain identity resolution via Memory Protocol's Identity Graph API
 * 
 * Key Benefits:
 * - Links Solana ↔ EVM addresses through verified social connections
 * - Aggregates Twitter, Farcaster, ENS, Lens, GitHub identities
 * - Provides source verification for identity claims
 * 
 * @see https://docs.memoryproto.co/introduction
 */

const MEMORY_API_BASE = 'https://api.memoryproto.co';

/**
 * Identity node in Memory's graph
 */
export interface MemoryIdentity {
  id: string;
  username: string | null;
  url: string | null;
  avatar: string | null;
  platform: 
    | 'ethereum' 
    | 'solana' 
    | 'farcaster' 
    | 'twitter' 
    | 'ens' 
    | 'basenames' 
    | 'lens' 
    | 'github' 
    | 'zora'
    | 'talent-protocol'
    | 'website'
    | 'email';
  social: {
    followers: number;
    following: number;
    verified: boolean | null;
  } | null;
  sources: Array<{
    platform: string;
    id: string;
    verified: boolean;
  }>;
}

/**
 * Aggregated cross-chain identity from Memory
 */
export interface MemoryCrossChainIdentity {
  // Wallet addresses
  ethereumAddresses: string[];
  solanaAddresses: string[];
  
  // Social identities
  twitter?: { username: string; followers?: number; verified?: boolean };
  farcaster?: { username: string; fid?: string; followers?: number };
  ens?: string;
  basenames?: string;
  lens?: string;
  github?: { username: string; followers?: number };
  
  // Raw identity graph
  identities: MemoryIdentity[];
  
  // Metadata
  resolvedAt: string;
  primaryIdentity: string;
}

class MemoryProtocolClient {
  private apiKey: string | null;

  constructor() {
    this.apiKey = process.env.MEMORY_API_KEY || null;
  }

  isConfigured(): boolean {
    return !!this.apiKey;
  }

  private getHeaders(): Record<string, string> {
    if (!this.apiKey) {
      throw new Error('Memory Protocol API key not configured');
    }
    return {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    };
  }

  /**
   * Get identity graph by wallet address (EVM or ENS/Basename)
   */
  async getIdentityByWallet(address: string): Promise<MemoryIdentity[] | null> {
    if (!this.isConfigured()) {
      console.warn('[Memory] API key not configured');
      return null;
    }

    try {
      const response = await fetch(
        `${MEMORY_API_BASE}/identities/wallet/${address}?verified=true`,
        { headers: this.getHeaders() }
      );

      if (!response.ok) {
        if (response.status === 401) {
          console.error('[Memory] Invalid API key');
        }
        return null;
      }

      return await response.json();
    } catch (error) {
      console.warn('[Memory] Wallet lookup failed:', error);
      return null;
    }
  }

  /**
   * Get identity graph by Twitter username
   */
  async getIdentityByTwitter(username: string): Promise<MemoryIdentity[] | null> {
    if (!this.isConfigured()) return null;

    try {
      const cleanUsername = username.replace('@', '');
      const response = await fetch(
        `${MEMORY_API_BASE}/identities/twitter/${cleanUsername}?verified=true`,
        { headers: this.getHeaders() }
      );

      if (!response.ok) return null;
      return await response.json();
    } catch (error) {
      console.warn('[Memory] Twitter lookup failed:', error);
      return null;
    }
  }

  /**
   * Get identity graph by Farcaster username
   */
  async getIdentityByFarcaster(username: string): Promise<MemoryIdentity[] | null> {
    if (!this.isConfigured()) return null;

    try {
      const cleanUsername = username.replace('@', '');
      const response = await fetch(
        `${MEMORY_API_BASE}/identities/farcaster/username/${cleanUsername}?verified=true`,
        { headers: this.getHeaders() }
      );

      if (!response.ok) return null;
      return await response.json();
    } catch (error) {
      console.warn('[Memory] Farcaster lookup failed:', error);
      return null;
    }
  }

  /**
   * Get identity graph by Farcaster FID
   */
  async getIdentityByFid(fid: string | number): Promise<MemoryIdentity[] | null> {
    if (!this.isConfigured()) return null;

    try {
      const response = await fetch(
        `${MEMORY_API_BASE}/identities/farcaster/fid/${fid}?verified=true`,
        { headers: this.getHeaders() }
      );

      if (!response.ok) return null;
      return await response.json();
    } catch (error) {
      console.warn('[Memory] Farcaster FID lookup failed:', error);
      return null;
    }
  }

  /**
   * Resolve full cross-chain identity from any input
   * This is the main entry point for cross-chain address resolution
   */
  async resolveCrossChainIdentity(input: string): Promise<MemoryCrossChainIdentity | null> {
    let identities: MemoryIdentity[] | null = null;

    // Determine input type and resolve
    if (input.startsWith('0x') || input.endsWith('.eth') || input.endsWith('.base.eth')) {
      identities = await this.getIdentityByWallet(input);
    } else if (input.startsWith('@')) {
      // Try Farcaster first, then Twitter
      identities = await this.getIdentityByFarcaster(input);
      if (!identities || identities.length === 0) {
        identities = await this.getIdentityByTwitter(input);
      }
    } else if (/^\d+$/.test(input)) {
      // Numeric = Farcaster FID
      identities = await this.getIdentityByFid(input);
    } else {
      // Try wallet first, then social handles
      identities = await this.getIdentityByWallet(input);
      if (!identities || identities.length === 0) {
        identities = await this.getIdentityByFarcaster(input);
      }
      if (!identities || identities.length === 0) {
        identities = await this.getIdentityByTwitter(input);
      }
    }

    if (!identities || identities.length === 0) {
      return null;
    }

    return this.aggregateIdentities(identities, input);
  }

  /**
   * Find linked Solana addresses for an EVM address
   */
  async findLinkedSolanaAddresses(evmAddress: string): Promise<string[]> {
    const identity = await this.resolveCrossChainIdentity(evmAddress);
    return identity?.solanaAddresses || [];
  }

  /**
   * Find linked EVM addresses for a Solana address
   * Note: Requires the Solana address to be linked via social identity (Twitter/Farcaster)
   */
  async findLinkedEvmAddresses(solanaAddress: string): Promise<string[]> {
    // Solana addresses aren't directly queryable, but we can try via social links
    // This requires the user to have linked their Solana wallet to a social identity
    // For now, we'll return empty and rely on Web3.bio for Solana → EVM bridging
    console.warn('[Memory] Direct Solana lookup not yet supported, use social handle bridging');
    return [];
  }

  /**
   * Find Twitter handle for wallet (useful for Ethos UserKey lookups)
   */
  async findTwitterHandle(address: string): Promise<string | null> {
    const identity = await this.resolveCrossChainIdentity(address);
    return identity?.twitter?.username || null;
  }

  /**
   * Aggregate raw identities into structured cross-chain identity
   */
  private aggregateIdentities(
    identities: MemoryIdentity[], 
    primaryIdentity: string
  ): MemoryCrossChainIdentity {
    const ethereumAddresses: string[] = [];
    const solanaAddresses: string[] = [];

    let twitter: MemoryCrossChainIdentity['twitter'];
    let farcaster: MemoryCrossChainIdentity['farcaster'];
    let ens: string | undefined;
    let basenames: string | undefined;
    let lens: string | undefined;
    let github: MemoryCrossChainIdentity['github'];

    for (const identity of identities) {
      switch (identity.platform) {
        case 'ethereum':
          if (identity.id && !ethereumAddresses.includes(identity.id.toLowerCase())) {
            ethereumAddresses.push(identity.id.toLowerCase());
          }
          break;
        case 'solana':
          if (identity.id && !solanaAddresses.includes(identity.id)) {
            solanaAddresses.push(identity.id);
          }
          break;
        case 'twitter':
          if (identity.username) {
            twitter = {
              username: identity.username,
              followers: identity.social?.followers,
              verified: identity.social?.verified || undefined,
            };
          }
          break;
        case 'farcaster':
          if (identity.username || identity.id) {
            farcaster = {
              username: identity.username || identity.id,
              fid: identity.id,
              followers: identity.social?.followers,
            };
          }
          break;
        case 'ens':
          ens = identity.id;
          break;
        case 'basenames':
          basenames = identity.id;
          break;
        case 'lens':
          lens = identity.username || identity.id;
          break;
        case 'github':
          if (identity.username) {
            github = {
              username: identity.username,
              followers: identity.social?.followers,
            };
          }
          break;
      }
    }

    return {
      ethereumAddresses,
      solanaAddresses,
      twitter,
      farcaster,
      ens,
      basenames,
      lens,
      github,
      identities,
      resolvedAt: new Date().toISOString(),
      primaryIdentity,
    };
  }
}

// Singleton instance
export const memoryClient = new MemoryProtocolClient();

/**
 * Convenience function: Find linked addresses across chains
 */
export async function findLinkedAddresses(address: string): Promise<{
  ethereumAddresses: string[];
  solanaAddresses: string[];
  twitter?: string;
}> {
  const identity = await memoryClient.resolveCrossChainIdentity(address);
  
  if (!identity) {
    return {
      ethereumAddresses: address.startsWith('0x') ? [address.toLowerCase()] : [],
      solanaAddresses: !address.startsWith('0x') ? [address] : [],
    };
  }

  return {
    ethereumAddresses: identity.ethereumAddresses,
    solanaAddresses: identity.solanaAddresses,
    twitter: identity.twitter?.username,
  };
}

/**
 * Convenience function: Bridge Solana address to EVM for trust scoring
 */
export async function bridgeSolanaToEvm(solanaAddress: string, twitter?: string): Promise<{
  evmAddress: string | null;
  twitter: string | null;
  source: 'memory' | 'twitter-bridge' | 'none';
}> {
  // Strategy 1: Try Memory Protocol if Twitter handle is known
  if (twitter) {
    const identity = await memoryClient.getIdentityByTwitter(twitter);
    if (identity && identity.length > 0) {
      const aggregated = memoryClient['aggregateIdentities'](identity, twitter);
      if (aggregated.ethereumAddresses.length > 0) {
        return {
          evmAddress: aggregated.ethereumAddresses[0],
          twitter: aggregated.twitter?.username || twitter,
          source: 'memory',
        };
      }
    }
  }

  // Strategy 2: No direct Solana → EVM path in Memory yet
  // Fall back to returning twitter for Ethos UserKey lookup
  return {
    evmAddress: null,
    twitter: twitter || null,
    source: twitter ? 'twitter-bridge' : 'none',
  };
}
