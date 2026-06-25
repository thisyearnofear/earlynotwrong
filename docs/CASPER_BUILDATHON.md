# Casper Agentic Buildathon 2026 — Submission

**Project**: Early, Not Wrong — Cross-Chain Conviction Registry
**Track**: Casper Innovation Track
**Status**: Built on top of an existing live BNB Hack agent (`docs/BNB_HACK_SUBMISSION.md`); the Casper-specific work — the Odra smart contract, the adapter, the orchestrator refactor, the dual-chain anchoring — was all written for this buildathon and is **net-new code**, called out file-by-file below.

---

## What This Is

A working **agentic AI trading agent** that does something most agent demos skip: it **proves its own analysis on-chain, on multiple chains, every cycle**. The Casper contribution is a portable agent-reputation layer (`ConvictionRegistry`) deployed on Casper Testnet via Odra. Every 4 hours, the agent computes a thesis hash from its market analysis and submits it to **both** Mantle (legacy ENW Phase II registry) **and** Casper (new). The same hash refers to the same analysis on either chain — making the agent's track record verifiable, queryable, and survivable across chain outages.

```
CMC Agent Hub ─► Conviction Engine ─► TWAK Execution ─► Anchor Orchestrator
   (data)            (scoring)           (swaps)          ├─► Mantle (existing)
                                                          └─► Casper (new)
```

The agent itself trades BNB-ecosystem tokens via TWAK with a six-factor contrarian conviction signal. The trading half is incidental to the Casper submission — the buildathon contribution is the **cross-chain settlement layer for AI-agent reputation**, with the trading agent as a real, autonomously-running source of records.

## Why Casper for Reputation?

Agent reputation is high-value but low-frequency data. It needs to be:
- **Durable** — a thesis that resolves over weeks must survive chain outages
- **Cheap per write** — anchoring every 4h × multiple agents adds up
- **Verifiable from anywhere** — consumers of reputation data shouldn't have to trust the agent's own claims

Casper's storage primitives map cleanly to a per-agent history of records. The Odra framework lets us express the registry in idiomatic Rust with the same shape as our existing Solidity contract — same record fields, same hashing scheme — so a downstream consumer reading from Mantle can read from Casper with the same struct.

## What's New in This Submission

| File | Purpose | Lines |
|------|---------|-------|
| `casper/src/conviction_registry.rs` | Odra smart contract — mirrors `MantleConvictionRegistry.sol`, ports the schema to Casper | ~200 |
| `casper/Cargo.toml`, `Odra.toml`, `rust-toolchain` | Odra workspace (scaffolded via `cargo odra new`) | — |
| `agent/lib/anchors/types.ts` | `AnchorAdapter` interface, `AnchorResult`, `ConvictionRecord` — chain-agnostic contract | 60 |
| `agent/lib/anchors/hashes.ts` | Extracted keccak helpers — single source of truth for hashing | 35 |
| `agent/lib/anchors/casper.ts` | Casper adapter using `casper-js-sdk` v5 — `ContractCallBuilder` + `putTransaction` | 150 |
| `agent/lib/anchors/mantle.ts` | Mantle adapter refactored to implement the new interface | 130 |
| `agent/lib/anchors/index.ts` | Orchestrator: `anchorAll()` walks enabled adapters, never throws | 70 |
| `agent/lib/explorers.ts` | BSC + Mantle + Casper explorer URL helpers | 35 |
| `agent/scripts/casper-deploy.mjs` | One-shot deploy script: WASM → Casper Testnet via SessionBuilder | 100 |
| `agent/__tests__/anchors.test.ts` | Unit tests — hashes, orchestrator semantics, stub adapters | 150 |
| `src/app/agent/page.tsx` (dual-chain UI) | Live dashboard renders one anchor row per chain | edit |

Plus the deletion of `agent/lib/mantle.ts` (its contents were extracted cleanly into the adapter pattern — no shim, no deprecation flag).

**Existing code that was refactored, not rewritten**: the BNB trading agent (`agent/index.ts`, `agent/lib/twak-executor.ts`, etc.) predates this buildathon. We collapsed a 95-line single-chain anchoring block into a 35-line dual-chain call to `anchorAll()`, but the trading logic — the conviction signal, the bankroll management, the harvest ladder — was not touched.

## Architecture

### The AnchorAdapter Interface

```typescript
export interface AnchorAdapter {
  readonly name: string;
  isAvailable(): boolean;
  anchor(record: ConvictionRecord): Promise<AnchorResult>;
}
```

One interface, two implementations (Mantle, Casper). Adding a third chain later is one file. The orchestrator iterates over `AGENT_CONFIG.anchoring.adapters` and aggregates per-chain results — failures on one chain don't block the other.

### The Smart Contract

`casper/src/conviction_registry.rs` exposes one main entry point:

```rust
pub fn anchor_conviction(
    &mut self,
    subject_hash: Bytes,    // 32 bytes — keccak256("chain:address")
    thesis_hash: Bytes,     // 32 bytes — keccak256(canonical analysis JSON)
    conviction_score: u8,   // 0–100
    archetype: String,      // e.g. "DEEP FEAR — PRIME CONTRARIAN"
    timestamp: u64,         // ms since epoch
);
```

Two indices: `subject_history` (full chronological list per subject) and `by_thesis` (point lookup by thesis hash). Operator authorization is enforced; the deployer becomes the first authorized operator on `init`. Four unit tests cover the happy path, history accumulation, owner/operator gating, and out-of-range rejection.

### The Orchestrator

```typescript
const results = await anchorAll({
  subjectHash,
  thesisHash,
  convictionScore: regimeScore,
  archetype: sentimentLabel,
  timestamp: Date.now(),
});
state.anchorResults = results;
```

Each `AnchorResult` carries `adapter` (chain name), `status`, `txHash`, `blockNumber`, `explorerUrl`. The agent surfaces them in:
- **Telegram**: one summary line per adapter that ran this cycle
- **`/conviction` HTTP API**: the `anchorResults` array
- **Live dashboard**: one explorer link per chain in the "Conviction anchored" panel

## Casper-Specific Toolkit Use

| Casper component | How we use it |
|------------------|---------------|
| **Odra Framework** | Smart contract written in idiomatic Rust with `#[odra::module]` macros; `cargo odra build` produces WASM; `cargo odra test` runs the OdraVM unit suite |
| **CSPR.cloud RPC** | `https://node.testnet.cspr.cloud/rpc` with `Authorization` header — used by both the deploy script and the runtime adapter |
| **casper-js-sdk v5** | `ContractCallBuilder` for entry-point calls, `SessionBuilder` for the install deploy, `PrivateKey.fromPem` for operator key loading |
| **TransactionV1 / putTransaction** | Confirmed casper-test runs protocol 2.0.0 (`info_get_status` reports `api_version: 2.0.0`) — the modern transaction path, not the legacy 1.5 deploy |
| **CSPR.live Explorer** | All adapter results include a `https://testnet.cspr.live/deploy/<hash>` link surfaced in the UI |

## Real-World Applicability

The reputation problem is general. Today an "AI agent" can:
1. Claim arbitrary past performance with no proof
2. Run a hidden strategy that doesn't match its public description
3. Disappear after losses with no auditable record

Our anchoring approach makes claims #1–3 falsifiable: every cycle's conviction signal is fingerprinted, hashed, and submitted on-chain *before* the trade settles. A consumer of the agent's reputation can independently verify which thesis preceded which trade, and across which chain. The same pattern applies to:

- **DeFi yield-routing agents** (the Casper buildathon's first example) — verifiable strategy hashes per rebalance
- **RWA oracle agents** — verifiable source-data digest per oracle update
- **Multi-agent DAO governance** — verifiable proposal-deliberation record per agent vote

We chose the trading-agent application because it's where the reputation matters most for a single user with their own money; the registry contract makes no assumptions about what's being anchored.

## What's Live

| Component | Where | Verifiable |
|-----------|-------|-----------|
| Trading agent | VPS under pm2, 4h cycles, BSC mainnet | https://bscscan.com/address/0xA1Dd482E4D6C8cf6f5f7BF80FEc6Bd3F11F5888a |
| Mantle anchor | Anchored every cycle (ERC-8004 registry) | https://explorer.sepolia.mantle.xyz/address/0x81226e8894D334c790D9a972855592E6C4eeB15C |
| Casper anchor | Deployed to Casper Testnet via `agent/scripts/casper-deploy.mjs` | https://testnet.cspr.live (deploy hash + contract hash in repo README) |
| Dashboard | `/agent` route on the Next.js app | proxies the agent's `/conviction` endpoint |

## How to Reproduce

```bash
# 1. Build the contract
cd casper
PATH=~/.rustup/toolchains/nightly-2026-01-01-x86_64-apple-darwin/bin:$PATH cargo odra build
# produces casper/wasm/ConvictionRegistry.wasm (~280KB)

# 2. Deploy to Casper Testnet
cd ../agent
export CSPR_CLOUD_TOKEN=<your-cspr.cloud-free-tier-token>
export CASPER_OPERATOR_PEM=/path/to/operator-secret.pem
node scripts/casper-deploy.mjs
# prints the deploy hash + contract hash

# 3. Wire the agent
export CASPER_REGISTRY_HASH=<contract-hash-from-step-2>
npm run dev  # or pm2 restart on the VPS

# 4. Verify
curl http://localhost:31777/conviction | jq .anchorResults
# expect: [{"adapter":"mantle","status":"success",...}, {"adapter":"casper","status":"success",...}]
```

## Tests

```
agent/__tests__/anchors.test.ts   — 10 tests for the adapter abstraction
agent/__tests__/*.test.ts         — 120 pre-existing tests for the trading agent
casper/src/conviction_registry.rs  — 4 OdraVM tests for the contract
```

Total: **130 TS tests + 4 Rust tests** all passing.

## Honest Caveats

- **The trading agent existed before this buildathon.** The Casper integration — Odra contract, casper-js-sdk adapter, deploy script, dual-chain orchestrator, dual-chain UI — is what's new. Everything net-new is listed in the "What's New" table above.
- **RWA is not our story.** The buildathon mentions DeFi and RWA prominently; we cover DeFi cleanly (an autonomous trading agent on BSC, anchoring to Casper). We won't pretend to do RWA — the architecture would support it (anchor any structured data with a hash), but our live demo doesn't.
- **Two manual prerequisites** for reviewers reproducing: a free-tier cspr.cloud token and a Casper testnet wallet from the official faucet. The deploy script fails fast with a clear error if either is missing.

## Links

- **Buildathon page**: https://dorahacks.io/hackathon/casper-agentic-2026
- **GitHub**: https://github.com/thisyearnofear/earlynotwrong
- **Live agent (BSC)**: 0xA1Dd482E4D6C8cf6f5f7BF80FEc6Bd3F11F5888a
- **Mantle registry**: 0x81226e8894D334c790D9a972855592E6C4eeB15C
- **Casper registry**: see the latest CASPER_REGISTRY_HASH in `agent/.env.example`
