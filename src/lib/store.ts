import { create } from "zustand";
import { EthosScore, EthosProfile, FarcasterIdentity } from "./ethos";
import { ConvictionMetrics } from "./market";
import { PositionAnalysis, TransactionResult } from "./api-client";
import { UnifiedTrustScore } from "./services/trust-resolver";

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

interface ScanProgress {
  phase: 'idle' | 'connecting' | 'fetching' | 'processing' | 'analyzing' | 'complete';
  percent: number;
  detail: string;
  itemsProcessed: number;
  totalItems: number;
}

interface AppState {
  // Analysis Workflow
  isAnalyzing: boolean;
  analysisStep: string;
  logs: string[];
  scanProgress: ScanProgress;
  setAnalysisStep: (step: string) => void;
  addLog: (log: string) => void;
  setScanProgress: (progress: Partial<ScanProgress>) => void;
  startAnalysis: () => void;
  finishAnalysis: () => void;

  // Error Handling
  errorState: ErrorState;
  setError: (error: Partial<ErrorState>) => void;
  clearError: () => void;

  // User Data (Ethos)
  ethosScore: EthosScore | null;
  ethosProfile: EthosProfile | null;
  farcasterIdentity: FarcasterIdentity | null;
  unifiedTrustScore: UnifiedTrustScore | null;
  setEthosData: (
    score: EthosScore | null,
    profile: EthosProfile | null,
  ) => void;
  setFarcasterIdentity: (identity: FarcasterIdentity | null) => void;
  setUnifiedTrustScore: (trust: UnifiedTrustScore | null) => void;

  // Conviction Data
  convictionMetrics: ConvictionMetrics | null;
  setConvictionMetrics: (metrics: ConvictionMetrics) => void;

  // Position Analysis Data
  positionAnalyses: PositionAnalysis[];
  targetAddress: string | null;
  analysisChain: "solana" | "base" | null;
  dataQuality: TransactionResult["quality"] | null;
  setPositionAnalyses: (
    positions: PositionAnalysis[],
    chain: "solana" | "base",
  ) => void;
  setTargetAddress: (address: string | null) => void;
  setDataQuality: (quality: TransactionResult["quality"]) => void;

  // Attestation State
  attestationState: AttestationState;
  setAttestationState: (state: Partial<AttestationState>) => void;
  setUserConsent: (consent: boolean) => void;
  showAttestationDialog: (show: boolean) => void;

  // Comparison State
  comparisonWallets: { address: string;[key: string]: unknown }[];
  addToComparison: (wallet: {
    address: string;
    [key: string]: unknown;
  }) => void;
  removeFromComparison: (address: string) => void;
  clearComparison: () => void;

  // Analysis Parameters
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

  // Daily Analysis Counter
  dailyAnalysisCount: number;
  dailyAnalysisResetDate: string | null;
  incrementDailyAnalysis: () => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  // Analysis Workflow
  isAnalyzing: false,
  analysisStep: "",
  logs: [],
  scanProgress: {
    phase: 'idle',
    percent: 0,
    detail: '',
    itemsProcessed: 0,
    totalItems: 0,
  },
  setAnalysisStep: (step) => set({ analysisStep: step }),
  addLog: (log) => set((state) => ({ logs: [...state.logs, log] })),
  setScanProgress: (progress) =>
    set((state) => ({
      scanProgress: { ...state.scanProgress, ...progress },
    })),
  startAnalysis: () =>
    set({
      isAnalyzing: true,
      analysisStep: "Initializing scan...",
      logs: ["> INITIALIZING CONVICTION PROTOCOL_"],
      scanProgress: {
        phase: 'connecting',
        percent: 5,
        detail: 'Establishing secure connection...',
        itemsProcessed: 0,
        totalItems: 0,
      },
      errorState: {
        hasError: false,
        errorType: null,
        errorMessage: null,
        canRetry: false,
        canUseCached: false,
      },
    }),
  finishAnalysis: () => set({
    isAnalyzing: false,
    analysisStep: "",
    scanProgress: {
      phase: 'complete',
      percent: 100,
      detail: 'Analysis complete',
      itemsProcessed: 0,
      totalItems: 0,
    },
  }),

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
  farcasterIdentity: null,
  unifiedTrustScore: null,
  setEthosData: (score, profile) =>
    set({ ethosScore: score, ethosProfile: profile }),
  setFarcasterIdentity: (identity) => set({ farcasterIdentity: identity }),
  setUnifiedTrustScore: (trust) => set({ unifiedTrustScore: trust }),

  // Conviction Data
  convictionMetrics: null,
  setConvictionMetrics: (metrics) => set({ convictionMetrics: metrics }),

  // Position Analysis Data
  positionAnalyses: [],
  targetAddress: null,
  analysisChain: null,
  dataQuality: null,
  setPositionAnalyses: (positions, chain) =>
    set({ positionAnalyses: positions, analysisChain: chain }),
  setTargetAddress: (address) => set({ targetAddress: address }),
  setDataQuality: (quality) => set({ dataQuality: quality }),

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
      attestationState: {
        ...state.attestationState,
        showAttestationDialog: show,
      },
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

  // Comparison State Implementation
  comparisonWallets: [],
  addToComparison: (wallet) =>
    set((state) => ({
      comparisonWallets: [...state.comparisonWallets, wallet].slice(0, 3), // Max 3 wallets
    })),
  removeFromComparison: (address) =>
    set((state) => ({
      comparisonWallets: state.comparisonWallets.filter(
        (w) => w.address !== address,
      ),
    })),
  clearComparison: () => set({ comparisonWallets: [] }),

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
      scanProgress: {
        phase: 'idle',
        percent: 0,
        detail: '',
        itemsProcessed: 0,
        totalItems: 0,
      },
      ethosScore: null,
      ethosProfile: null,
      unifiedTrustScore: null,
      convictionMetrics: null,
      positionAnalyses: [],
      targetAddress: null,
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
      comparisonWallets: [],
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
  hideToast: () =>
    set((state) => ({ toast: { ...state.toast, isVisible: false } })),

  // Daily Analysis Counter
  dailyAnalysisCount: (() => {
    if (typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem('enw_daily_analysis');
        if (stored) {
          const { count, date } = JSON.parse(stored);
          const today = new Date().toISOString().split('T')[0];
          if (date === today) {
            return count;
          }
        }
      } catch { }
    }
    return 0;
  })(),
  dailyAnalysisResetDate: (() => {
    if (typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem('enw_daily_analysis');
        if (stored) {
          const { date } = JSON.parse(stored);
          const today = new Date().toISOString().split('T')[0];
          if (date === today) {
            return date;
          }
        }
      } catch { }
    }
    return null;
  })(),
  incrementDailyAnalysis: () => {
    const today = new Date().toISOString().split('T')[0];
    set((state) => {
      const isNewDay = state.dailyAnalysisResetDate !== today;
      const newCount = isNewDay ? 1 : state.dailyAnalysisCount + 1;

      if (typeof window !== 'undefined') {
        localStorage.setItem('enw_daily_analysis', JSON.stringify({ count: newCount, date: today }));
      }

      return {
        dailyAnalysisCount: newCount,
        dailyAnalysisResetDate: today,
      };
    });
  },
}));
