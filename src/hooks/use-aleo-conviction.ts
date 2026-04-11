"use client";

import { useCallback, useState } from "react";
import { useWallet } from "@provablehq/aleo-wallet-adaptor-react";
import { TransactionOptions } from "@provablehq/aleo-types";
import { useAppStore } from "@/lib/store";
import { APP_CONFIG } from "@/lib/config";

const CONVICTION_PROGRAM_ID = APP_CONFIG.chains.aleo.programId;
const CREDITS_PROGRAM_ID = APP_CONFIG.chains.aleo.creditsProgramId;
const TREASURY_ADDRESS = APP_CONFIG.chains.aleo.treasuryAddress;

export function useAleoConviction() {
  const { address, executeTransaction, requestRecords } = useWallet();
  const [isMinting, setIsMinting] = useState(false);
  const [lastTxId, setLastTxId] = useState<string | null>(null);
  const [records, setRecords] = useState<(string | { plaintext: string })[]>([]);

  const fetchRecords = useCallback(async () => {
    if (!address || !requestRecords) return;
    try {
      const userRecords = await requestRecords(CONVICTION_PROGRAM_ID, true);
      setRecords((userRecords as (string | { plaintext: string })[]) || []);
    } catch (error) {
      console.error("Failed to fetch Aleo records:", error);
    }
  }, [address, requestRecords]);

  const mintConvictionRecord = useCallback(async () => {
    if (!address || !executeTransaction) {
      throw new Error("Aleo wallet not connected");
    }

    const { convictionMetrics } = useAppStore.getState();
    if (!convictionMetrics) {
      throw new Error("No conviction metrics available to mint");
    }

    setIsMinting(true);
    try {
      // Map archetype to u8
      const archetypeMap: Record<string, number> = {
        "DIAMOND_HAND": 0,
        "IRON_PILLAR": 1,
        "PROFIT_PHANTOM": 2,
        "EXIT_VOYAGER": 3
      };
      
      const archetypeLabel = convictionMetrics.archetype || "DIAMOND_HAND";
      const archetypeValue = archetypeMap[archetypeLabel] ?? 0;

      const txOptions: TransactionOptions = {
        program: CONVICTION_PROGRAM_ID,
        function: "issue_conviction",
        inputs: [
          address, // receiver
          `${convictionMetrics.score}u32`,
          `${Math.floor(convictionMetrics.patienceTax)}u64`,
          `${archetypeValue}u8`,
          `${Math.floor(Date.now() / 1000)}u64`
        ],
        fee: 0.1, // Aleo credits
        privateFee: true
      };

      const result = await executeTransaction(txOptions);
      const txId = result?.transactionId;
      if (txId) {
        setLastTxId(txId);
      }
      return txId;
    } catch (error) {
      console.error("Failed to mint Aleo conviction record:", error);
      throw error;
    } finally {
      setIsMinting(false);
    }
  }, [address, executeTransaction]);

  const verifyArchetype = useCallback(async (record: string | { plaintext: string }, requiredArchetype: number) => {
    if (!address || !executeTransaction) {
      throw new Error("Aleo wallet not connected");
    }

    setIsMinting(true);
    try {
      const txOptions: TransactionOptions = {
        program: CONVICTION_PROGRAM_ID,
        function: "verify_archetype",
        inputs: [
          typeof record === 'string' ? record : record.plaintext, 
          `${requiredArchetype}u8`
        ],
        fee: 0.05,
        privateFee: true
      };

      const result = await executeTransaction(txOptions);
      return result?.transactionId;
    } catch (error) {
      console.error("Aleo verification failed:", error);
      throw error;
    } finally {
      setIsMinting(false);
    }
  }, [address, executeTransaction]);

  const verifyScoreThreshold = useCallback(async (record: string | { plaintext: string }, threshold: number) => {
    if (!address || !executeTransaction) {
      throw new Error("Aleo wallet not connected");
    }

    setIsMinting(true);
    try {
      const txOptions: TransactionOptions = {
        program: CONVICTION_PROGRAM_ID,
        function: "verify_score_threshold",
        inputs: [
          typeof record === 'string' ? record : record.plaintext,
          `${threshold}u32`
        ],
        fee: 0.05,
        privateFee: true
      };

      const result = await executeTransaction(txOptions);
      return result?.transactionId;
    } catch (error) {
      console.error("Aleo score verification failed:", error);
      throw error;
    } finally {
      setIsMinting(false);
    }
  }, [address, executeTransaction]);

  const verifyEfficientTrading = useCallback(async (record: string | { plaintext: string }, maxPatienceTax: number) => {
    if (!address || !executeTransaction) {
      throw new Error("Aleo wallet not connected");
    }

    setIsMinting(true);
    try {
      const txOptions: TransactionOptions = {
        program: CONVICTION_PROGRAM_ID,
        function: "verify_efficient_trading",
        inputs: [
          typeof record === 'string' ? record : record.plaintext,
          `${Math.floor(maxPatienceTax)}u64`
        ],
        fee: 0.05,
        privateFee: true
      };

      const result = await executeTransaction(txOptions);
      return result?.transactionId;
    } catch (error) {
      console.error("Aleo efficiency verification failed:", error);
      throw error;
    } finally {
      setIsMinting(false);
    }
  }, [address, executeTransaction]);

  const commitPrivateThesis = useCallback(async (thesisHash: string, targetPrice: number) => {
    if (!address || !executeTransaction) {
      throw new Error("Aleo wallet not connected");
    }

    setIsMinting(true);
    try {
      // Ensure thesisHash is a valid field string (numeric)
      // If it's a hex string, we might need to convert it or ensure it's decimal
      const fieldHash = thesisHash.startsWith('0x') ? BigInt(thesisHash).toString() : thesisHash;

      const txOptions: TransactionOptions = {
        program: CONVICTION_PROGRAM_ID,
        function: "commit_thesis",
        inputs: [
          address,
          `${fieldHash}field`,
          `${Math.floor(targetPrice)}u64`,
          `${Math.floor(Date.now() / 1000)}u64`
        ],
        fee: 0.1,
        privateFee: true
      };

      const result = await executeTransaction(txOptions);
      const txId = result?.transactionId;
      if (txId) {
        setLastTxId(txId);
      }
      return txId;
    } catch (error) {
      console.error("Failed to commit private thesis:", error);
      throw error;
    } finally {
      setIsMinting(false);
    }
  }, [address, executeTransaction]);

  const purchasePremium = useCallback(async () => {
    if (!address || !executeTransaction) {
      throw new Error("Aleo wallet not connected");
    }

    setIsMinting(true);
    try {
      const { setAleoPremium, showToast } = useAppStore.getState();
      
      // Pay 0.5 Credits for Premium Analytics (500,000 microcredits)
      const txOptions: TransactionOptions = {
        program: CREDITS_PROGRAM_ID,
        function: "transfer_public",
        inputs: [
          TREASURY_ADDRESS,
          "500000u64" 
        ],
        fee: 0.01,
        privateFee: false
      };

      const result = await executeTransaction(txOptions);
      const txId = result?.transactionId;
      
      if (txId) {
        setLastTxId(txId);
        setAleoPremium(true);
        showToast("Premium Analytics Unlocked!", "success");
      }
      return txId;
    } catch (error) {
      console.error("Aleo payment failed:", error);
      throw error;
    } finally {
      setIsMinting(false);
    }
  }, [address, executeTransaction]);

  const claimPatienceRebate = useCallback(async () => {
    if (!address || !executeTransaction) {
      throw new Error("Aleo wallet not connected");
    }

    const { convictionMetrics, showToast } = useAppStore.getState();
    if (!convictionMetrics || convictionMetrics.patienceTax > 1000) {
      throw new Error("Ineligible for patience rebate");
    }

    setIsMinting(true);
    try {
      // In a real scenario, this would be a transition in our contract 
      // that verifies a proof and then triggers a transfer from the treasury.
      // For the demo, we simulate the rebate by calling USDCx transfer (if available)
      // or simply credits.aleo.
      const txOptions: TransactionOptions = {
        program: APP_CONFIG.chains.aleo.usdcProgramId,
        function: "transfer_public",
        inputs: [
          address,
          "200000u64" // 0.2 USDCx rebate
        ],
        fee: 0.01,
        privateFee: false
      };

      const result = await executeTransaction(txOptions);
      if (result?.transactionId) {
        showToast("Rebate Claimed! (Processing)", "success");
      }
      return result?.transactionId;
    } catch (error) {
      console.error("Aleo rebate claim failed:", error);
      throw error;
    } finally {
      setIsMinting(false);
    }
  }, [address, executeTransaction]);

  return {
    mintConvictionRecord,
    verifyArchetype,
    verifyScoreThreshold,
    verifyEfficientTrading,
    commitPrivateThesis,
    purchasePremium,
    claimPatienceRebate,
    fetchRecords,
    records,
    isMinting,
    lastTxId,
    isAleoConnected: !!address
  };
}
