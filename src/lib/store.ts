import { create } from "zustand";
import { EthosScore, EthosProfile } from "./ethos";

interface ConvictionMetrics {
  score: number;
  patienceTax: number;
  upsideCapture: number;
  earlyExits: number;
  convictionWins: number;
  percentile: number;
}

interface AppState {
  // Analysis Workflow
  isAnalyzing: boolean;
  analysisStep: string;
  logs: string[];
  setAnalysisStep: (step: string) => void;
  addLog: (log: string) => void;
  startAnalysis: () => void;
  finishAnalysis: () => void;

  // User Data (Ethos)
  ethosScore: EthosScore | null;
  ethosProfile: EthosProfile | null;
  setEthosData: (
    score: EthosScore | null,
    profile: EthosProfile | null,
  ) => void;

  // Conviction Data
  convictionMetrics: ConvictionMetrics | null;
  setConvictionMetrics: (metrics: ConvictionMetrics) => void;

  // UI State
  isShowcaseMode: boolean;
  toggleShowcaseMode: (enabled?: boolean) => void;
  reset: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  // Analysis Workflow
  isAnalyzing: false,
  analysisStep: "",
  logs: [],
  setAnalysisStep: (step) => set({ analysisStep: step }),
  addLog: (log) => set((state) => ({ logs: [...state.logs, log] })),
  startAnalysis: () =>
    set({
      isAnalyzing: true,
      analysisStep: "Initializing scan...",
      logs: ["> INITIALIZING CONVICTION PROTOCOL_"],
    }),
  finishAnalysis: () => set({ isAnalyzing: false, analysisStep: "" }),

  // User Data
  ethosScore: null,
  ethosProfile: null,
  setEthosData: (score, profile) =>
    set({ ethosScore: score, ethosProfile: profile }),

  // Conviction Data
  convictionMetrics: null,
  setConvictionMetrics: (metrics) => set({ convictionMetrics: metrics }),

  // UI State
  isShowcaseMode: false,
  toggleShowcaseMode: (enabled) =>
    set((state) => ({
      isShowcaseMode: enabled ?? !state.isShowcaseMode,
    })),
  reset: () =>
    set({
      isAnalyzing: false,
      analysisStep: "",
      logs: [],
      ethosScore: null,
      ethosProfile: null,
      convictionMetrics: null,
      isShowcaseMode: false,
    }),
}));
