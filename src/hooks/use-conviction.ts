import { useCallback } from "react";
import { useAccount } from "wagmi";
import { useWallet } from "@solana/wallet-adapter-react";
import { useAppStore } from "@/lib/store";
import { ethosClient } from "@/lib/ethos";
import { apiClient } from "@/lib/api-client";
import { SHOWCASE_WALLETS } from "@/lib/showcase-data";
import { saveConvictionAnalysis } from "@/lib/history";
import { classifyError, formatErrorForTerminal, retryWithBackoff } from "@/lib/error-handler";
import { 
  cacheAnalysis, 
  getCachedAnalysis, 
  hasCachedAnalysis,
  clearExpiredCache 
} from "@/lib/analysis-cache";

export function useConviction() {
  const { address: evmAddress, isConnected: isEvmConnected } = useAccount();
  const { publicKey: solanaPublicKey, connected: isSolanaConnected } =
    useWallet();
  const solanaAddress = solanaPublicKey?.toBase58();

  const {
    startAnalysis,
    setAnalysisStep,
    finishAnalysis,
    setEthosData,
    setConvictionMetrics,
    setPositionAnalyses,
    isAnalyzing,
    addLog,
    reset,
    toggleShowcaseMode,
    isShowcaseMode,
    parameters,
    setError,
    clearError,
  } = useAppStore();

  const analyzeWallet = useCallback(
    async (showcaseId?: string) => {
      // Determine target: Showcase Wallet or Connected User
      let activeAddress: string | null = null;
      let targetShowcase = null;
      let chain: 'solana' | 'base' = 'solana';

      if (showcaseId) {
        targetShowcase = SHOWCASE_WALLETS.find((w) => w.id === showcaseId);
        if (targetShowcase) {
          activeAddress = targetShowcase.address;
          chain = targetShowcase.chain;
          toggleShowcaseMode(true);
        }
      } else {
        if (isEvmConnected && evmAddress) {
          activeAddress = evmAddress;
          chain = 'base';
        } else if (isSolanaConnected && solanaAddress) {
          activeAddress = solanaAddress;
          chain = 'solana';
        }
        toggleShowcaseMode(false);
      }

      if (!activeAddress) {
        console.warn("No wallet connected and no showcase selected");
        return;
      }

      try {
        reset(); // Clear previous state
        clearError(); // Clear any previous errors
        clearExpiredCache(); // Clean up expired cache entries
        startAnalysis();

        // Step 1: Identity Resolution
        const shortAddr = `${activeAddress!.slice(0, 6)}...${activeAddress!.slice(-4)}`;
        setAnalysisStep("Resolving identity...");
        addLog(`> TARGET: ${shortAddr}`);
        addLog(`> NETWORK: ${chain.toUpperCase()}_MAINNET`);
        addLog(`> TIME_HORIZON: ${parameters.timeHorizon}D`);
        addLog(`> MIN_TRADE_VAL: $${parameters.minTradeValue}`);

        await new Promise((resolve) => setTimeout(resolve, 600));
        addLog(`> RESOLVING ON-CHAIN IDENTITY...`);
        await new Promise((resolve) => setTimeout(resolve, 400));

        // Check for cached analysis (non-showcase only)
        if (!targetShowcase && hasCachedAnalysis(activeAddress, chain)) {
          addLog(`> CACHED ANALYSIS DETECTED`);
          addLog(`> TIP: USE CACHED DATA FOR INSTANT RESULTS`);
        }

        // Step 2: Fetch Ethos Reputation
        setAnalysisStep("Querying Ethos Oracle...");
        addLog(`> CONNECTING TO ETHOS REPUTATION ORACLE...`);

        try {
          // Attempt to fetch real Ethos data
          let scorePromise;
          let profilePromise;

          // Special handling for Solana (Ethos is EVM-native, so we resolve via X.com handle if available)
          if (chain === 'solana' && targetShowcase?.ethosProfile?.username) {
            const userKey = `service:x.com:username:${targetShowcase.ethosProfile.username}`;
            addLog(`> RESOLVING ETHOS ID VIA X.COM: @${targetShowcase.ethosProfile.username}`);
            scorePromise = ethosClient.getScoreByUserKey(userKey);
            // Profile lookup by address won't work for Solana, and we don't have profile-by-userkey yet
            // So we'll rely on the fallback for the profile part
            profilePromise = Promise.resolve(null);
          } else {
            // Standard EVM address lookup
            scorePromise = ethosClient.getScoreByAddress(activeAddress);
            profilePromise = ethosClient.getProfileByAddress(activeAddress);
          }

          let [score, profile] = await Promise.all([
            retryWithBackoff(() => scorePromise, {
              maxRetries: 2,
            }).catch((e) => {
              console.warn("Ethos Score Fetch Error:", e);
              return null;
            }),
            retryWithBackoff(() => profilePromise, {
              maxRetries: 2,
            }).catch((e) => {
              console.warn("Ethos Profile Fetch Error:", e);
              return null;
            }),
          ]);

          // Fallback to hardcoded data for Showcase wallets if API fails (or returns nothing)
          if (targetShowcase) {
            if (!score && targetShowcase.ethosScore) {
              score = targetShowcase.ethosScore;
              addLog(`> USING ARCHIVED ETHOS SCORE (LIVE FETCH FAILED)`);
            }
            if (!profile && targetShowcase.ethosProfile) {
              profile = targetShowcase.ethosProfile;
              // Ensure we use the profile with the correct username/links
            }
          }

          setEthosData(score, profile);
          if (score?.score) {
            addLog(`> ETHOS_SCORE_FOUND: ${score.score}`);
          } else {
            addLog(`> ETHOS_SCORE: UNKNOWN`);
          }
        } catch (error) {
          console.error("Ethos fetch failed", error);
          // If critical failure, try fallback one last time
          if (targetShowcase) {
            setEthosData(targetShowcase.ethosScore, targetShowcase.ethosProfile);
            addLog(`> USING ARCHIVED ETHOS DATA (CONNECTION ERROR)`);
          } else {
            addLog(`> ETHOS_CONNECTION_ERROR`);
            setEthosData(null, null);
          }
        }

        await new Promise((resolve) => setTimeout(resolve, 800));

        // Step 3: Transaction Analysis
        setAnalysisStep("Scanning tx history...");
        addLog(`> INITIATING DEEP SCAN (${parameters.timeHorizon} DAYS)...`);

        // Real User Mode & Showcase Mode: Fetch and analyze actual transactions via server API
        // This ensures Showcase wallets prove the platform actually works!
        await new Promise((resolve) => setTimeout(resolve, 600));
        addLog(`> ACCESSING ${chain.toUpperCase()} TRANSACTION HISTORY...`);

        try {
          const txResult = await retryWithBackoff(
            () => apiClient.fetchTransactions(
              activeAddress,
              chain,
              parameters.timeHorizon,
              parameters.minTradeValue
            ),
            { maxRetries: 2, initialDelay: 2000 }
          );

          addLog(`> FOUND ${txResult.count} QUALIFYING TRANSACTIONS`);

          if (txResult.count === 0) {
            // Special handling for Showcase: If live data finds nothing (unlikely for whales),
            // fallback to hardcoded metrics so the demo isn't empty.
            if (targetShowcase) {
              addLog(`> WARNING: LIVE DATA INCOMPLETE, LOADING SNAPSHOT...`);
              setConvictionMetrics(targetShowcase.convictionMetrics);
              // We don't have hardcoded positions, so the list will be empty, 
              // but the score will be visible.
              finishAnalysis();
              return;
            }

            addLog(`> WARNING: INSUFFICIENT TX HISTORY DETECTED`);
            addLog(`> TIP: LOWER MIN_TRADE_VALUE OR EXTEND TIME_HORIZON`);
            addLog(`> OR TRY A SHOWCASE PROFILE TO SEE FULL ANALYSIS`);
            
            setError({
              errorType: "data",
              errorMessage: "No qualifying transactions found",
              errorDetails: "This wallet has no transaction history matching your criteria.",
              canRetry: false,
              canUseCached: hasCachedAnalysis(activeAddress, chain),
              recoveryAction: "Try adjusting the time horizon or minimum trade value, or check your history panel for previous analyses.",
            });
            
            finishAnalysis();
            return;
          }

          await new Promise((resolve) => setTimeout(resolve, 800));
          setAnalysisStep("Grouping positions...");
          addLog(`> GROUPING TRANSACTIONS INTO POSITIONS...`);

          const positions = apiClient.groupTransactionsIntoPositions(txResult.transactions);
          addLog(`> IDENTIFIED ${positions.length} TRADING POSITIONS`);

          await new Promise((resolve) => setTimeout(resolve, 600));
          setAnalysisStep("Analyzing conviction...");
          addLog(`> ANALYZING POST-EXIT PERFORMANCE...`);
          addLog(`> BATCH ANALYZING ${positions.length} POSITIONS (SERVER-SIDE)...`);

          const batchResult = await retryWithBackoff(
            () => apiClient.batchAnalyzePositions(positions, chain),
            { maxRetries: 2, initialDelay: 2000 }
          );

          await new Promise((resolve) => setTimeout(resolve, 400));
          setAnalysisStep("Calculating metrics...");
          addLog(`> CALCULATING CONVICTION SCORE...`);
          await new Promise((resolve) => setTimeout(resolve, 600));

          addLog(`> CONVICTION_SCORE: ${batchResult.metrics.score}`);
          addLog(`> PATIENCE_TAX: $${batchResult.metrics.patienceTax}`);
          addLog(`> ANALYSIS COMPLETE.`);

          setConvictionMetrics(batchResult.metrics);
          setPositionAnalyses(batchResult.positions, chain);
          
          // Get Ethos data for caching
          const currentEthosScore = useAppStore.getState().ethosScore;
          const currentEthosProfile = useAppStore.getState().ethosProfile;
          
          // Cache complete analysis
          cacheAnalysis(
            activeAddress,
            chain,
            batchResult.metrics,
            batchResult.positions,
            currentEthosScore,
            currentEthosProfile,
            parameters
          );
          
          // Save to history
          saveConvictionAnalysis(
            activeAddress,
            chain,
            batchResult.metrics,
            parameters.timeHorizon,
            !!targetShowcase
          );

        } catch (error) {
          console.error("Transaction analysis failed:", error);
          
          // Fallback for Showcase if analysis fails
          if (targetShowcase) {
            addLog(`> LIVE ANALYSIS FAILED, LOADING SNAPSHOT...`);
            setConvictionMetrics(targetShowcase.convictionMetrics);
            finishAnalysis();
            return;
          }

          const classified = classifyError(error);
          const errorLines = formatErrorForTerminal(classified);
          
          errorLines.forEach(line => addLog(line));
          
          setError({
            errorType: classified.type,
            errorMessage: classified.message,
            errorDetails: classified.details,
            canRetry: classified.canRetry,
            canUseCached: hasCachedAnalysis(activeAddress, chain),
            recoveryAction: classified.recoveryAction,
          });
        }

        finishAnalysis();
      } catch (error) {
        console.error("Analysis failed", error);
        const classified = classifyError(error);
        const errorLines = formatErrorForTerminal(classified);
        
        errorLines.forEach(line => addLog(line));
        
        setError({
          errorType: classified.type,
          errorMessage: classified.message,
          errorDetails: classified.details,
          canRetry: classified.canRetry,
          canUseCached: activeAddress ? hasCachedAnalysis(activeAddress, chain) : false,
          recoveryAction: classified.recoveryAction,
        });
        
        setAnalysisStep("Analysis Failed");
        setTimeout(finishAnalysis, 2000);
      }
    },
    [
      isEvmConnected,
      evmAddress,
      isSolanaConnected,
      solanaAddress,
      startAnalysis,
      setAnalysisStep,
      setEthosData,
      setConvictionMetrics,
      finishAnalysis,
      reset,
      toggleShowcaseMode,
      addLog,
      parameters,
      setError,
      clearError,
    ],
  );

  const loadCachedAnalysis = useCallback(
    async (address: string, chain: "solana" | "base") => {
      const cached = getCachedAnalysis(address, chain, parameters);
      
      if (!cached) {
        addLog(`> NO CACHED ANALYSIS FOUND`);
        return false;
      }

      try {
        reset();
        startAnalysis();
        clearError();
        
        addLog(`> LOADING CACHED ANALYSIS...`);
        addLog(`> CACHED: ${new Date(cached.timestamp).toLocaleString()}`);
        
        await new Promise((resolve) => setTimeout(resolve, 500));
        
        // Load cached data
        setEthosData(cached.ethosScore, cached.ethosProfile);
        setConvictionMetrics(cached.convictionMetrics);
        setPositionAnalyses(cached.positionAnalyses, cached.chain);
        
        addLog(`> CONVICTION_SCORE: ${cached.convictionMetrics.score}`);
        addLog(`> CACHED DATA LOADED SUCCESSFULLY`);
        addLog(`> TIP: RUN NEW ANALYSIS FOR LATEST DATA`);
        
        finishAnalysis();
        return true;
      } catch (error) {
        console.error("Failed to load cached analysis:", error);
        addLog(`> ERROR: FAILED TO LOAD CACHED DATA`);
        finishAnalysis();
        return false;
      }
    },
    [parameters, reset, startAnalysis, clearError, setEthosData, setConvictionMetrics, setPositionAnalyses, addLog, finishAnalysis]
  );

  return {
    analyzeWallet,
    loadCachedAnalysis,
    isAnalyzing,
    isConnected: isEvmConnected || isSolanaConnected,
    activeAddress: isEvmConnected ? evmAddress : solanaAddress,
    isShowcaseMode,
  };
}