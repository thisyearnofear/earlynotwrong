import { create } from "zustand";
import { EthosScore, EthosProfile, ConvictionAttestation } from "./ethos";
import { ConvictionMetrics } from "./market";

interface AnalysisParams {
  timeHorizon: 30 | 90 | 180 | 365;
  minTradeValue: number;
  includeSmallCaps: boolean;
}

interface AttestationState {
  canAttest: boolean;
  isAttesting: boolean;
  attestationId?: string;
  attestationError?: string;
  userConsent: boolean;
  showAttestationDialog: boolean;
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

  // Attestation State
  attestationState: AttestationState;
  setAttestationState: (state: Partial<AttestationState>) => void;
  setUserConsent: (consent: boolean) => void;
  showAttestationDialog: (show: boolean) => void;

  // Analysis Control
  parameters: AnalysisParams;
  setParameters: (params: Partial<AnalysisParams>) => void;

  // UI State
  isShowcaseMode: boolean;
  toggleShowcaseMode: (enabled?: boolean) => void;
  theme: "light" | "dark";
  setTheme: (theme: "light" | "dark") => void;
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

  // Attestation State
  attestationState: {
    canAttest: false,
    isAttesting: false,
    userConsent: false,
    showAttestationDialog: false,
  },
  setAttestationState: (state) =>
    set((current) => ({
      attestationState: { ...current.attestationState, ...state },
    })),
  setUserConsent: (consent) =>
    set((state) => ({
      attestationState: { ...state.attestationState, userConsent: consent },
    })),
  showAttestationDialog: (show) =>
    set((state) => ({
      attestationState: { ...state.attestationState, showAttestationDialog: show },
    })),

  // Analysis Control
  parameters: {
    timeHorizon: 180,
    minTradeValue: 100,
    includeSmallCaps: true,
  },
  setParameters: (params) =>
    set((state) => ({
      parameters: { ...state.parameters, ...params },
    })),

  // UI State
  isShowcaseMode: false,
  toggleShowcaseMode: (enabled) =>
    set((state) => ({
      isShowcaseMode: enabled ?? !state.isShowcaseMode,
    })),
  theme: "dark",
  setTheme: (theme) => set({ theme }),
  reset: () =>
    set({
      isAnalyzing: false,
      analysisStep: "",
      logs: [],
      ethosScore: null,
      ethosProfile: null,
      convictionMetrics: null,
      attestationState: {
        canAttest: false,
        isAttesting: false,
        userConsent: false,
        showAttestationDialog: false,
      },
      parameters: {
        timeHorizon: 180,
        minTradeValue: 100,
        includeSmallCaps: true,
      },
      isShowcaseMode: false,
    }),
}));
