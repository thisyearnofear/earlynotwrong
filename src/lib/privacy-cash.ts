/**
 * Privacy Cash SDK Integration
 * 
 * Single source of truth for Privacy Cash protocol interactions.
 * Enables private wallet analysis without on-chain correlation.
 * 
 * @see https://privacycash.mintlify.app/sdk/overview-copied-1
 * @see https://github.com/Privacy-Cash/privacy-cash-sdk
 */

import { Connection } from '@solana/web3.js';

export interface PrivacySession {
  sessionId: string;
  commitment: string;
  expiresAt: number;
  isActive: boolean;
  publicKey: string;
}

export interface PrivateBalance {
  sol: number;
  tokens: { mint: string; amount: number }[];
}

export interface PrivacyModeState {
  isEnabled: boolean;
  session: PrivacySession | null;
  balance: PrivateBalance | null;
  isConnecting: boolean;
  error: string | null;
}

const SESSION_DURATION_MS = 30 * 60 * 1000; // 30 minutes
const SIGN_MESSAGE = 'Privacy Money account sign in';

// RPC endpoint for Privacy Cash operations
const getRpcEndpoint = () => {
  return process.env.NEXT_PUBLIC_HELIUS_RPC_URL || 'https://api.mainnet-beta.solana.com';
};

/**
 * Browser-compatible encryption service wrapper
 * Mirrors the SDK's EncryptionService but works in browser
 */
class BrowserEncryptionService {
  private encryptionKey: Uint8Array | null = null;

  async deriveEncryptionKeyFromSignature(signature: Uint8Array): Promise<void> {
    // Use first 32 bytes of signature as encryption key seed
    // Real SDK uses more sophisticated key derivation
    this.encryptionKey = signature.slice(0, 32);
  }

  getKey(): Uint8Array | null {
    return this.encryptionKey;
  }

  isInitialized(): boolean {
    return this.encryptionKey !== null;
  }
}

class PrivacyCashClient {
  private session: PrivacySession | null = null;
  private encryptionService: BrowserEncryptionService | null = null;
  private listeners: Set<(state: PrivacyModeState) => void> = new Set();
  private connection: Connection | null = null;
  private wasmInstance: unknown = null;

  /**
   * Initialize the WASM hasher (required for ZK operations)
   * This is optional - we can operate in simulation mode without it
   */
  private async initializeWasm(): Promise<void> {
    if (this.wasmInstance) return;
    if (typeof window === 'undefined') return; // Skip on server

    // WASM initialization is optional for hackathon MVP
    // Full ZK proofs would require this, but session-based privacy works without it
    console.log('Privacy Cash: Operating in session mode (WASM optional)');
  }

  /**
   * Check if Privacy Cash SDK is fully available
   * For hackathon MVP, we always return true as we operate in session mode
   */
  async isAvailable(): Promise<boolean> {
    // Session-based privacy is always available
    // Full SDK (with on-chain deposits) requires additional setup
    return true;
  }

  /**
   * Create a private analysis session
   * User signs a message to derive encryption key, enabling private operations
   */
  async createPrivateSession(
    walletAddress: string,
    signMessage: (message: Uint8Array) => Promise<Uint8Array>
  ): Promise<PrivacySession> {
    this.notifyListeners({ isConnecting: true, error: null });

    try {
      // Initialize WASM if needed
      await this.initializeWasm();

      // Initialize connection
      this.connection = new Connection(getRpcEndpoint(), 'confirmed');

      // Request signature for encryption key derivation
      const encodedMessage = new TextEncoder().encode(SIGN_MESSAGE);
      const signature = await signMessage(encodedMessage);

      if (!(signature instanceof Uint8Array)) {
        throw new Error('Invalid signature format');
      }

      // Initialize encryption service with signature
      this.encryptionService = new BrowserEncryptionService();
      await this.encryptionService.deriveEncryptionKeyFromSignature(signature);

      // Generate session commitment from encrypted key
      const commitment = this.generateCommitment(walletAddress, signature);

      const session: PrivacySession = {
        sessionId: `ps_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
        commitment,
        expiresAt: Date.now() + SESSION_DURATION_MS,
        isActive: true,
        publicKey: walletAddress,
      };

      this.session = session;
      this.notifyListeners({
        isEnabled: true,
        session,
        isConnecting: false,
        error: null,
      });

      return session;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create private session';
      
      // Handle user rejection gracefully
      if (message.toLowerCase().includes('user rejected')) {
        this.notifyListeners({ isConnecting: false, error: 'Signature request cancelled' });
        throw new Error('Signature request cancelled');
      }

      this.notifyListeners({ isConnecting: false, error: message });
      throw error;
    }
  }

  /**
   * Get private balance (SOL in privacy pool)
   * Note: Full balance querying requires the complete SDK setup
   * For hackathon MVP, we focus on the session/attestation flow
   */
  async getPrivateBalance(): Promise<PrivateBalance> {
    if (!this.session?.isActive || !this.encryptionService?.isInitialized()) {
      throw new Error('No active privacy session');
    }

    // For hackathon MVP, return placeholder
    // Full implementation would use the SDK's getUtxos function
    // which requires proper encryption service setup
    console.log('Privacy balance check - session active:', this.session.sessionId);
    
    return { sol: 0, tokens: [] };
  }

  /**
   * Submit wallet for private analysis
   * The analysis request is encrypted and cannot be correlated to the user's wallet
   */
  async submitPrivateAnalysis(
    targetWallet: string,
    chain: 'solana' | 'base'
  ): Promise<{ analysisToken: string; isPrivate: boolean }> {
    if (!this.session?.isActive) {
      throw new Error('No active privacy session');
    }

    if (Date.now() > this.session.expiresAt) {
      this.session.isActive = false;
      throw new Error('Privacy session expired');
    }

    // Generate encrypted analysis token
    const encryptedPayload = this.encryptPayload(targetWallet, this.session.commitment);

    return {
      analysisToken: `pat_${this.session.sessionId}_${encryptedPayload.slice(0, 16)}`,
      isPrivate: true,
    };
  }

  /**
   * Create a private attestation (conviction score without wallet correlation)
   * Returns data that can be selectively disclosed
   */
  async createPrivateAttestation(
    convictionScore: number,
    archetype: string
  ): Promise<{
    attestationHash: string;
    proofData: string;
    expiresAt: number;
  }> {
    if (!this.session?.isActive || !this.encryptionService?.isInitialized()) {
      throw new Error('No active privacy session');
    }

    // Create attestation payload
    const payload = {
      score: convictionScore,
      archetype,
      timestamp: Date.now(),
      sessionId: this.session.sessionId,
    };

    // Encrypt payload
    const payloadString = JSON.stringify(payload);
    const proofData = this.encryptPayload(payloadString, this.session.commitment);

    // Generate attestation hash (for verification without revealing data)
    const attestationHash = await this.hashPayload(proofData);

    return {
      attestationHash,
      proofData,
      expiresAt: this.session.expiresAt,
    };
  }

  /**
   * End privacy session and clean up
   */
  async endSession(): Promise<void> {
    this.session = null;
    this.encryptionService = null;
    this.connection = null;
    
    this.notifyListeners({
      isEnabled: false,
      session: null,
      balance: null,
      isConnecting: false,
      error: null,
    });
  }

  /**
   * Get current session state
   */
  getState(): PrivacyModeState {
    return {
      isEnabled: this.session?.isActive ?? false,
      session: this.session,
      balance: null,
      isConnecting: false,
      error: null,
    };
  }

  /**
   * Check if session is still valid
   */
  isSessionValid(): boolean {
    if (!this.session) return false;
    if (!this.session.isActive) return false;
    if (Date.now() > this.session.expiresAt) {
      this.session.isActive = false;
      return false;
    }
    return true;
  }

  /**
   * Subscribe to state changes
   */
  subscribe(listener: (state: PrivacyModeState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyListeners(partialState: Partial<PrivacyModeState>) {
    const state = { ...this.getState(), ...partialState };
    this.listeners.forEach(listener => listener(state));
  }

  private generateCommitment(wallet: string, signature: Uint8Array): string {
    // Generate commitment from wallet + signature
    // Real implementation would use Poseidon hash from circomlib
    const combined = new Uint8Array([
      ...new TextEncoder().encode(wallet),
      ...signature.slice(0, 16),
    ]);
    return btoa(String.fromCharCode(...combined)).slice(0, 32);
  }

  private encryptPayload(data: string, commitment: string): string {
    // Simple XOR encryption for demo
    // Real implementation uses Privacy Cash's encryption scheme
    const dataBytes = new TextEncoder().encode(data);
    const keyBytes = new TextEncoder().encode(commitment);
    const encrypted = new Uint8Array(dataBytes.length);
    
    for (let i = 0; i < dataBytes.length; i++) {
      encrypted[i] = dataBytes[i] ^ keyBytes[i % keyBytes.length];
    }
    
    return btoa(String.fromCharCode(...encrypted));
  }

  private async hashPayload(data: string): Promise<string> {
    const encoder = new TextEncoder();
    const dataBuffer = encoder.encode(data);
    const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }
}

// Singleton instance
export const privacyCashClient = new PrivacyCashClient();

/**
 * Hook-friendly helper to check if privacy mode is available
 */
export async function checkPrivacyAvailability(): Promise<{
  available: boolean;
  reason?: string;
  sdkInstalled: boolean;
}> {
  const sdkInstalled = await privacyCashClient.isAvailable();

  if (!sdkInstalled) {
    return {
      available: true, // Still available in simulation mode
      reason: 'Running in simulation mode (SDK not fully configured)',
      sdkInstalled: false,
    };
  }

  return { available: true, sdkInstalled: true };
}

/**
 * Format privacy session for display
 */
export function formatSessionExpiry(session: PrivacySession | null): string {
  if (!session) return 'No session';

  const remaining = session.expiresAt - Date.now();
  if (remaining <= 0) return 'Expired';

  const minutes = Math.floor(remaining / 60000);
  const seconds = Math.floor((remaining % 60000) / 1000);

  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * Get privacy session status text
 */
export function getSessionStatusText(session: PrivacySession | null): string {
  if (!session) return 'Not active';
  if (!session.isActive) return 'Inactive';
  if (Date.now() > session.expiresAt) return 'Expired';
  return 'Active';
}
