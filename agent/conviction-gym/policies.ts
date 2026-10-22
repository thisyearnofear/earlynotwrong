/**
 * Conviction Gym — reference policies.
 *
 * - convictionPolicy: the production Early, Not Wrong strategy, re-expressed
 *   as a policy (entries: top conviction score ≥ threshold; exits: in
 *   assisted mode the env's risk tiers fire; in full-control mode the
 *   policy emits the same tiered exits itself via evaluatePosition).
 * - randomPolicy: uniform-random legal-ish action each day (naive baseline).
 * - buyHoldPolicy: enter the largest-mcap token on day 1, never sell.
 */

import { evaluatePosition } from "../lib/conviction-signal.js";
import type { ConvictionGymEnv } from "./env.js";
import type { EnvAction, EnvObservation } from "./types.js";

export interface Policy {
  name: string;
  /** May be async (LLM-backed policies). */
  act(obs: EnvObservation, env: ConvictionGymEnv): EnvAction | Promise<EnvAction>;
  /** Optional reasoning attached to the last act() call (trace datasets). */
  lastReasoning?: string;
  /** Token usage from the last act() call (LLM policies). */
  lastUsage?: {
    promptTokens?: number;
    completionTokens?: number;
    reasoningTokens?: number;
    latencyMs?: number;
  };
}

const HOLD: EnvAction = { symbolIndex: 0, op: "hold", size: "standard" };

/** Minimum conviction score to open — matches the live agent's gate. */
export const MIN_CONVICTION_SCORE = 55;

function makeRng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

export function convictionPolicy(): Policy {
  return {
    name: "conviction",
    act(obs, env) {
      // Full-control: emit the production tiered exits ourselves.
      if (env.config.mode === "full-control") {
        for (const p of obs.portfolio.positions) {
          const fakePos = {
            symbol: p.symbol,
            entryPriceUsd: p.entryPriceUsd,
            entryCycle: 0,
            entryAt: 0,
            amountUsd: p.amountUsd,
            peakPriceUsd:
              p.currentPriceUsd / (1 - p.drawdownFromPeakPercent / 100 || 1) || p.entryPriceUsd,
            maxUnderwaterPercent: 0,
            cyclesHeld: p.cyclesHeld,
            partialProfitTaken: p.partialProfitTaken,
            failedExitAttempts: 0,
            stuck: false,
          };
          const verdict = evaluatePosition(fakePos, p.currentPriceUsd);
          if (verdict.action !== "HOLD") {
            const idx = env.symbols.findIndex((s) => s.toUpperCase() === p.symbol);
            if (idx >= 0) {
              return {
                symbolIndex: idx,
                op: verdict.action === "EXIT_PARTIAL" ? "exit_partial" : "exit_full",
                size: "standard",
              };
            }
          }
        }
      }
      // Entries: top conviction token above the gate, standard size.
      if (obs.portfolio.openSlots > 0 && obs.portfolio.maxEntryUsd >= 2) {
        const held = new Set(obs.portfolio.positions.map((p) => p.symbol));
        const top = obs.tokens.find(
          (t) => !held.has(t.symbol) && t.conviction.score >= MIN_CONVICTION_SCORE,
        );
        if (top) {
          const idx = env.symbols.findIndex((s) => s.toUpperCase() === top.symbol);
          if (idx >= 0) return { symbolIndex: idx, op: "enter", size: "standard" };
        }
      }
      return HOLD;
    },
  };
}

export function randomPolicy(seed = 7): Policy {
  const rnd = makeRng(seed);
  return {
    name: "random",
    act(obs, env) {
      const K = env.symbols.length;
      const r = rnd();
      // 40% hold, 30% enter random token, 30% exit/partial a held position.
      if (r < 0.4) return HOLD;
      if (r < 0.7 && obs.portfolio.openSlots > 0) {
        const idx = Math.floor(rnd() * K);
        return { symbolIndex: idx, op: "enter", size: "standard" };
      }
      if (obs.portfolio.positions.length > 0) {
        const p = obs.portfolio.positions[Math.floor(rnd() * obs.portfolio.positions.length)];
        const idx = env.symbols.findIndex((s) => s.toUpperCase() === p.symbol);
        if (idx >= 0) {
          return { symbolIndex: idx, op: rnd() < 0.5 ? "exit_full" : "exit_partial", size: "standard" };
        }
      }
      return HOLD;
    },
  };
}

export function buyHoldPolicy(): Policy {
  let entered = false;
  return {
    name: "buy_and_hold",
    act(obs, env) {
      if (entered) return HOLD;
      entered = true;
      const top = [...obs.tokens].sort((a, b) => b.marketCap - a.marketCap)[0];
      const idx = top ? env.symbols.findIndex((s) => s.toUpperCase() === top.symbol) : -1;
      return idx >= 0 ? { symbolIndex: idx, op: "enter", size: "max" } : HOLD;
    },
  };
}
