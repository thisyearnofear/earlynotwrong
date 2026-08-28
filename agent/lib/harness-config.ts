/**
 * Harness Config — Domain Selection Layer
 *
 * The top-level config that selects which adapter set the harness uses.
 * A "domain" maps to a triple of adapters: data source, conviction factors,
 * and trade executor. Everything else in the loop (LLM ladder, jury,
 * verification, anchoring, self-analysis) is domain-agnostic and unchanged.
 *
 * Set `HARNESS_DOMAIN` at runtime to switch domains:
 *   HARNESS_DOMAIN=crypto   (default — the existing BSC agent)
 *   HARNESS_DOMAIN=options  (Alpaca options agent — hackathon proof point)
 *
 * The harness config is intentionally separate from AGENT_CONFIG so the
 * domain adapter selection can evolve without touching trading parameters.
 */

// =============================================================================
// Types
// =============================================================================

export type Domain = "crypto" | "options" | string;

export interface HarnessConfig {
  /** The active domain (e.g. "crypto", "options"). */
  domain: Domain;
  /** Adapter identifiers — the registry maps these to implementations. */
  adapters: {
    dataSource: string; // 'sosovalue' | 'alpaca' | ...
    convictionFactors: string; // 'crypto' | 'options' | ...
    executor: string; // 'twak' | 'alpaca' | ...
  };
}

// =============================================================================
// Domain Profiles
// =============================================================================

/**
 * Built-in domain profiles. Each maps a domain name to its adapter triple.
 * New domains register here (or via the `HARNESS_DOMAIN` env override).
 */
export const DOMAIN_PROFILES: Record<string, HarnessConfig> = {
  crypto: {
    domain: "crypto",
    adapters: {
      dataSource: "sosovalue",
      convictionFactors: "crypto",
      executor: "twak",
    },
  },
  options: {
    domain: "options",
    adapters: {
      dataSource: "alpaca",
      convictionFactors: "options",
      executor: "alpaca",
    },
  },
};

/**
 * Resolve the active harness config from the environment.
 *
 * Falls back to the "crypto" profile (the existing BSC agent) when
 * `HARNESS_DOMAIN` is unset or doesn't match a known profile. An unknown
 * domain still returns a config — the registry will surface a clear error
 * if no adapter is registered for it.
 */
export function resolveHarnessConfig(): HarnessConfig {
  const domain = (process.env.HARNESS_DOMAIN || "crypto").toLowerCase().trim();
  return DOMAIN_PROFILES[domain] ?? {
    domain,
    adapters: {
      dataSource: "unknown",
      convictionFactors: "unknown",
      executor: "unknown",
    },
  };
}

/** The resolved harness config at startup. */
export const HARNESS_CONFIG = resolveHarnessConfig();
