# Deployment — Running the Buyer Agent as a Scheduled Job

> How a third-party allocator deploys this buyer agent to run automatically
> each cycle, persisting its audit trail.

The buyer agent is designed to run as a **cron job**: every 4 hours (matching
the agent's cycle interval) it queries reputation, checks edge, fetches
signals, and logs a verifiable pre-trade decision. This is the "one real
integration" — a production allocator loop, not a one-shot demo.

## Quick start (local cron)

```bash
# 1. Install
cd examples/buyer-agent
npm install            # casper-js-sdk is optional — only needed for paid x402

# 2. Dry-run (verify the trust gate works against the live agent)
node index.mjs --dry-run

# 3. Schedule it every 4 hours via cron
crontab -e
```

Add a line that runs the buyer in `--json` mode (machine-readable audit) and
appends to a log file:

```cron
# Early, Not Wrong buyer agent — every 4 hours at minute 5 (offset from the
# agent's cycle so signals are fresh)
5 */4 * * * cd /path/to/examples/buyer-agent && node index.mjs --edge-report --json >> /var/log/enw-buyer.log 2>&1
```

The `--json` flag emits one JSON object per line (JSONL), so the log is
greppable and parseable:

```bash
# Show the last 10 decisions
tail -10 /var/log/enw-buyer.log | jq .

# Count decisions by action over the last week
grep "$(date -d '7 days ago' +%Y-%m-%d)" /var/log/enw-buyer.log | jq -r .decision | sort | uniq -c

# Find every time the buyer opened a position
jq 'select(.decision == "OPEN")' /var/log/enw-buyer.log
```

## Environment variables

| Var | Required | Purpose |
|-----|----------|---------|
| `AGENT_URL` | No | Agent endpoint (default: `http://144.202.117.160:31777`) |
| `CASPER_PRIVATE_KEY_HEX` | No | Ed25519 private key (hex, 128 chars) for x402 payment. Without it, the buyer falls back to the free teaser. |
| `TRUST_MIN_ANCHORS` | No | Minimum anchor count to trust (default: 5) |
| `TRUST_MIN_MEAN_SCORE` | No | Minimum mean conviction score to trust (default: 50) |
| `TRUST_REQUIRE_DUAL_CHAIN` | No | Set `"true"` to require both Mantle + Casper anchors (default: soft warning) |
| `BUYER_MAX_POSITION_USD` | No | Max position size when `guidance = evaluate` (default: 100) |

## Flags

| Flag | Purpose |
|------|---------|
| `--dry-run` | Stop after the trust gate (no paid call) |
| `--json` | Emit one JSON audit object per line (for cron / parsing) |
| `--edge-report` | Fetch `/edge-report` first; skip the paid call if the signal has no demonstrable edge |

## The decision contract (what the audit log records)

Each run emits a JSON object like:

```json
{
  "ts": "2026-07-23T14:02:11Z",
  "trusted": true,
  "anchors": 176,
  "meanConviction": 71.3,
  "dualChain": false,
  "edge": { "hasEdge": true, "convictionSharpe": 6.42, "naiveSharpe": -10.45, "dataSource": "live" },
  "paid": true,
  "cycle": 312,
  "stale": false,
  "guidance": "evaluate",
  "topCandidate": "FET",
  "behavioralStatus": "ready",
  "behavioralScore": 72,
  "decision": "OPEN",
  "symbol": "FET",
  "usd": 50,
  "reason": "conviction 74/100, behavioral provenance ready (72, Iron Pillar)"
}
```

A downstream executor (your treasury bot) reads this line and places the
trade. The buyer agent itself never touches your funds — it only emits the
decision. This separation is deliberate: the reputation marketplace proves
*conviction*, your executor holds *custody*.

## Enabling the paid x402 round-trip

Without `CASPER_PRIVATE_KEY_HEX`, the buyer uses the free teaser (guidance +
top symbol only). To get the full `signals-live/v1.2` payload via x402:

1. **Get a Casper testnet wallet** with CSPR: <https://testnet.cspr.live/faucet>
2. **Swap CSPR → Cep18x402** on the cspr.cloud testnet DEX (the canonical
   x402 payment token)
3. **Install the SDK**: `npm install casper-js-sdk` (optional dependency —
   without it, the buyer sends an unsigned envelope so the facilitator's
   rejection is observable in logs)
4. **Set the key**: `export CASPER_PRIVATE_KEY_HEX=<128 hex chars>`

The buyer then constructs a signed CEP-18 transfer, sends it in the
`X-PAYMENT` header, and the cspr.cloud facilitator settles on-chain. See
`examples/x402-client/` for the full payment mechanics reference.

## Docker

```dockerfile
FROM node:20-slim
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY index.mjs ./
# Run every 4 hours via a cron-like loop, or let your orchestrator schedule it
CMD ["node", "index.mjs", "--edge-report", "--json"]
```

```bash
docker build -t enw-buyer .
# Run once (your orchestrator schedules recurrence):
docker run --rm -e AGENT_URL=http://my-agent:31777 enw-buyer
```

## Exit codes

| Code | Meaning |
|------|---------|
| 0 | Decision emitted (any action — OPEN, WAIT, SKIP, STAND_DOWN) |
| 1 | Error (agent unreachable, parse failure) |

The buyer exits 0 even when it decides to WAIT or STAND_DOWN — a "no trade"
decision is a successful decision, not a failure. Only infrastructure errors
exit non-zero, so your cron alerting can treat exit 1 as "investigate."
