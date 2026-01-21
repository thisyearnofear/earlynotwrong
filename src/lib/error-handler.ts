/**
 * Error Handling Utilities for Phase 1.4
 * Provides graceful degradation, retry logic, and user-friendly error messages
 */

export type ErrorType = "api" | "network" | "data" | "unknown";

export interface AppError {
  type: ErrorType;
  message: string;
  details?: string;
  canRetry: boolean;
  canUseCached: boolean;
  recoveryAction?: string;
  originalError?: unknown;
}

/**
 * Classify and enhance errors with recovery information
 */
export function classifyError(error: unknown): AppError {
  // Network/Fetch errors
  if (error instanceof TypeError && error.message.includes("fetch")) {
    return {
      type: "network",
      message: "Network connection failed",
      details: "Unable to reach the server. Check your internet connection.",
      canRetry: true,
      canUseCached: true,
      recoveryAction: "Check your connection and try again, or use cached data if available.",
      originalError: error,
    };
  }

  // API Response errors
  if (error instanceof Response) {
    if (error.status === 429) {
      return {
        type: "api",
        message: "Rate limit exceeded",
        details: "Too many requests. Please wait a moment.",
        canRetry: true,
        canUseCached: true,
        recoveryAction: "Wait 30 seconds and try again.",
        originalError: error,
      };
    }
    
    if (error.status >= 500) {
      return {
        type: "api",
        message: "Server error",
        details: `API service temporarily unavailable (${error.status})`,
        canRetry: true,
        canUseCached: true,
        recoveryAction: "The service is experiencing issues. Try again in a moment.",
        originalError: error,
      };
    }

    if (error.status === 404) {
      return {
        type: "data",
        message: "Data not found",
        details: "No transaction history found for this wallet.",
        canRetry: false,
        canUseCached: false,
        recoveryAction: "Try adjusting time horizon or minimum trade value parameters.",
        originalError: error,
      };
    }
  }

  // Error objects with messages
  if (error instanceof Error) {
    // API key issues
    if (error.message.includes("API") || error.message.includes("key")) {
      return {
        type: "api",
        message: "API configuration error",
        details: error.message,
        canRetry: false,
        canUseCached: true,
        recoveryAction: "Contact support or try showcase mode.",
        originalError: error,
      };
    }

    // Data parsing errors
    if (error.message.includes("parse") || error.message.includes("JSON")) {
      return {
        type: "data",
        message: "Data format error",
        details: "Unable to process transaction data.",
        canRetry: true,
        canUseCached: false,
        recoveryAction: "This wallet may have complex transactions. Try again or use showcase mode.",
        originalError: error,
      };
    }

    // Generic error with message
    return {
      type: "unknown",
      message: error.message || "An unexpected error occurred",
      details: error.stack,
      canRetry: true,
      canUseCached: false,
      recoveryAction: "Try again or contact support if the issue persists.",
      originalError: error,
    };
  }

  // Unknown error type
  return {
    type: "unknown",
    message: "An unexpected error occurred",
    details: String(error),
    canRetry: true,
    canUseCached: false,
    recoveryAction: "Try again or contact support if the issue persists.",
    originalError: error,
  };
}

/**
 * Retry logic with exponential backoff
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries?: number;
    initialDelay?: number;
    maxDelay?: number;
    backoffMultiplier?: number;
  } = {}
): Promise<T> {
  const {
    maxRetries = 3,
    initialDelay = 1000,
    maxDelay = 10000,
    backoffMultiplier = 2,
  } = options;

  let lastError: unknown;
  let delay = initialDelay;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      // Don't retry on the last attempt
      if (attempt === maxRetries) break;

      // Check if error is retryable
      const classified = classifyError(error);
      if (!classified.canRetry) {
        throw error;
      }

      // Wait before retrying
      await new Promise((resolve) => setTimeout(resolve, delay));
      
      // Increase delay for next attempt
      delay = Math.min(delay * backoffMultiplier, maxDelay);
    }
  }

  throw lastError;
}

/**
 * Create user-friendly error messages for terminal display
 */
export function formatErrorForTerminal(error: AppError): string[] {
  const lines: string[] = [];
  
  lines.push(`> ERROR: ${error.message.toUpperCase()}`);
  
  if (error.details) {
    lines.push(`> DETAILS: ${error.details}`);
  }
  
  if (error.recoveryAction) {
    lines.push(`> RECOVERY: ${error.recoveryAction}`);
  }
  
  if (error.canRetry) {
    lines.push(`> TIP: Click 'Retry Analysis' to try again`);
  }
  
  if (error.canUseCached) {
    lines.push(`> TIP: View your historical analyses in the history panel`);
  }
  
  return lines;
}

/**
 * Safe API call wrapper with automatic error classification
 */
export async function safeApiCall<T>(
  apiCall: () => Promise<T>,
  options?: {
    retry?: boolean;
    fallback?: T;
  }
): Promise<{ data?: T; error?: AppError }> {
  try {
    const data = options?.retry
      ? await retryWithBackoff(apiCall)
      : await apiCall();
    return { data };
  } catch (error) {
    const classified = classifyError(error);
    
    // Return fallback if available
    if (options?.fallback !== undefined) {
      return { data: options.fallback, error: classified };
    }
    
    return { error: classified };
  }
}
