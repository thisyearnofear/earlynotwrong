# Agent Observability (OpenTelemetry + SigNoz)

The trading agent exports traces and metrics via OTLP when configured. This supports the [SigNoz Observability Hackathon](../hackathons.md) **AI & Agent Observability** track.

## Quick start

### 1. Install SigNoz via Foundry

```bash
# Install foundryctl (once)
curl -fsSL https://raw.githubusercontent.com/SigNoz/foundry/main/scripts/install.sh | bash

# From repo root — uses casting.yaml
foundryctl cast -f casting.yaml
```

SigNoz UI: [http://localhost:8080](http://localhost:8080)  
OTLP HTTP endpoint (agent default): `http://localhost:4318`

### 2. Enable agent export

Add to `agent/.env` (or VPS env):

```bash
OTEL_ENABLED=1
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
OTEL_SERVICE_NAME=early-not-wrong-agent
```

Restart the agent. Startup logs show `[otel] Exporting traces + metrics to …`.

When unset, telemetry is a no-op — production behavior is unchanged.

### 3. Import dashboard + alerts

**Option A — script (API):**

```bash
# Generate dashboard JSON from source (after editing generate-dashboard.mjs)
node docs/observability/scripts/generate-dashboard.mjs

# Import dashboard + 4 alert rules (SigNoz v0.133+ for v2 rules API)
SIGNOZ_URL=http://localhost:8080 SIGNOZ_API_KEY=your-key \
  node docs/observability/scripts/import-signoz-assets.mjs
```

**Option B — UI:**

1. Dashboards → **Import JSON** → `docs/observability/dashboards/agent-trading-operations.json`
2. Alerts → create rules manually using thresholds in `docs/observability/alerts/*.json`

## Trace waterfall (`agent.run_cycle`)

Each 4-hour cycle produces a root span with child spans:

| Span | Source |
|------|--------|
| `agent.run_cycle` | Root — cycle number, duration, portfolio |
| `agent.fetch_portfolio` | TWAK + on-chain augmentation |
| `agent.fetch_market_data` | SoSoValue + CMC composite |
| `conviction.analyze` | Regime + token scoring |
| `conviction.score_regime` | Fear & Greed + funding composite |
| `conviction.llm_jury` | 7th factor |
| `conviction.casper_mcp` | Cross-chain MCP context |
| `conviction.jury_deliberate` | LLM provider + latency |
| `agent.manage_positions` | Tiered exits |
| `agent.harvest_bnb` | Bankroll harvest |
| `agent.create_proposals` | Entry candidates |
| `agent.check_guardrails` | Risk limits |
| `agent.execute_trades` | SoDEX / TWAK |
| `agent.anchor_chains` | Mantle + Casper (not Aleo) |
| `agent.generate_narrative` | Market narrative |
| `agent.self_analysis` | Behavioral conviction |

## Metrics

| Metric | Description |
|--------|-------------|
| `agent.cycle.duration_ms` | Cycle wall time |
| `agent.trades.succeeded` / `agent.trades.failed` | Execution outcomes |
| `agent.anchor.results` | Labels: `anchor.adapter`, `anchor.status` |
| `agent.portfolio.usd` | Portfolio gauge |
| `agent.regime.score` | Regime score gauge |
| `agent.drawdown.percent` | Drawdown from peak |
| `agent.positions.active` | Non-stuck open positions |
| `agent.guardrails.rejected` | Proposals blocked by guardrails |

## Dashboard: Trading Operations

Pre-built panels (`docs/observability/dashboards/agent-trading-operations.json`):

1. **Portfolio pulse** — USD value, regime score, drawdown %, active positions
2. **Cycle health** — duration, trade outcomes, anchor reliability, guardrail rejections
3. **Trace waterfall** — recent `agent.run_cycle` traces (click through to step spans)

Regenerate after editing panel definitions:

```bash
node docs/observability/scripts/generate-dashboard.mjs
```

## Alerts

| Rule file | Fires when |
|-----------|------------|
| `alerts/drawdown-warning.json` | Drawdown > 20% |
| `alerts/trade-failure.json` | Any failed trade in window |
| `alerts/cycle-slow.json` | Cycle duration > 10 min |
| `alerts/anchor-failure.json` | Mantle or Casper anchor `failed` |

Wire notification channels in SigNoz UI after import (Slack/PagerDuty/etc.).

## Structured logs

When spans are active, `cycleLog` emits JSON with `trace_id` / `span_id` for log-trace correlation in SigNoz.

## Web dashboard (`/agent`)

The Next.js agent page reads `observability` from `GET /status` and shows:

- OTel on/off, last cycle duration, drawdown, trades, regime, anchor chips
- Trace ID with copy + **View in SigNoz** when `NEXT_PUBLIC_SIGNOZ_URL` is set on the web app

Module: `agent/lib/telemetry/`
