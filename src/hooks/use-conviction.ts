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
          if (targetShowcase) {
            // In showcase mode, we simulate the fetch delay but return real static data
            await new Promise((resolve) => setTimeout(resolve, 600));
            setEthosData(
              targetShowcase.ethosScore,
              targetShowcase.ethosProfile,
            );
            addLog(`> ETHOS_SCORE_FOUND: ${targetShowcase.ethosScore.score}`);
          } else {
            // Real Data Fetch with retry
            const [score, profile] = await Promise.all([
              retryWithBackoff(() => ethosClient.getScoreByAddress(activeAddress), {
                maxRetries: 2,
              }).catch((e) => {
                console.warn("Ethos Score Fetch Error:", e);
                return null;
              }),
              retryWithBackoff(() => ethosClient.getProfileByAddress(activeAddress), {
                maxRetries: 2,
              }).catch((e) => {
                console.warn("Ethos Profile Fetch Error:", e);
                return null;
              }),
            ]);

            setEthosData(score, profile);
            if (score?.score) {
              addLog(`> ETHOS_SCORE_FOUND: ${score.score}`);
            } else {
              addLog(`> ETHOS_SCORE: UNKNOWN`);
            }
          }
        } catch (error) {
          console.error("Ethos fetch failed", error);
          addLog(`> ETHOS_CONNECTION_ERROR`);
          setEthosData(null, null);
        }

        await new Promise((resolve) => setTimeout(resolve, 800));

        // Step 3: Transaction Analysis
        setAnalysisStep("Scanning tx history...");
        addLog(`> INITIATING DEEP SCAN (${parameters.timeHorizon} DAYS)...`);

        if (targetShowcase) {
          // Showcase Mode: Use pre-calculated data
          await new Promise((resolve) => setTimeout(resolve, 800));
          addLog(`> INDEXING 142 TRANSACTIONS...`);

          await new Promise((resolve) => setTimeout(resolve, 800));
          setAnalysisStep("Analyzing exits...");
          addLog(`> DETECTING PREMATURE EXITS...`);
          addLog(`> CALC_PATIENCE_TAX...`);

          await new Promise((resolve) => setTimeout(resolve, 1000));
          setAnalysisStep("Calculating score...");
          addLog(`> GENERATING CONVICTION METRICS...`);
          await new Promise((resolve) => setTimeout(resolve, 600));
          addLog(`> ANALYSIS COMPLETE.`);

          setConvictionMetrics(targetShowcase.convictionMetrics);
          
          // Save to history
          saveConvictionAnalysis(
            activeAddress,
            chain,
            targetShowcase.convictionMetrics,
            parameters.timeHorizon,
            true // isShowcase
          );
        } else {
          // Real User Mode: Fetch and analyze actual transactions via server API
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
              false // isShowcase
            );

          } catch (error) {
            console.error("Transaction analysis failed:", error);
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
        }

        finishAnalysis();
      } catch (error) {
        console.error("Analysis failed", error);
        addLog(`> CRITICAL ERROR: ${error}`);
        setAnalysisStep("System Failure");
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
    ],
  );

  return {
    analyzeWallet,
    isAnalyzing,
    isConnected: isEvmConnected || isSolanaConnected,
    activeAddress: isEvmConnected ? evmAddress : solanaAddress,
    isShowcaseMode,
  };
}