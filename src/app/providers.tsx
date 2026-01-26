'use client';

import React, { useMemo, useEffect, createContext, useContext, useState, useCallback } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider, createConfig, http } from 'wagmi';
import { base } from 'wagmi/chains';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletAdapterNetwork } from '@solana/wallet-adapter-base';
import { PhantomWalletAdapter, SolflareWalletAdapter } from '@solana/wallet-adapter-wallets';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { clusterApiUrl } from '@solana/web3.js';
import { TooltipProvider } from "@/components/ui/tooltip";
import { miniApp, type MiniAppState } from "@/lib/farcaster-miniapp";

// Default styles for Solana wallet adapter
import '@solana/wallet-adapter-react-ui/styles.css';

// Mini App Context
const MiniAppContext = createContext<{
  state: MiniAppState;
  composeCast: (options: { text?: string; embeds?: [string] | [string, string] }) => Promise<void>;
  addMiniApp: () => Promise<{ added: boolean }>;
  viewProfile: (fid: number) => Promise<void>;
}>({
  state: {
    isReady: false,
    isInMiniApp: false,
    user: null,
    added: false,
    safeAreaInsets: { top: 0, bottom: 0, left: 0, right: 0 },
  },
  composeCast: async () => {},
  addMiniApp: async () => ({ added: false }),
  viewProfile: async () => {},
});

export const useMiniApp = () => useContext(MiniAppContext);

// Wagmi Config for Base
const wagmiConfig = createConfig({
  chains: [base],
  transports: {
    [base.id]: http(),
  },
});

function MiniAppProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<MiniAppState>({
    isReady: false,
    isInMiniApp: false,
    user: null,
    added: false,
    safeAreaInsets: { top: 0, bottom: 0, left: 0, right: 0 },
  });

  useEffect(() => {
    const init = async () => {
      const initialState = await miniApp.initialize();
      setState(initialState);
      
      // Signal ready after a short delay to ensure UI is rendered
      setTimeout(() => miniApp.ready(), 100);
    };

    init();
    return miniApp.subscribe(setState);
  }, []);

  const composeCast = useCallback(
    (options: { text?: string; embeds?: [string] | [string, string] }) => miniApp.composeCast(options),
    []
  );
  const addMiniApp = useCallback(() => miniApp.addMiniApp(), []);
  const viewProfile = useCallback((fid: number) => miniApp.viewProfile(fid), []);

  return (
    <MiniAppContext.Provider value={{ state, composeCast, addMiniApp, viewProfile }}>
      <div
        style={{
          paddingTop: state.safeAreaInsets.top,
          paddingBottom: state.safeAreaInsets.bottom,
          paddingLeft: state.safeAreaInsets.left,
          paddingRight: state.safeAreaInsets.right,
        }}
      >
        {children}
      </div>
    </MiniAppContext.Provider>
  );
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = React.useState(() => new QueryClient());

  // Solana Config
  const network = WalletAdapterNetwork.Mainnet;
  const endpoint = useMemo(() => clusterApiUrl(network), [network]);

  const wallets = useMemo(
    () => [
      new PhantomWalletAdapter(),
      new SolflareWalletAdapter(),
    ],
    []
  );

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <ConnectionProvider endpoint={endpoint}>
          <WalletProvider wallets={wallets} autoConnect>
            <WalletModalProvider>
              <TooltipProvider>
                <MiniAppProvider>
                  {children}
                </MiniAppProvider>
              </TooltipProvider>
            </WalletModalProvider>
          </WalletProvider>
        </ConnectionProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
