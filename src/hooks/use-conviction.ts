import { useCallback } from "react";
import { useAccount } from "wagmi";
import { useWallet } from "@solana/wallet-adapter-react";
import { useAppStore } from "@/lib/store";
import { ethosClient } from "@/lib/ethos";
import { apiClient } from "@/lib/api-client";
import { SHOWCASE_WALLETS } from "@/lib/showcase-data";
import { saveConvictionAnalysis } from "@/lib/history";
import {
  classifyError,
  formatErrorForTerminal,
  retryWithBackoff,
} from "@/lib/error-handler";
import {
  cacheAnalysis,
  getCachedAnalysis,
  hasCachedAnalysis,
  clearExpiredCache,
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
    setFarcasterIdentity,
    setConvictionMetrics,
    setPositionAnalyses,
    setTargetAddress,
    setDataQuality,
    isAnalyzing,
    addLog,
    reset,
    toggleShowcaseMode,
    isShowcaseMode,
    parameters,
    setError,
    clearError,
    incrementDailyAnalysis,
  } = useAppStore();

  const analyzeWallet = useCallback(
    async (addressOrShowcaseId?: string) => {
      // Determine target: Showcase Wallet, Direct Address, or Connected User
      let activeAddress: string | null = null;
      let targetShowcase = null;
      let chain: "solana" | "base" = "solana";

      if (addressOrShowcaseId) {
        targetShowcase = SHOWCASE_WALLETS.find(
          (w) => w.id === addressOrShowcaseId,
        );
        if (targetShowcase) {
          activeAddress = targetShowcase.address;
          chain = targetShowcase.chain;
          toggleShowcaseMode(true);
        } else {
          // Check if it matches a showcase wallet by address
          const showcaseByAddress = SHOWCASE_WALLETS.find(
            (w) => w.address.toLowerCase() === addressOrShowcaseId.toLowerCase(),
          );
          if (showcaseByAddress) {
            activeAddress = showcaseByAddress.address;
            chain = showcaseByAddress.chain;
            toggleShowcaseMode(true);
          } else {
            // If not a showcase ID or address, treat as a direct address
            activeAddress = addressOrShowcaseId;
            // Simple heuristic: 0x prefix = EVM (Base), otherwise assume Solana
            chain = addressOrShowcaseId.startsWith("0x") ? "base" : "solana";
            toggleShowcaseMode(false);
          }
        }
      } else {
        if (isEvmConnected && evmAddress) {
          activeAddress = evmAddress;
          chain = "base";
        } else if (isSolanaConnected && solanaAddress) {
          activeAddress = solanaAddress;
          chain = "solana";
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
        setTargetAddress(activeAddress);
        startAnalysis();
        incrementDailyAnalysis(); // Track daily usage

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

        // Step 2: Fetch Ethos Reputation & Farcaster Identity
        setAnalysisStep("Querying Ethos Oracle...");
        addLog(`> CONNECTING TO ETHOS REPUTATION ORACLE...`);

        try {
          // 1. Resolve Farcaster identity first (works for both chains)
          // This allows us to bridge Solana wallets to EVM-native Ethos scores
          const fid = targetShowcase?.farcasterFid;
          const farcasterIdentity = await retryWithBackoff(
            () => ethosClient.resolveFarcasterIdentity(activeAddress!, fid),
            { maxRetries: 1 },
          ).catch((e) => {
            console.warn("Farcaster Identity Fetch Error:", e);
            return null;
          });

          setFarcasterIdentity(farcasterIdentity);
          if (farcasterIdentity) {
            addLog(`> FARCASTER_IDENTITY: @${farcasterIdentity.username}`);
          }

          // 2. Determine which address/key to use for Ethos lookup
          let ethosLookupAddress = chain === "base" ? activeAddress : null;
          let userKey = null;

          // If Solana, try to bridge via Farcaster verified EVM address
          if (
            chain === "solana" &&
            farcasterIdentity?.verifiedAddresses?.ethAddresses?.length
          ) {
            ethosLookupAddress =
              farcasterIdentity.verifiedAddresses.ethAddresses[0];
            addLog(
              `> LINKED EVM WALLET FOUND: ${ethosLookupAddress.slice(0, 6)}...${ethosLookupAddress.slice(-4)}`,
            );
          }

          // Fallback for Solana showcase wallets with X.com handles
          if (
            chain === "solana" &&
            !ethosLookupAddress &&
            targetShowcase?.ethosProfile?.username
          ) {
            userKey = `service:x.com:username:${targetShowcase.ethosProfile.username}`;
            addLog(
              `> RESOLVING ETHOS ID VIA X.COM: @${targetShowcase.ethosProfile.username}`,
            );
          }

          // 3. Fetch Ethos data using resolved address or userKey
          let score = null;
          let profile = null;

          if (ethosLookupAddress) {
            [score, profile] = await Promise.all([
              retryWithBackoff(
                () => ethosClient.getScoreByAddress(ethosLookupAddress!),
                { maxRetries: 2 },
              ).catch(() => null),
              retryWithBackoff(
                () => ethosClient.getProfileByAddress(ethosLookupAddress!),
                { maxRetries: 2 },
              ).catch(() => null),
            ]);
          } else if (userKey) {
            score = await retryWithBackoff(
              () => ethosClient.getScoreByUserKey(userKey!),
              { maxRetries: 2 },
            ).catch(() => null);
          }

          setEthosData(score, profile);

          if (score?.score) {
            addLog(`> ETHOS_SCORE_FOUND: ${score.score}`);
          } else {
            addLog(`> ETHOS_SCORE: UNKNOWN`);
          }

          // Step 2.5: Fetch unified trust score (includes FairScale for Solana)
          setAnalysisStep("Computing unified trust...");
          addLog(`> FETCHING UNIFIED TRUST SCORE...`);

          try {
            const { trustResolver } = await import("@/lib/services/trust-resolver");
            const unifiedTrust = await trustResolver.resolve(activeAddress!);

            useAppStore.getState().setUnifiedTrustScore(unifiedTrust);

            if (unifiedTrust.score > 0) {
              addLog(`> UNIFIED_TRUST_SCORE: ${unifiedTrust.score}/100 (${unifiedTrust.tier})`);
              if (unifiedTrust.primaryProvider !== 'ethos') {
                addLog(`> PROVIDER: ${unifiedTrust.primaryProvider.toUpperCase()}`);
              }
            } else {
              addLog(`> UNIFIED_TRUST: NO SCORE AVAILABLE`);
            }
          } catch (trustError) {
            console.error("Trust score fetch failed", trustError);
            addLog(`> TRUST_SCORE_ERROR: ${(trustError as Error).message}`);
            useAppStore.getState().setUnifiedTrustScore(null);
          }
        } catch (error) {
          console.error("Ethos fetch failed", error);
          addLog(`> ETHOS_CONNECTION_ERROR`);
          setEthosData(null, null);
          setFarcasterIdentity(null);
        }

        await new Promise((resolve) => setTimeout(resolve, 800));

        // Step 3: Transaction Analysis
        setAnalysisStep("Scanning tx history...");
        addLog(`> INITIATING DEEP SCAN (${parameters.timeHorizon} DAYS)...`);

        // Real User Mode & Showcase Mode: Fetch and analyze actual transactions via server API
        await new Promise((resolve) => setTimeout(resolve, 600));
        addLog(`> ACCESSING ${chain.toUpperCase()} TRANSACTION HISTORY...`);

        try {
          const effectiveMinTradeValue = targetShowcase
            ? Math.min(parameters.minTradeValue, 1)
            : parameters.minTradeValue;
          const txResult = await retryWithBackoff(
            () =>
              apiClient.fetchTransactions(
                activeAddress,
                chain,
                parameters.timeHorizon,
                effectiveMinTradeValue,
              ),
            { maxRetries: 2, initialDelay: 2000 },
          );

          addLog(`> FOUND ${txResult.count} QUALIFYING TRANSACTIONS`);

          // Log and store data quality if available
          if (txResult.quality) {
            const q = txResult.quality;
            addLog(
              `> DATA_QUALITY: SYMBOLS ${q.dataCompleteness.symbolRate}% | PRICES ${q.dataCompleteness.priceRate}% | AVG_SIZE $${q.avgTradeSize.toFixed(0)}`,
            );
            setDataQuality(txResult.quality);
          }

          if (txResult.count === 0) {
            addLog(`> WARNING: INSUFFICIENT TX HISTORY DETECTED`);
            addLog(`> TIP: LOWER MIN_TRADE_VALUE OR EXTEND TIME_HORIZON`);

            const chainDetails =
              chain === "solana"
                ? `This Solana wallet has no token swaps in the last ${parameters.timeHorizon} days above $${parameters.minTradeValue}.`
                : `This Base wallet has no token transfers in the last ${parameters.timeHorizon} days above $${parameters.minTradeValue}.`;

            setError({
              errorType: "data",
              errorMessage: "No trading activity detected",
              errorDetails: chainDetails,
              canRetry: true,
              canUseCached: hasCachedAnalysis(activeAddress, chain),
              recoveryAction:
                "Adjust filters in Settings: try a longer time horizon (e.g., 180 days) or lower minimum trade value (e.g., $10).",
            });

            finishAnalysis();
            return;
          }

          await new Promise((resolve) => setTimeout(resolve, 800));
          setAnalysisStep("Grouping positions...");
          addLog(`> GROUPING TRANSACTIONS INTO POSITIONS...`);

          const positions = apiClient.groupTransactionsIntoPositions(
            txResult.transactions,
          );
          addLog(`> IDENTIFIED ${positions.length} TRADING POSITIONS`);

          await new Promise((resolve) => setTimeout(resolve, 600));
          setAnalysisStep("Analyzing conviction...");
          addLog(`> ANALYZING POST-EXIT PERFORMANCE...`);
          addLog(
            `> BATCH ANALYZING ${positions.length} POSITIONS (SERVER-SIDE)...`,
          );

          // Get current Ethos score for reputation weighting
          const currentEthosScore = useAppStore.getState().ethosScore;
          if (currentEthosScore?.score) {
            addLog(
              `> APPLYING REPUTATION WEIGHTING (ETHOS: ${currentEthosScore.score})...`,
            );
          }

          const batchResult = await retryWithBackoff(
            () =>
              apiClient.batchAnalyzePositions(
                positions,
                chain,
                currentEthosScore?.score,
              ),
            { maxRetries: 2, initialDelay: 2000 },
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

          // Cache results
          const currentEthosProfile = useAppStore.getState().ethosProfile;
          const currentFarcasterIdentity =
            useAppStore.getState().farcasterIdentity;

          cacheAnalysis(
            activeAddress,
            chain,
            batchResult.metrics,
            batchResult.positions,
            currentEthosScore,
            currentEthosProfile,
            currentFarcasterIdentity,
            parameters,
          );

          // Save to Postgres with trust scores and positions
          const currentTrustScore = useAppStore.getState().unifiedTrustScore;
          saveConvictionAnalysis(
            activeAddress,
            chain,
            batchResult.metrics,
            parameters.timeHorizon,
            !!targetShowcase, // isShowcase - only true for showcase wallets, not for custom addresses
            currentTrustScore,
            batchResult.positions.map(p => ({
              tokenAddress: p.tokenAddress,
              tokenSymbol: p.tokenSymbol,
              realizedPnL: p.realizedPnL,
              holdingPeriodDays: p.holdingPeriodDays,
              isEarlyExit: p.isEarlyExit,
            }))
          );
        } catch (error) {
          console.error("Transaction analysis failed:", error);

          const classified = classifyError(error);
          const errorLines = formatErrorForTerminal(classified);

          errorLines.forEach((line) => addLog(line));

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

        errorLines.forEach((line) => addLog(line));

        setError({
          errorType: classified.type,
          errorMessage: classified.message,
          errorDetails: classified.details,
          canRetry: classified.canRetry,
          canUseCached: activeAddress
            ? hasCachedAnalysis(activeAddress, chain)
            : false,
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
      setFarcasterIdentity,
      setTargetAddress,
      setDataQuality,
      setConvictionMetrics,
      setPositionAnalyses,
      finishAnalysis,
      reset,
      toggleShowcaseMode,
      addLog,
      parameters,
      setError,
      clearError,
      incrementDailyAnalysis,
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
        setTargetAddress(address);
        startAnalysis();
        clearError();

        addLog(`> LOADING CACHED ANALYSIS...`);
        addLog(`> CACHED: ${new Date(cached.timestamp).toLocaleString()}`);

        await new Promise((resolve) => setTimeout(resolve, 500));

        // Load cached data
        setEthosData(cached.ethosScore, cached.ethosProfile);
        setFarcasterIdentity(cached.farcasterIdentity);
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
    [
      parameters,
      reset,
      startAnalysis,
      clearError,
      setEthosData,
      setFarcasterIdentity,
      setTargetAddress,
      setConvictionMetrics,
      setPositionAnalyses,
      addLog,
      finishAnalysis,
    ],
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
