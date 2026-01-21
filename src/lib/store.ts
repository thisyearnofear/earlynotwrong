import { create } from "zustand";
import { EthosScore, EthosProfile, ConvictionAttestation } from "./ethos";
import { ConvictionMetrics } from "./market";
import { PositionAnalysis } from "./api-client";

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

interface ErrorState {
  hasError: boolean;
  errorType: "api" | "network" | "data" | "unknown" | null;
  errorMessage: string | null;
  errorDetails?: string;
  canRetry: boolean;
  canUseCached: boolean;
  recoveryAction?: string;
}

interface ToastState {
  message: string | null;
  type: "success" | "error" | "info";
  isVisible: boolean;
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
  
  // Error Handling
  errorState: ErrorState;
  setError: (error: Partial<ErrorState>) => void;
  clearError: () => void;

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
  
  // Position Analysis Data
  positionAnalyses: PositionAnalysis[];
  analysisChain: "solana" | "base" | null;
  setPositionAnalyses: (positions: PositionAnalysis[], chain: "solana" | "base") => void;

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

  // Toast State
  toast: ToastState;
  showToast: (message: string, type?: "success" | "error" | "info") => void;
  hideToast: () => void;
}

export const useAppStore = create<AppState>((set, get) => ({
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
      errorState: {
        hasError: false,
        errorType: null,
        errorMessage: null,
        canRetry: false,
        canUseCached: false,
      },
    }),
  finishAnalysis: () => set({ isAnalyzing: false, analysisStep: "" }),
  
  // Error Handling
  errorState: {
    hasError: false,
    errorType: null,
    errorMessage: null,
    canRetry: false,
    canUseCached: false,
  },
  setError: (error) =>
    set((state) => ({
      errorState: { ...state.errorState, hasError: true, ...error },
      isAnalyzing: false,
    })),
  clearError: () =>
    set({
      errorState: {
        hasError: false,
        errorType: null,
        errorMessage: null,
        canRetry: false,
        canUseCached: false,
      },
    }),

  // User Data
  ethosScore: null,
  ethosProfile: null,
  setEthosData: (score, profile) =>
    set({ ethosScore: score, ethosProfile: profile }),

  // Conviction Data
  convictionMetrics: null,
  setConvictionMetrics: (metrics) => set({ convictionMetrics: metrics }),
  
  // Position Analysis Data
  positionAnalyses: [],
  analysisChain: null,
  setPositionAnalyses: (positions, chain) => set({ positionAnalyses: positions, analysisChain: chain }),

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
      positionAnalyses: [],
      analysisChain: null,
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

  // Toast Implementation
  toast: {
    message: null,
    type: "info",
    isVisible: false,
  },
  showToast: (message, type = "info") => {
    set({ toast: { message, type, isVisible: true } });
    // Auto hide after 3 seconds
    setTimeout(() => {
      get().hideToast();
    }, 3000);
  },
  hideToast: () => set((state) => ({ toast: { ...state.toast, isVisible: false } })),
}));