"use client";

import { useCallback, useState } from "react";
import { useWallet } from "@provablehq/aleo-wallet-adaptor-react";
import { TransactionOptions } from "@provablehq/aleo-types";
import { useAppStore } from "@/lib/store";

const CONVICTION_PROGRAM_ID = "early_not_wrong_v1.aleo";

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

  return {
    mintConvictionRecord,
    verifyArchetype,
    verifyScoreThreshold,
    verifyEfficientTrading,
    fetchRecords,
    records,
    isMinting,
    lastTxId,
    isAleoConnected: !!address
  };
}
