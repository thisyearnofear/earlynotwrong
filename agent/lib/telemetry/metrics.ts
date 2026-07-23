import { metrics, type Histogram, type Counter } from "@opentelemetry/api";
import { isTelemetryEnabled } from "./init.js";

const METER_NAME = process.env.OTEL_SERVICE_NAME ?? "early-not-wrong-agent";

let cycleDurationHistogram: Histogram | null = null;
let tradesSucceededCounter: Counter | null = null;
let tradesFailedCounter: Counter | null = null;
let anchorResultCounter: Counter | null = null;
let gaugesInitialized = false;
let latestPortfolioUsd = 0;
let latestRegimeScore: number | null = null;
let latestDrawdownPercent = 0;
let latestActivePositions = 0;
let guardrailRejectedCounter: Counter | null = null;

function getMeter() {
  return metrics.getMeter(METER_NAME, "0.1.0");
}

function initGauges(): void {
  if (gaugesInitialized) return;
  gaugesInitialized = true;

  getMeter()
    .createObservableGauge("agent.portfolio.usd", {
      description: "Latest portfolio value in USD",
    })
    .addCallback((obs) => {
      obs.observe(latestPortfolioUsd);
    });

  getMeter()
    .createObservableGauge("agent.regime.score", {
      description: "Market regime score (0-100)",
    })
    .addCallback((obs) => {
      if (latestRegimeScore !== null) {
        obs.observe(latestRegimeScore);
      }
    });

  getMeter()
    .createObservableGauge("agent.drawdown.percent", {
      description: "Portfolio drawdown from peak (percent)",
    })
    .addCallback((obs) => {
      obs.observe(latestDrawdownPercent);
    });

  getMeter()
    .createObservableGauge("agent.positions.active", {
      description: "Active (non-stuck) open positions",
    })
    .addCallback((obs) => {
      obs.observe(latestActivePositions);
    });
}

function guardrailRejected(): Counter {
  if (!guardrailRejectedCounter) {
    guardrailRejectedCounter = getMeter().createCounter("agent.guardrails.rejected", {
      description: "Entry proposals rejected by risk guardrails",
    });
  }
  return guardrailRejectedCounter;
}

function cycleDuration(): Histogram {
  if (!cycleDurationHistogram) {
    cycleDurationHistogram = getMeter().createHistogram("agent.cycle.duration_ms", {
      description: "Trading cycle wall-clock duration",
      unit: "ms",
    });
  }
  return cycleDurationHistogram;
}

function tradesSucceeded(): Counter {
  if (!tradesSucceededCounter) {
    tradesSucceededCounter = getMeter().createCounter("agent.trades.succeeded", {
      description: "Successful trade executions per cycle",
    });
  }
  return tradesSucceededCounter;
}

function tradesFailed(): Counter {
  if (!tradesFailedCounter) {
    tradesFailedCounter = getMeter().createCounter("agent.trades.failed", {
      description: "Failed trade executions per cycle",
    });
  }
  return tradesFailedCounter;
}

function anchorResults(): Counter {
  if (!anchorResultCounter) {
    anchorResultCounter = getMeter().createCounter("agent.anchor.results", {
      description: "Cross-chain anchor attempts by adapter and outcome",
    });
  }
  return anchorResultCounter;
}

export interface CycleMetricsInput {
  cycle: number;
  durationMs: number;
  portfolioUsd: number;
  drawdownPercent: number;
  activePositions: number;
  guardrailsRejected: number;
  tradesSucceeded: number;
  tradesFailed: number;
  regimeScore: number | null;
  anchorOutcomes: Array<{ adapter: string; status: string }>;
}

export function recordCycleMetrics(input: CycleMetricsInput): void {
  if (!isTelemetryEnabled()) return;

  initGauges();
  latestPortfolioUsd = input.portfolioUsd;
  latestRegimeScore = input.regimeScore;
  latestDrawdownPercent = input.drawdownPercent;
  latestActivePositions = input.activePositions;

  const attrs = { "cycle.number": input.cycle };

  cycleDuration().record(input.durationMs, attrs);

  if (input.tradesSucceeded > 0) {
    tradesSucceeded().add(input.tradesSucceeded, attrs);
  }
  if (input.tradesFailed > 0) {
    tradesFailed().add(input.tradesFailed, attrs);
  }
  if (input.guardrailsRejected > 0) {
    guardrailRejected().add(input.guardrailsRejected, attrs);
  }

  for (const outcome of input.anchorOutcomes) {
    anchorResults().add(1, {
      ...attrs,
      "anchor.adapter": outcome.adapter,
      "anchor.status": outcome.status,
    });
  }
}
