"use client";

import { useCallback, useState } from "react";
import { useWallet } from "@provablehq/aleo-wallet-adaptor-react";
import { TransactionOptions } from "@provablehq/aleo-types";
import { useAppStore } from "@/lib/store";
import { APP_CONFIG } from "@/lib/config";
import { waitForTransaction } from "@/lib/aleo/client";

const CONVICTION_PROGRAM_ID = APP_CONFIG.chains.aleo.programId;
const CREDITS_PROGRAM_ID = APP_CONFIG.chains.aleo.creditsProgramId;
const TREASURY_ADDRESS = APP_CONFIG.chains.aleo.treasuryAddress;

export function useAleoConviction() {
  const { address, executeTransaction, requestRecords } = useWallet();
  const [isMinting, setIsMinting] = useState(false);
  const [lastTxId, setLastTxId] = useState<string | null>(null);

  const checkBalance = useCallback(async (requiredMicrocredits: number) => {
    if (!requestRecords) return true; // Cannot check, proceed
    try {
      const records = (await requestRecords(CREDITS_PROGRAM_ID, true)) as { plaintext: string }[];
      // Simple sum of all unspent records in credits.aleo
      const balance = records?.reduce((acc, r) => acc + (r.plaintext.includes("microcredits") ? parseInt(r.plaintext.split("microcredits:")[1]) : 0), 0) || 0;
      return balance >= requiredMicrocredits;
    } catch (error: any) {
      if (error.message?.includes("Decrypt permission denied")) {
        console.warn("Aleo decryption permission denied; skipping pre-flight balance check.");
        return true; // Fallback: allow transaction to proceed and let the wallet handle balance checks
      }
      throw error;
    }
  }, [requestRecords]);

  const executeWithMonitoring = useCallback(async (txOptions: TransactionOptions) => {
    if (!executeTransaction) throw new Error("Wallet not connected");
    
    // 1. Pre-flight Check: Balance
    if (!(await checkBalance(txOptions.fee as number))) {
        throw new Error("Insufficient Aleo credits for transaction fee.");
    }

    // 2. Execute
    const result = await executeTransaction(txOptions);
    const txId = result?.transactionId;
    
    if (!txId) throw new Error("Transaction failed to initiate");
    
    setLastTxId(txId);

    // 3. Monitor
    const finalized = await waitForTransaction(txId);
    
    // If it's a shield ID, we treat it as pending (not necessarily an error)
    if (!finalized && !txId.startsWith("shield_")) {
        throw new Error("Transaction failed to finalize on-chain.");
    }
    
    return txId;
  }, [executeTransaction, checkBalance]);

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
        "Diamond Hand": 0,
        "Iron Pillar": 1,
        "Profit Phantom": 2,
        "Exit Voyager": 3,
        // Fallbacks for uppercase keys
        "DIAMOND_HAND": 0,
        "IRON_PILLAR": 1,
        "PROFIT_PHANTOM": 2,
        "EXIT_VOYAGER": 3
      };
      
      const archetypeLabel = convictionMetrics.archetype || "DIAMOND_HAND";
      const archetypeValue = archetypeMap[archetypeLabel] ?? 0;

      const txOptions = {
        program: CONVICTION_PROGRAM_ID,
        function: "issue_conviction",
        inputs: [
          String(address), // receiver
          `${Math.floor(convictionMetrics.score)}u32`,
          `${Math.floor(convictionMetrics.patienceTax)}u64`,
          `${archetypeValue}u8`,
          `${Math.floor(Date.now() / 1000)}u64`
        ],
        fee: 100000, // microcredits
        privateFee: true,
        network: APP_CONFIG.chains.aleo.network
      };

      return await executeWithMonitoring(txOptions);
    } catch (error) {
      console.error("Failed to mint Aleo conviction record:", error);
      throw error;
    } finally {
      setIsMinting(false);
    }
  }, [address, executeWithMonitoring]);

  const verifyArchetype = useCallback(async (record: string | { plaintext: string }, requiredArchetype: number) => {
    if (!address || !executeTransaction) {
      throw new Error("Aleo wallet not connected");
    }

    setIsMinting(true);
    try {
      const txOptions = {
        program: CONVICTION_PROGRAM_ID,
        function: "verify_archetype",
        inputs: [
          typeof record === 'string' ? record : record.plaintext, 
          `${Math.floor(requiredArchetype)}u8`
        ],
        fee: 50000,
        privateFee: true,
        network: APP_CONFIG.chains.aleo.network
      };

      return await executeWithMonitoring(txOptions);
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
      const txOptions = {
        program: CONVICTION_PROGRAM_ID,
        function: "verify_score_threshold",
        inputs: [
          typeof record === 'string' ? record : record.plaintext,
          `${Math.floor(threshold)}u32`
        ],
        fee: 50000,
        privateFee: true,
        network: APP_CONFIG.chains.aleo.network
      };

      return await executeWithMonitoring(txOptions);
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
      const txOptions = {
        program: CONVICTION_PROGRAM_ID,
        function: "verify_efficient_trading",
        inputs: [
          typeof record === 'string' ? record : record.plaintext,
          `${Math.floor(maxPatienceTax)}u64`
        ],
        fee: 50000,
        privateFee: true,
        network: APP_CONFIG.chains.aleo.network
      };

      return await executeWithMonitoring(txOptions);
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
      const fieldHash = thesisHash.startsWith('0x') ? BigInt(thesisHash).toString() : thesisHash;

      const txOptions = {
        program: CONVICTION_PROGRAM_ID,
        function: "commit_thesis",
        inputs: [
          String(address),
          `${fieldHash}field`,
          `${Math.floor(targetPrice)}u64`,
          `${Math.floor(Date.now() / 1000)}u64`
        ],
        fee: 100000,
        privateFee: true,
        network: APP_CONFIG.chains.aleo.network
      };

      return await executeWithMonitoring(txOptions);
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
      
      const txOptions = {
        program: CREDITS_PROGRAM_ID,
        function: "transfer_public",
        inputs: [
          TREASURY_ADDRESS,
          "500000u64" 
        ],
        fee: 10000,
        privateFee: false,
        network: APP_CONFIG.chains.aleo.network
      };

      await executeWithMonitoring(txOptions);
      setAleoPremium(true);
      showToast("Premium Analytics Unlocked!", "success");
      return true;
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
      // Step 1: Request signed voucher from treasury (Platform Authorizes)
      // This follows the 'Pull' model where the platform authorizes but the user executes.
      const response = await fetch("/api/aleo/rebate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userAddress: address,
          amount: 200000 // 0.2 Credits/USDCx
        })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to authorize rebate");
      }

      const { voucher } = data;
      showToast("Rebate Authorized! Submitting claim transaction...", "info");

      // Step 2: Submit claim to smart contract (User Executes)
      const txOptions = {
        program: CONVICTION_PROGRAM_ID,
        function: "claim_rebate",
        inputs: [
          voucher.recipient,
          `${Math.floor(voucher.amount)}u64`,
          voucher.nonce,
          voucher.signature
        ],
        fee: 100000,
        privateFee: false,
        network: APP_CONFIG.chains.aleo.network
      };

      await executeWithMonitoring(txOptions);
      showToast("Rebate Claimed Successfully!", "success");
      return true;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : "Rebate failed";
      console.error("Aleo rebate claim failed:", error);
      showToast(errorMessage, "error");
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
    isMinting,
    lastTxId,
    isAleoConnected: !!address
  };
}
