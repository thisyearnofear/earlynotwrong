import { useState, useEffect, useCallback } from "react";
import { useAccount } from "wagmi";
import { useWallet } from "@solana/wallet-adapter-react";
import { toast } from "sonner";

export interface PersonalWatchlistEntry {
  address: string;
  chain: "solana" | "base";
  name?: string;
  convictionScore?: number;
  ethosScore?: number;
  archetype?: string;
  addedAt: number;
  lastAnalyzed?: number;
}

const STORAGE_KEY = "enw_personal_watchlist";

export function usePersonalWatchlist() {
  const { address: evmAddress, isConnected: isEvmConnected } = useAccount();
  const { publicKey: solanaPublicKey, connected: isSolanaConnected } = useWallet();
  
  // Determine current user address
  const userAddress = isEvmConnected ? evmAddress : (isSolanaConnected ? solanaPublicKey?.toBase58() : null);

  const [watchlist, setWatchlist] = useState<PersonalWatchlistEntry[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // Helper to load from Local Storage
  const loadFromLocalStorage = useCallback(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        return JSON.parse(stored);
      }
    } catch (e) {
      console.warn("Failed to load personal watchlist", e);
    }
    return [];
  }, []);

  // Helper to save to Local Storage
  const saveToLocalStorage = useCallback((list: PersonalWatchlistEntry[]) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  }, []);

  // Sync Strategy:
  // 1. If not connected: Use LocalStorage purely.
  // 2. If connected: Fetch DB list. Merge with LocalStorage (if any new items there). Save merged back to DB. Clear LocalStorage? 
  //    Actually, keeping LocalStorage as a "guest cache" is fine, but we should prioritize DB when connected.
  
  useEffect(() => {
    async function loadWatchlist() {
      setIsLoading(true);
      
      // A. Guest Mode: Load Local Storage
      if (!userAddress) {
        const local = loadFromLocalStorage();
        setWatchlist(local);
        setIsLoaded(true);
        setIsLoading(false);
        return;
      }

      // B. Authenticated Mode: Fetch from API
      try {
        const response = await fetch(`/api/user/watchlist?userAddress=${userAddress}`);
        const data = await response.json();

        if (data.watchlist) {
          // Map DB response to UI format
          const dbList: PersonalWatchlistEntry[] = data.watchlist.map((item: any) => ({
            address: item.watchedAddress,
            chain: item.chain,
            name: item.name,
            // Use latest live data from DB join if available
            convictionScore: item.latestScore,
            archetype: item.latestArchetype,
            addedAt: new Date(item.createdAt).getTime(),
            lastAnalyzed: item.latestAnalyzedAt ? new Date(item.latestAnalyzedAt).getTime() : undefined,
          }));

          setWatchlist(dbList);
          
          // Optional: Check if we have local items to migrate? 
          // For simplicity, let's keep them separate for now or maybe "Import local to account" feature later.
          // Merging automatically can be confusing if user switches accounts.
        }
      } catch (error) {
        console.error("Failed to fetch watchlist", error);
        // Fallback to local if API fails? Maybe not, could be confusing.
      } finally {
        setIsLoaded(true);
        setIsLoading(false);
      }
    }

    loadWatchlist();
  }, [userAddress, loadFromLocalStorage]);

  const addToWatchlist = useCallback(async (entry: Omit<PersonalWatchlistEntry, "addedAt">) => {
    // 1. Optimistic Update
    const newEntry = { ...entry, addedAt: Date.now() };
    setWatchlist((prev) => {
      if (prev.some((item) => item.address === entry.address && item.chain === entry.chain)) {
        return prev;
      }
      return [newEntry, ...prev];
    });

    // 2. Persist
    if (!userAddress) {
      // Local Storage
      const current = loadFromLocalStorage();
      if (!current.some((item: PersonalWatchlistEntry) => item.address === entry.address && item.chain === entry.chain)) {
        saveToLocalStorage([newEntry, ...current]);
      }
    } else {
      // API
      try {
        await fetch("/api/user/watchlist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userAddress,
            watchedAddress: entry.address,
            chain: entry.chain,
            name: entry.name,
          }),
        });
      } catch (error) {
        console.error("Failed to save to DB", error);
        toast.error("Failed to sync with account");
        // Revert optimistic update? For now, we'll leave it in UI state but it won't persist on refresh.
      }
    }
  }, [userAddress, loadFromLocalStorage, saveToLocalStorage]);

  const removeFromWatchlist = useCallback(async (address: string, chain: "solana" | "base") => {
    // 1. Optimistic Update
    setWatchlist((prev) => prev.filter((item) => !(item.address === address && item.chain === chain)));

    // 2. Persist
    if (!userAddress) {
      // Local Storage
      const current = loadFromLocalStorage();
      const updated = current.filter((item: PersonalWatchlistEntry) => !(item.address === address && item.chain === chain));
      saveToLocalStorage(updated);
    } else {
      // API
      try {
        await fetch(`/api/user/watchlist?userAddress=${userAddress}&watchedAddress=${address}&chain=${chain}`, {
          method: "DELETE",
        });
      } catch (error) {
        console.error("Failed to delete from DB", error);
        toast.error("Failed to sync with account");
      }
    }
  }, [userAddress, loadFromLocalStorage, saveToLocalStorage]);

  const isWatched = useCallback(
    (address: string, chain: "solana" | "base") => {
      return watchlist.some((item) => item.address === address && item.chain === chain);
    },
    [watchlist]
  );

  return {
    watchlist,
    addToWatchlist,
    removeFromWatchlist,
    isWatched,
    isLoaded,
    isLoading
  };
}