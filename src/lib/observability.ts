import { formatCycleDuration } from "@/lib/signoz";
import type { CycleObservability } from "@/components/agent/agent-observability-panel";

export type PipelineStep = CycleObservability["pipelineSteps"][number];

function anchorSummary(outcomes: CycleObservability["anchorOutcomes"]): string {
  if (outcomes.length === 0) return "anchors pending";
  return outcomes
    .map((a) => {
      if (a.status === "success") return `${a.adapter} ✓`;
      if (a.status === "failed") return `${a.adapter} ✗`;
      return `${a.adapter} ○`;
    })
    .join(" · ");
}

function formatDelta(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(0)}s`;
  const min = Math.floor(ms / 60_000);
  const sec = Math.round((ms % 60_000) / 1000);
  return sec > 0 ? `${min}m ${sec}s` : `${min}m`;
}

/** One-line story for the last completed cycle. */
export function buildCycleNarrative(
  obs: CycleObservability,
  prevDurationMs?: number | null,
): string {
  const chunks: string[] = [
    `Cycle #${obs.cycle} finished in ${formatCycleDuration(obs.durationMs)}`,
  ];

  const tradeCount = obs.tradesSucceeded + obs.tradesFailed;
  if (tradeCount > 0) {
    if (obs.tradesFailed > 0) {
      chunks.push(
        `${obs.tradesSucceeded} trade${obs.tradesSucceeded === 1 ? "" : "s"} ok, ${obs.tradesFailed} failed`,
      );
    } else {
      chunks.push(
        `${obs.tradesSucceeded} trade${obs.tradesSucceeded === 1 ? "" : "s"} executed`,
      );
    }
  } else if (obs.guardrailsRejected > 0) {
    chunks.push(`${obs.guardrailsRejected} blocked by guardrails`);
  }

  chunks.push(anchorSummary(obs.anchorOutcomes));

  if (
    prevDurationMs != null &&
    prevDurationMs > 0 &&
    obs.durationMs < prevDurationMs - 500
  ) {
    chunks.push(`${formatDelta(prevDurationMs - obs.durationMs)} faster than prior`);
  }

  return chunks.join(" — ");
}

/** Synthetic snapshot for /agent?demo=1 when live OTel is unavailable. */
export function getDemoObservability(cycle: number): CycleObservability {
  const total = 192_000;
  const steps: PipelineStep[] = [
    { id: "portfolio", label: "Portfolio", durationMs: 8_200, status: "ok" },
    { id: "market", label: "Market", durationMs: 24_500, status: "ok" },
    { id: "score", label: "Score", durationMs: 41_000, status: "warn" },
    { id: "jury", label: "Jury", durationMs: 18_300, status: "ok" },
    { id: "positions", label: "Positions", durationMs: 12_100, status: "ok" },
    { id: "trade", label: "Trade", durationMs: 6_400, status: "ok" },
    { id: "anchor", label: "Anchor", durationMs: 9_800, status: "ok" },
    { id: "wrap", label: "Wrap", durationMs: 4_700, status: "ok" },
  ];

  return {
    cycle: cycle || 42,
    completedAt: Date.now() - 120_000,
    durationMs: total,
    traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
    spanId: "00f067aa0ba902b7",
    otelEnabled: true,
    portfolioUsd: 1284,
    drawdownPercent: 4.2,
    activePositions: 5,
    regimeScore: 62,
    tradesSucceeded: 1,
    tradesFailed: 0,
    guardrailsRejected: 0,
    anchorOutcomes: [
      { adapter: "mantle", status: "success" },
      { adapter: "casper", status: "skipped" },
    ],
    pipelineSteps: steps,
  };
}

export function resolveObservability(
  live: CycleObservability | null | undefined,
  demoMode: boolean,
  cycle: number,
): CycleObservability | null {
  if (live && live.cycle > 0 && (live.pipelineSteps?.length ?? 0) > 0) {
    return live;
  }
  if (demoMode) {
    return getDemoObservability(cycle);
  }
  if (live && live.cycle > 0) {
    return live;
  }
  return null;
}

export function prevCycleDuration(
  cycleHistory: Array<{ cycle: number; durationMs: number }> | undefined,
  currentCycle: number,
): number | null {
  if (!cycleHistory?.length) return null;
  const prev = cycleHistory.find((c) => c.cycle === currentCycle - 1);
  return prev?.durationMs ?? null;
}
