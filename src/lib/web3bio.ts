/**
 * Web3.bio Integration
 * Universal identity resolver for Ethereum, ENS, Farcaster, Lens, Solana, and more
 */

const WEB3BIO_API = 'https://api.web3.bio';

export interface Web3BioProfile {
  address: string;
  identity: string;
  platform: 'ens' | 'farcaster' | 'lens' | 'basenames' | 'solana' | 'linea';
  displayName: string;
  avatar: string | null;
  description: string | null;
  links?: {
    twitter?: {
      link: string;
      handle: string;
      sources: string[];
    };
    github?: {
      link: string;
      handle: string;
      sources: string[];
    };
    website?: {
      link: string;
      handle: string;
      sources: string[];
    };
    farcaster?: {
      link: string;
      handle: string;
      sources: string[];
    };
    lens?: {
      link: string;
      handle: string;
      sources: string[];
    };
  };
  social?: {
    uid: number | null;
    follower: number | null;
    following: number | null;
  };
}

export interface UniversalIdentity {
  primaryAddress: string;
  allAddresses: string[];
  profiles: Web3BioProfile[];
  twitterHandle?: string; // Key for Ethos lookup via X.com
  farcasterUsername?: string;
  ensName?: string;
  basename?: string;
}

/**
 * Fetch universal profiles from Web3.bio
 * This returns all connected identities across platforms
 */
export async function resolveUniversalIdentity(
  identity: string
): Promise<UniversalIdentity | null> {
  try {
    const response = await fetch(`${WEB3BIO_API}/profile/${identity}`);

    if (!response.ok) {
      console.warn('Web3.bio lookup failed:', response.status);
      return null;
    }

    const profiles: Web3BioProfile[] = await response.json();

    if (!profiles || profiles.length === 0) {
      return null;
    }

    // Extract all unique addresses
    const allAddresses = [...new Set(profiles.map(p => p.address))];

    // Extract key identities for Ethos lookup
    const twitterHandle = profiles
      .find(p => p.links?.twitter)
      ?.links?.twitter?.handle;

    const farcasterUsername = profiles
      .find(p => p.platform === 'farcaster')
      ?.identity;

    const ensName = profiles
      .find(p => p.platform === 'ens')
      ?.identity;

    const basename = profiles
      .find(p => p.platform === 'basenames')
      ?.identity;

    return {
      primaryAddress: profiles[0].address,
      allAddresses,
      profiles,
      twitterHandle,
      farcasterUsername,
      ensName,
      basename,
    };
  } catch (error) {
    console.warn('Web3.bio resolution failed:', error);
    return null;
  }
}

/**
 * Try to find an Ethos profile URL using Web3.bio data
 * Uses multiple strategies based on available data
 */
export async function findEthosProfileViaWeb3Bio(
  identity: string
): Promise<string | null> {
  const universalId = await resolveUniversalIdentity(identity);

  if (!universalId) {
    return null;
  }

  // Strategy 1: Twitter/X handle (most reliable for Ethos)
  if (universalId.twitterHandle) {
    return `https://app.ethos.network/profile/x/${universalId.twitterHandle}/score`;
  }

  // Strategy 2: Farcaster username
  if (universalId.farcasterUsername) {
    return `https://app.ethos.network/profile/x/${universalId.farcasterUsername}/score`;
  }

  // Strategy 3: ENS name
  if (universalId.ensName) {
    return `https://app.ethos.network/profile/${universalId.ensName}`;
  }

  // Strategy 4: Primary Ethereum address
  if (universalId.primaryAddress.startsWith('0x')) {
    return `https://app.ethos.network/profile/${universalId.primaryAddress}`;
  }

  return null;
}

/**
 * Get the best display identity from Web3.bio
 * Prioritizes ENS/Basename over addresses
 */
export function getBestDisplayIdentity(profiles: Web3BioProfile[]): string {
  // Prioritize human-readable names
  const ensProfile = profiles.find(p => p.platform === 'ens');
  if (ensProfile) return ensProfile.identity;

  const basenameProfile = profiles.find(p => p.platform === 'basenames');
  if (basenameProfile) return basenameProfile.identity;

  const farcasterProfile = profiles.find(p => p.platform === 'farcaster');
  if (farcasterProfile) return farcasterProfile.displayName || farcasterProfile.identity;

  // Fallback to address
  return profiles[0].address;
}

/**
 * Find linked EVM addresses for a Solana address
 * This is crucial for Ethos lookups since Ethos is EVM-native
 */
export async function findLinkedEvmAddresses(
  solanaAddress: string
): Promise<string[]> {
  const universalId = await resolveUniversalIdentity(solanaAddress);

  if (!universalId) {
    return [];
  }

  // Filter for EVM addresses (start with 0x)
  return universalId.allAddresses.filter(addr => addr.startsWith('0x'));
}

/**
 * Get comprehensive social context for an address
 * Useful for displaying rich identity information
 */
export async function getSocialContext(
  address: string
): Promise<{
  avatar?: string;
  displayName?: string;
  bio?: string;
  followers?: number;
  twitterHandle?: string;
  farcasterHandle?: string;
} | null> {
  const universalId = await resolveUniversalIdentity(address);

  if (!universalId) {
    return null;
  }

  // Prioritize Farcaster for social data (most complete)
  const farcasterProfile = universalId.profiles.find(p => p.platform === 'farcaster');
  if (farcasterProfile) {
    return {
      avatar: farcasterProfile.avatar || undefined,
      displayName: farcasterProfile.displayName,
      bio: farcasterProfile.description || undefined,
      followers: farcasterProfile.social?.follower || undefined,
      twitterHandle: universalId.twitterHandle,
      farcasterHandle: farcasterProfile.identity,
    };
  }

  // Fallback to ENS or first available profile
  const primaryProfile = universalId.profiles[0];
  return {
    avatar: primaryProfile.avatar || undefined,
    displayName: primaryProfile.displayName,
    bio: primaryProfile.description || undefined,
    twitterHandle: universalId.twitterHandle,
  };
}

/**
 * Extract social handles from any wallet address
 * Enables cross-chain identity bridging (e.g., Solana → Twitter → Ethos)
 */
export async function getSocialHandles(address: string): Promise<{
  twitter?: string;
  farcaster?: string;
  github?: string;
  lens?: string;
  solana?: string;
} | null> {
  try {
    const universalId = await resolveUniversalIdentity(address);

    if (!universalId) {
      return null;
    }

    const githubProfile = universalId.profiles.find(p => p.links?.github);
    const lensProfile = universalId.profiles.find(p => p.platform === 'lens');
    const solanaProfile = universalId.profiles.find(p => p.platform === 'solana');

    return {
      twitter: universalId.twitterHandle,
      farcaster: universalId.farcasterUsername,
      github: githubProfile?.links?.github?.handle,
      lens: lensProfile?.identity,
      solana: solanaProfile?.address,
    };
  } catch (error) {
    console.warn('Web3.bio social handles extraction failed:', error);
    return null;
  }
}
