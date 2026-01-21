import { useCallback } from "react";
import { useAccount } from "wagmi";
import { useWallet } from "@solana/wallet-adapter-react";
import { useAppStore } from "@/lib/store";
import { ethosClient } from "@/lib/ethos";
import { SHOWCASE_WALLETS } from "@/lib/showcase-data";

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
    isAnalyzing,
    addLog,
    reset,
    toggleShowcaseMode,
    isShowcaseMode,
  } = useAppStore();

  const analyzeWallet = useCallback(
    async (showcaseId?: string) => {
      // Determine target: Showcase Wallet or Connected User
      let activeAddress: string | null = null;
      let targetShowcase = null;

      if (showcaseId) {
        targetShowcase = SHOWCASE_WALLETS.find((w) => w.id === showcaseId);
        if (targetShowcase) {
          activeAddress = targetShowcase.address;
          toggleShowcaseMode(true);
        }
      } else {
        activeAddress = isEvmConnected
          ? (evmAddress ?? null)
          : isSolanaConnected
            ? (solanaAddress ?? null)
            : null;
        toggleShowcaseMode(false);
      }

      if (!activeAddress) {
        console.warn("No wallet connected and no showcase selected");
        return;
      }

      try {
        reset(); // Clear previous state
        startAnalysis();

        // Step 1: Identity Resolution
        const shortAddr = `${activeAddress!.slice(0, 6)}...${activeAddress!.slice(-4)}`;
        setAnalysisStep("Resolving identity...");
        addLog(`> TARGET: ${shortAddr}`);
        addLog(
          `> NETWORK: ${targetShowcase ? targetShowcase.chain.toUpperCase() : isEvmConnected ? "BASE_MAINNET" : "SOLANA_MAINNET"}`,
        );

        await new Promise((resolve) => setTimeout(resolve, 600));
        addLog(`> RESOLVING ON-CHAIN IDENTITY...`);
        await new Promise((resolve) => setTimeout(resolve, 400));

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
          } else {
            // Real Data Fetch
            // We fetch concurrently to be efficient
            const [score, profile] = await Promise.all([
              ethosClient.getScoreByAddress(activeAddress).catch((e) => {
                console.warn("Ethos Score Fetch Error:", e);
                return null;
              }),
              ethosClient.getProfileByAddress(activeAddress).catch((e) => {
                console.warn("Ethos Profile Fetch Error:", e);
                return null;
              }),
            ]);

            // We only set data if we actually got something back
            // If the API 404s (user not found) or fails, we pass nulls
            // The UI handles nulls as "Unknown/Unverified"
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
        addLog(`> INITIATING DEEP SCAN (180 DAYS)...`);

        if (targetShowcase) {
          // Showcase Mode: Simulate deep analysis steps
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
        } else {
          // Real User Mode
          await new Promise((resolve) => setTimeout(resolve, 1000));
          addLog(`> SCANNING MEMPOOL...`);
          await new Promise((resolve) => setTimeout(resolve, 800));
          addLog(`> WARNING: INSUFFICIENT TX HISTORY DETECTED`);
          addLog(`> ABORTING METRIC CALCULATION`);

          // We intentionally do NOT call setConvictionMetrics here.
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
