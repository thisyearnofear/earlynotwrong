"use client";

/**
 * Casper Wallet context provider.
 *
 * The Casper Wallet browser extension injects `window.CasperWalletProvider`
 * asynchronously (the content script loads after the page). This provider
 * polls for it, manages connection lifecycle, and exposes a single shared
 * state so the navbar button and the detail card stay in sync.
 *
 * The extension is the sole signer — no private keys leave the browser.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

// ─── Casper Wallet provider types ───────────────────────────────────────────

interface SignatureResponse {
  signature?: string;
  cancelled?: boolean;
  error?: string;
  errorCode?: number;
}

interface CasperWalletProvider {
  requestConnection(): Promise<boolean>;
  requestSwitchAccount(): Promise<boolean>;
  disconnectFromSite(): Promise<boolean>;
  isConnected(): Promise<boolean>;
  getActivePublicKey(): Promise<string>;
  getActivePublicKeySupports(): Promise<string[]>;
  getVersion(): Promise<string>;
  sign(transactionJson: string, signingPublicKeyHex: string): Promise<SignatureResponse>;
  signMessage(message: string, signingPublicKeyHex: string): Promise<SignatureResponse>;
  on(eventType: string, handler: (event: { detail: string }) => void): () => void;
}

type CasperWalletProviderFactory = (opts?: { timeout: number }) => CasperWalletProvider;

interface CasperWalletState {
  isLocked: boolean;
  isConnected: boolean | undefined;
  activeKey: string | undefined;
  activeKeySupports: string[] | undefined;
}

declare global {
  interface Window {
    CasperWalletProvider?: CasperWalletProviderFactory;
    CasperWalletEventTypes?: Record<string, string>;
  }
}

const EVENT = {
  connected: "connected",
  disconnected: "disconnected",
  activeKeyChanged: "activeKeyChanged",
  tabUpdated: "tabUpdated",
  locked: "locked",
  unlocked: "unlocked",
} as const;

// ─── Context type ───────────────────────────────────────────────────────────

export type CasperStatus =
  | { kind: "loading" }
  | { kind: "not-installed" }
  | { kind: "conflict" }
  | { kind: "disconnected"; provider: CasperWalletProvider }
  | { kind: "connecting"; provider: CasperWalletProvider }
  | { kind: "connected"; provider: CasperWalletProvider; publicKey: string; version?: string }
  | { kind: "locked"; provider: CasperWalletProvider };

interface CasperWalletContextValue {
  status: CasperStatus;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  signMessage: (message: string) => Promise<SignatureResponse>;
  signTransaction: (transactionJson: string) => Promise<SignatureResponse>;
  clearError: () => void;
}

const CasperWalletContext = createContext<CasperWalletContextValue | null>(null);

// ─── Helpers ────────────────────────────────────────────────────────────────

function isLockedError(err: unknown): boolean {
  if (!err) return false;
  const code = (err as { code?: number }).code;
  return code === 1;
}

// ─── Provider component ─────────────────────────────────────────────────────

export function CasperWalletProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<CasperStatus>({ kind: "loading" });
  const [error, setError] = useState<string | null>(null);

  // ── Resolve the injected provider (async) ──
  // The Casper Wallet extension injects `window.CasperWalletProvider` as a
  // **factory function** (NOT a constructor — call without `new`), and
  // `window.CasperWalletEventTypes` as an object. We detect the extension via
  // `CasperWalletEventTypes` (more reliable — it's an object, less likely to
  // be overwritten by other extensions like HashPack).
  useEffect(() => {
    let cancelled = false;
    let attempts = 0;
    const maxAttempts = 60; // ~12s at 200ms intervals

    const poll = setInterval(() => {
      attempts += 1;
      const hasEventTypes =
        typeof window !== "undefined" && window.CasperWalletEventTypes != null;
      const factory =
        typeof window !== "undefined" ? window.CasperWalletProvider : undefined;

      if (hasEventTypes && factory && typeof factory === "function") {
        clearInterval(poll);
        if (cancelled) return;
        try {
          // ⚠️ Call WITHOUT `new` — it's a factory function, not a class.
          const provider = factory();
          provider
            .isConnected()
            .then(async (connected) => {
              if (cancelled) return;
              if (!connected) {
                setStatus({ kind: "disconnected", provider });
                return;
              }
              try {
                const publicKey = await provider.getActivePublicKey();
                if (cancelled) return;
                let version: string | undefined;
                try {
                  version = await provider.getVersion();
                } catch {
                  /* best-effort */
                }
                setStatus({ kind: "connected", provider, publicKey, version });
              } catch (err) {
                if (cancelled) return;
                if (isLockedError(err)) {
                  setStatus({ kind: "locked", provider });
                } else {
                  setStatus({ kind: "disconnected", provider });
                }
              }
            })
            .catch(() => {
              if (!cancelled) setStatus({ kind: "disconnected", provider });
            });
        } catch {
          if (!cancelled) setStatus({ kind: "conflict" });
        }
      } else if (attempts >= maxAttempts) {
        clearInterval(poll);
        if (cancelled) return;
        if (hasEventTypes && (!factory || typeof factory !== "function")) {
          setStatus({ kind: "conflict" });
        } else {
          setStatus({ kind: "not-installed" });
        }
      }
    }, 200);

    return () => {
      cancelled = true;
      clearInterval(poll);
    };
  }, []);

  // ── Subscribe to wallet lifecycle events ──
  useEffect(() => {
    if (status.kind === "loading" || status.kind === "not-installed" || status.kind === "conflict") return;
    const provider = status.provider;

    const unsubscribers: Array<() => void> = [];

    const parse = (event: { detail: string }): CasperWalletState | null => {
      try {
        return JSON.parse(event.detail) as CasperWalletState;
      } catch {
        return null;
      }
    };

    const syncFromState = (state: CasperWalletState | null) => {
      if (!state) return;
      if (state.isLocked) {
        setStatus({ kind: "locked", provider });
        return;
      }
      if (!state.isConnected || !state.activeKey) {
        setStatus({ kind: "disconnected", provider });
        return;
      }
      setStatus({ kind: "connected", provider, publicKey: state.activeKey });
    };

    unsubscribers.push(provider.on(EVENT.connected, (e) => syncFromState(parse(e))));
    unsubscribers.push(provider.on(EVENT.disconnected, (e) => syncFromState(parse(e))));
    unsubscribers.push(provider.on(EVENT.activeKeyChanged, (e) => syncFromState(parse(e))));
    unsubscribers.push(provider.on(EVENT.tabUpdated, (e) => syncFromState(parse(e))));
    unsubscribers.push(provider.on(EVENT.locked, (e) => syncFromState(parse(e))));
    unsubscribers.push(provider.on(EVENT.unlocked, (e) => syncFromState(parse(e))));

    return () => {
      for (const off of unsubscribers) {
        try {
          off();
        } catch {
          /* ignore */
        }
      }
    };
  }, [status]);

  // ── Actions ──

  const connect = useCallback(async () => {
    if (status.kind !== "disconnected" && status.kind !== "locked") return;
    const provider = status.provider;
    setStatus({ kind: "connecting", provider });
    setError(null);
    try {
      const accepted = await provider.requestConnection();
      if (!accepted) {
        setStatus({ kind: "disconnected", provider });
        setError("Connection request was declined in the wallet.");
        return;
      }
      const publicKey = await provider.getActivePublicKey();
      let version: string | undefined;
      try {
        version = await provider.getVersion();
      } catch {
        /* best-effort */
      }
      setStatus({ kind: "connected", provider, publicKey, version });
    } catch (err) {
      setStatus({ kind: "disconnected", provider });
      setError(err instanceof Error ? err.message : "Failed to connect.");
    }
  }, [status]);

  const disconnect = useCallback(async () => {
    if (status.kind !== "connected") return;
    const provider = status.provider;
    try {
      await provider.disconnectFromSite();
    } catch {
      /* ignore — UI syncs via the Disconnected event */
    }
    setStatus({ kind: "disconnected", provider });
  }, [status]);

  const signMessage = useCallback(
    async (message: string): Promise<SignatureResponse> => {
      if (status.kind !== "connected") {
        return { error: "Wallet not connected" };
      }
      return status.provider.signMessage(message, status.publicKey);
    },
    [status],
  );

  const signTransaction = useCallback(
    async (transactionJson: string): Promise<SignatureResponse> => {
      if (status.kind !== "connected") {
        return { error: "Wallet not connected" };
      }
      return status.provider.sign(transactionJson, status.publicKey);
    },
    [status],
  );

  const clearError = useCallback(() => setError(null), []);

  return (
    <CasperWalletContext.Provider
      value={{ status, error, connect, disconnect, signMessage, signTransaction, clearError }}
    >
      {children}
    </CasperWalletContext.Provider>
  );
}

// ─── Hook ───────────────────────────────────────────────────────────────────

export function useCasperWallet(): CasperWalletContextValue | null {
  return useContext(CasperWalletContext);
}
