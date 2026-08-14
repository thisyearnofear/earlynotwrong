#!/usr/bin/env node

/**
 * Buyer Agent — Allocator Decision Flow
 *
 * A complete, copy-paste-able example of an autonomous allocator agent
 * consuming the Early, Not Wrong reputation marketplace to make a verifiable
 * pre-trade decision.
 *
 * Flow:
 *   1. TRUST GATE (free)   — get_agent_reputation → is this agent worth listening to?
 *   2. GET SIGNALS (paid)  — get_live_signals → what's the call this cycle?
 *   3. ACT + AUDIT         — apply the buyer's own rules to guidance.recommendedAction
 *
 * See README.md for the full decision contract and trust threshold.
 *
 * No runtime dependencies — pure Node.js (uses global fetch).
 */

const AGENT_URL = process.env.AGENT_URL || "http://144.202.117.160:31777";
const MCP_ENDPOINT = `${AGENT_URL}/mcp`;

// Trust threshold (configurable via env). The free reputation call gates
// whether we spend anything on the paid signals call.
const TRUST_MIN_ANCHORS = parseInt(process.env.TRUST_MIN_ANCHORS ?? "5", 10);
const TRUST_MIN_MEAN_SCORE = parseInt(process.env.TRUST_MIN_MEAN_SCORE ?? "50", 10);
// Dual-chain is a SOFT signal, not a hard gate: a single-chain agent with a
// long anchor history is still trustworthy. Set to "true" to make it a hard
// gate (stricter — requires both Mantle + Casper commitment).
const TRUST_REQUIRE_DUAL_CHAIN = process.env.TRUST_REQUIRE_DUAL_CHAIN === "true";

// The buyer's own sizing (edit to match your treasury rules).
const BUYER_MAX_POSITION_USD = parseFloat(process.env.BUYER_MAX_POSITION_USD ?? "100");

// The agent's own subject hash (bsc:identity-registry). This is the same
// hash the agent anchors under — see agent/lib/config.ts.
const AGENT_SUBJECT_HASH =
  process.env.AGENT_SUBJECT_HASH ||
  "0x4a937673ea542abdf587e6b509793b2173980228cc65180a2f32c24fd3ac459a";

const DRY_RUN = process.argv.includes("--dry-run");
const JSON_MODE = process.argv.includes("--json");
const CHECK_EDGE = process.argv.includes("--edge-report");
const TEST_MODE = process.argv.includes("--test");
const TEST_WALLET_MODE = process.argv.includes("--test-wallet");
const ts = () => new Date().toISOString();

function log(tag, msg) {
  if (JSON_MODE) return; // suppress human logs in JSON mode
  console.log(`[buyer] ${ts()} ${tag} ${msg}`);
}

/** POST a JSON-RPC message to the MCP endpoint. Returns {status, body}. */
async function mcpCall(method, params, extraHeaders = {}) {
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
  const res = await fetch(MCP_ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...extraHeaders,
    },
    body,
  });
  const text = await res.text();
  let parsed;
  try {
    const lines = text.split("\n");
    const dataLine = lines.find((l) => l.startsWith("data: "));
    parsed = dataLine ? JSON.parse(dataLine.slice(6)) : JSON.parse(text);
  } catch {
    parsed = text;
  }
  return { status: res.status, headers: res.headers, body: parsed };
}

/** Extract the MCP tool result content (JSON) from a tools/call response. */
function extractToolResult(response) {
  // MCP tools/call returns { result: { content: [{ type: "text", text: "..." }] } }
  const content = response?.result?.content;
  if (Array.isArray(content) && content[0]?.text) {
    try {
      return JSON.parse(content[0].text);
    } catch {
      return null;
    }
  }
  return null;
}

// ─── Step 1: Trust gate (free) ─────────────────────────────────────────────

/**
 * Call get_agent_reputation (free) and decide whether to trust this agent.
 * Returns { trusted, reputation, reason }.
 */
async function trustGate() {
  log("trust", `querying reputation (free) — subjectHash=${AGENT_SUBJECT_HASH.slice(0, 10)}…`);
  const { status, body } = await mcpCall("tools/call", {
    name: "get_agent_reputation",
    arguments: { subjectHash: AGENT_SUBJECT_HASH },
  });

  if (status !== 200) {
    return { trusted: false, reputation: null, reason: `reputation query failed (HTTP ${status})` };
  }

  const rep = extractToolResult(body);
  if (!rep) {
    return { trusted: false, reputation: null, reason: "could not parse reputation response" };
  }

  const anchors = rep.totalAnchors ?? 0;
  const mean = rep.meanConvictionScore ?? 0;
  const dualChain = rep.dualChain ?? false;

  log(
    "trust",
    `anchors=${anchors} mean=${mean} dualChain=${dualChain} archetypes=[${(rep.archetypes ?? []).join(", ")}]`,
  );

  const reasons = [];
  const warnings = [];
  if (anchors < TRUST_MIN_ANCHORS) reasons.push(`anchors ${anchors} < ${TRUST_MIN_ANCHORS}`);
  if (mean < TRUST_MIN_MEAN_SCORE) reasons.push(`mean ${mean} < ${TRUST_MIN_MEAN_SCORE}`);
  if (TRUST_REQUIRE_DUAL_CHAIN && !dualChain) {
    reasons.push("not dual-chain anchored");
  } else if (!dualChain) {
    // Soft warning: single-chain anchoring is acceptable but worth noting.
    warnings.push("single-chain only (Mantle anchors missing)");
  }

  if (reasons.length > 0) {
    return { trusted: false, reputation: rep, reason: `UNTRUSTED: ${reasons.join("; ")}` };
  }
  const trustReason = `TRUSTED: ${anchors} anchors, mean ${mean}${dualChain ? ", dual-chain" : ", single-chain"}`;
  if (warnings.length > 0) {
    log("trust", `note: ${warnings.join("; ")}`);
  }
  return { trusted: true, reputation: rep, reason: trustReason };
}

// ─── Step 2: Get signals (paid) ─────────────────────────────────────────────

/**
 * Construct the x402 payment header from a 402 PaymentRequirements object.
 *
 * In production this uses casper-js-sdk to sign a real CEP-18 transfer deploy
 * for the Cep18x402 token. The cspr.cloud facilitator verifies the signed
 * transfer on-chain before settling. See examples/x402-client/ for the full
 * signing mechanics — this helper produces the header structure a signed
 * deploy slots into.
 *
 * When CASPER_PRIVATE_KEY_HEX is set but casper-js-sdk isn't installed, we
 * still construct the header envelope so the facilitator can reject it with
 * a clear error (rather than silently falling back to the teaser). This
 * makes the payment path observable in logs.
 */
function buildPaymentHeader(requirements, signedDeploy) {
  return Buffer.from(
    JSON.stringify({
      x402Version: 2,
      resource: { url: MCP_ENDPOINT },
      accepted: requirements,
      payload: signedDeploy ?? {
        // When no signed deploy is provided, we send the envelope with a
        // placeholder. The facilitator returns a settlement error, which the
        // caller surfaces — this keeps the payment path visible rather than
        // silently degrading to the free teaser.
        network: requirements.network,
        asset: requirements.asset,
        amount: requirements.amount,
        payTo: requirements.payTo,
        note: "unsigned — install casper-js-sdk and sign a CEP-18 transfer to settle",
      },
    }),
  ).toString("base64");
}

/**
 * Call get_live_signals (paid via x402). Payment path:
 *   - No wallet configured → fall back to the public teaser (PREVIEW only).
 *   - Wallet configured → get the 402 challenge, construct X-PAYMENT, re-POST.
 *     If casper-js-sdk is installed and the key has Cep18x402 tokens, the
 *     facilitator settles on-chain and returns the full signals-live/v1.2.
 *     Otherwise the 402 is surfaced so the buyer sees exactly what's needed.
 */
async function getSignals() {
  const hasWallet = !!process.env.CASPER_PRIVATE_KEY_HEX;

  if (!hasWallet) {
    log("signals", "no Cep18x402 wallet configured — fetching public teaser (PREVIEW only)");
    // The teaser is the free, guidance-only surface. A real buyer pays for
    // the full payload, but the teaser still carries the guidance contract
    // so the decision flow can be demonstrated end-to-end.
    try {
      const res = await fetch(`${AGENT_URL}/signals/teaser`);
      if (res.ok) {
        const teaser = await res.json();
        return { signals: teaser, paid: false, reason: "teaser (no wallet)" };
      }
    } catch {
      // fall through to the paid attempt below
    }
    log("signals", "teaser unavailable — attempting paid call (will get 402 challenge)");
  }

  // Step 2a: get the 402 challenge.
  const { status: chStatus, body: challenge } = await mcpCall("tools/call", {
    name: "get_live_signals",
    arguments: {},
  });

  if (chStatus === 200) {
    // No paywall (e.g. simulator mode or paywall disabled) — return directly.
    const signals = extractToolResult(challenge);
    if (signals) {
      log("signals", `no paywall — cycle=${signals.freshness?.cycle} stale=${signals.freshness?.stale}`);
      return { signals, paid: false, reason: "live signals-live/v1.2 (no paywall)" };
    }
    return { signals: null, paid: false, reason: "could not parse signals response" };
  }

  if (chStatus !== 402) {
    return { signals: null, paid: false, reason: `signals call failed (HTTP ${chStatus})` };
  }

  const requirements = challenge?.accepts?.[0];
  if (!requirements) {
    return { signals: null, paid: false, reason: "402 without PaymentRequirements" };
  }

  const amt = `${parseInt(requirements.amount) / Math.pow(10, parseInt(requirements.extra?.decimals || "2"))} ${requirements.extra?.symbol}`;

  if (!hasWallet) {
    log("signals", `402 Payment Required — needs ${amt} to ${requirements.payTo?.slice(0, 10)}… (set CASPER_PRIVATE_KEY_HEX to pay)`);
    return { signals: null, paid: false, reason: `payment required (${amt})` };
  }

  // Step 2b: wallet configured — attempt the x402 round-trip.
  log("signals", `402 challenge — constructing x402 payment for ${amt}`);

  // Try to load casper-js-sdk for real signing. If it's not installed, we
  // send the unsigned envelope so the facilitator's rejection is observable.
  let signedDeploy = null;
  try {
    // Dynamic import so the example runs without casper-js-sdk installed.
    // A production buyer installs it: npm install casper-js-sdk
    const sdk = await import("casper-js-sdk");
    signedDeploy = await signCep18Transfer(sdk, requirements);
    log("signals", "signed CEP-18 transfer deploy constructed");
  } catch (e) {
    log("signals", `casper-js-sdk unavailable (${e.code === "ERR_MODULE_NOT_FOUND" ? "not installed" : e.message}) — sending unsigned envelope`);
  }

  const xPayment = buildPaymentHeader(requirements, signedDeploy);
  const { status: paidStatus, headers: paidHeaders, body: paidBody } = await mcpCall(
    "tools/call",
    { name: "get_live_signals", arguments: {} },
    { "X-PAYMENT": xPayment },
  );

  if (paidStatus === 200) {
    const signals = extractToolResult(paidBody);
    if (signals) {
      const settle = paidHeaders.get("x-payment-response");
      log("signals", `PAID ✓ settled${settle ? " — settlement confirmed" : ""} · cycle=${signals.freshness?.cycle}`);
      return { signals, paid: true, reason: "live signals-live/v1.2 (x402 settled)" };
    }
    return { signals: null, paid: false, reason: "paid call returned 200 but unparseable body" };
  }

  if (paidStatus === 402) {
    log("signals", `payment rejected by facilitator (HTTP 402) — install casper-js-sdk and fund Cep18x402 tokens`);
    return { signals: null, paid: false, reason: `payment rejected (402) — needs ${amt}, fund Cep18x402 tokens` };
  }

  return { signals: null, paid: false, reason: `paid call failed (HTTP ${paidStatus})` };
}

/**
 * Sign a CEP-18 transfer deploy for the Cep18x402 token using casper-js-sdk.
 * This is the production payment path — a real buyer with a funded testnet
 * wallet (CSPR → Cep18x402 swap on cspr.cloud) settles on-chain here.
 *
 * Returns a signed deploy object the facilitator can verify + submit.
 */
async function signCep18Transfer(sdk, requirements) {
  const { Keys, CLValue, DeployUtil, RuntimeArgs } = sdk;
  const privateKeyHex = process.env.CASPER_PRIVATE_KEY_HEX;
  // Ed25519 private key is 128 hex chars (64 bytes). The public key is the
  // last 32 bytes derived via the SDK.
  const signingKey = Keys.Ed25519.parsePrivateKey(privateKeyHex);
  const publicKey = Keys.Ed25519.privateToPublicKey(signingKey);
  const accountHash = publicKey.toAccountHash();

  // The Cep18x402 transfer args: recipient (payTo), amount, token contract.
  const amount = requirements.amount;
  const recipient = requirements.payTo;
  const tokenContract = requirements.asset;

  const args = RuntimeArgs.fromMap({
    recipient: CLValue.publicKey(publicKey),
    amount: CLValue.u256(amount),
  });

  // Build a session deploy calling the CEP-18 `transfer` entrypoint.
  // The exact network/chain name comes from the PaymentRequirements.
  const deploy = DeployUtil.buildDeploy(
    "session",
    tokenContract,
    "transfer",
    args,
    requirements.network ?? "casper-test",
    publicKey,
    "10000000000", // 10 CSPR payment cap (refunded for unused gas)
    1, // standard timestamp TTL
    [], // no custom args
  );
  deploy.sign(signingKey);
  return deploy;
}

// ─── Optional: edge report (free, informs trust) ──────────────────────────

/**
 * Fetch the on-demand edge report (GET /edge-report). This is a free signal
 * a sophisticated buyer can check BEFORE paying for live signals: if the
 * conviction strategy has no demonstrable edge over a naive baseline, the
 * buyer knows not to spend on the paid call this cycle.
 *
 * Returns { hasEdge, verdict, dataSource } or null if unavailable.
 */
async function checkEdge() {
  try {
    const res = await fetch(`${AGENT_URL}/edge-report`, {
      signal: AbortSignal.timeout(30_000), // backtest can take a few seconds
    });
    if (!res.ok) return null;
    const report = await res.json();
    return {
      hasEdge: report.hasEdge,
      verdict: report.verdict,
      convictionSharpe: report.conviction?.sharpeRatio,
      naiveSharpe: report.naive?.sharpeRatio,
      dataSource: report.dataSource,
      staleSymbols: report.staleSymbols ?? [],
      cached: report.cached ?? false,
    };
  } catch {
    return null;
  }
}

// ─── Step 3: Act + audit ───────────────────────────────────────────────────

/**
 * Apply the buyer's own decision policy to the signals payload.
 *
 * The buyer NEVER trusts the signal blindly — it cross-checks the agent's
 * behavioral provenance before acting on `evaluate`.
 */
function decide(signals) {
  if (!signals) {
    return { action: "wait", symbol: null, usd: 0, reason: "no signals payload" };
  }

  // Teaser payload has a slightly different shape (guidance at top level).
  const guidance = signals.guidance;
  const freshness = signals.freshness;
  const provenance = signals.provenance;

  if (!guidance) {
    return { action: "wait", symbol: null, usd: 0, reason: "no guidance in payload" };
  }

  // Stale data → wait, don't act on a stale signal.
  if (freshness?.stale) {
    return { action: "wait", symbol: null, usd: 0, reason: freshness.staleReason ?? "signal data is stale" };
  }

  // Behavioral provenance cross-check: if the agent hasn't earned its own
  // behavioral conviction score, downgrade `evaluate` to `wait`. A signal
  // from an agent with insufficient_history is not actionable.
  const behavioral = provenance?.behavioral;
  const behavioralReady = behavioral?.status === "ready";
  if (guidance.recommendedAction === "evaluate" && !behavioralReady) {
    return {
      action: "wait",
      symbol: guidance.topCandidate,
      usd: 0,
      reason: `evaluate downgraded to wait — behavioral provenance ${behavioral?.status ?? "unknown"} (agent hasn't earned its own conviction score yet)`,
    };
  }

  switch (guidance.recommendedAction) {
    case "skip_entries":
      return {
        action: "skip_entries",
        symbol: guidance.topCandidate,
        usd: 0,
        reason: guidance.reason,
      };
    case "wait":
      return {
        action: "wait",
        symbol: guidance.topCandidate,
        usd: 0,
        reason: guidance.reason,
      };
    case "evaluate": {
      const sizeMultiplier = guidance.sizeMultiplier ?? 1;
      const usd = Math.round(BUYER_MAX_POSITION_USD * sizeMultiplier * 100) / 100;
      const top = signals.signals?.[0];
      const score = top?.score ?? "?";
      const archetype = behavioral?.metrics?.archetype ?? "unknown";
      const behavioralScore = behavioral?.metrics?.score ?? "?";
      return {
        action: "OPEN",
        symbol: guidance.topCandidate,
        usd,
        reason: `conviction ${score}/100, behavioral provenance ready (${behavioralScore}, ${archetype})`,
      };
    }
    default:
      return { action: "wait", symbol: null, usd: 0, reason: `unknown recommendedAction: ${guidance.recommendedAction}` };
  }
}

// ─── Orchestration ─────────────────────────────────────────────────────────

/**
 * Test mode — for human CROO Store testers (the Test & Earn initiative).
 *
 * Runs ONE paid signals-live order, pretty-prints the delivered JSON, and
 * prints an inline feedback prompt so the tester knows what to feed back to
 * the builder. Exits 0 on success. This is the fastest path from "I found
 * the agent on the CROO Store" to "I have something concrete to say about it."
 */
/**
 * Test-wallet mode — score a famous public wallet via the wallet-score service.
 *
 * The second testable product for CROO Test & Earn. Instead of the agent's
 * own signals (signals-live), this scores an ARBITRARY wallet's behavioral
 * conviction: win rate, patience tax, archetype, cohort percentile. Uses a
 * well-known public address by default so a tester gets a consistent,
 * comparable result. See FEEDBACK.md for the questions.
 */
const DEFAULT_TEST_WALLET = {
  address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045", // vitalik.eth
  chain: "base",
  name: "vitalik.eth",
};

async function runTestWalletMode() {
  // Allow override via CLI args: --wallet=0x... --chain=base --name=...
  const walletArg = process.argv.find((a) => a.startsWith("--wallet="));
  const chainArg = process.argv.find((a) => a.startsWith("--chain="));
  const nameArg = process.argv.find((a) => a.startsWith("--name="));
  const wallet = walletArg ? walletArg.split("=")[1] : DEFAULT_TEST_WALLET.address;
  const chain = chainArg ? chainArg.split("=")[1] : DEFAULT_TEST_WALLET.chain;
  const name = nameArg ? nameArg.split("=")[1] : DEFAULT_TEST_WALLET.name;

  console.log(`\n  🧪 TEST-WALLET MODE — wallet-score service`);
  console.log(`  ${"─".repeat(50)}`);
  console.log(`  agent:   ${AGENT_URL}`);
  console.log(`  service: wallet-score ($0.05 USDC via CROO CAP)`);
  console.log(`  wallet:  ${name} (${wallet})`);
  console.log(`  chain:   ${chain}\n`);

  // Call the score_wallet MCP tool (paid via x402 in production; in test mode
  // we call the tool directly — the CROO order flow is exercised by --test).
  console.log(`  Calling score_wallet...`);
  const { status, body } = await mcpCall("tools/call", {
    name: "score_wallet",
    arguments: { address: wallet, chain, resolvedName: name },
  });

  if (status !== 200) {
    console.log(`     ⚠️  MCP call failed (HTTP ${status})`);
    console.log(`     ${body.slice(0, 300)}`);
    console.log(`\n  Note: the score_wallet tool proxies to the web app's /api/agent/wallet-score.`);
    console.log(`  If the agent is local, ensure the web app is reachable or set WALLET_SCORE_URL.\n`);
    return;
  }

  // Parse the MCP response — the tool returns text content with the JSON.
  let scorePayload;
  try {
    const parsed = JSON.parse(body);
    // MCP tools/call returns { result: { content: [{ type: "text", text: "..." }] } }
    const textContent = parsed?.result?.content?.[0]?.text ?? parsed?.content?.[0]?.text;
    scorePayload = textContent ? JSON.parse(textContent) : parsed;
  } catch {
    console.log(`     ⚠️  Could not parse MCP response:`);
    console.log(`     ${body.slice(0, 500)}`);
    return;
  }

  // Pretty-print the deliverable.
  console.log(`\n  1. Delivered JSON (wallet-score/v1):`);
  console.log(`  ${"─".repeat(50)}`);
  console.log(JSON.stringify(scorePayload, null, 2));
  console.log(`  ${"─".repeat(50)}`);

  // Inline feedback prompt — the point of Test & Earn.
  console.log(`\n  2. What to feed back (see FEEDBACK.md for the full list):`);
  console.log(`     • Did the score match your intuition for this wallet?`);
  console.log(`     • Is the archetype (${scorePayload.archetype ?? "?"}) meaningful or just a label?`);
  console.log(`     • Did the patience tax ($${scorePayload.metrics?.patienceTaxUsd ?? "?"}) feel honest?`);
  console.log(`     • Could you recompute the ledger hash from on-chain data? (proof.ledgerHash)`);
  console.log(`     • Was the cohort percentile (${scorePayload.cohort?.percentile ?? "?"}%) useful context?`);
  console.log(`     • One thing you'd change about the deliverable?\n`);
  console.log(`  Quote-post on X + submit in Discord per the Test & Earn rules.\n`);
}

async function runTestMode() {
  console.log(`\n  🧪 TEST MODE — CROO Store tester flow`);
  console.log(`  ${"─".repeat(50)}`);
  console.log(`  agent:   ${AGENT_URL}`);
  console.log(`  service: signals-live ($0.05 USDC via CROO CAP)\n`);

  // Trust gate first (free) — show the tester what the agent's reputation is.
  const trust = await trustGate();
  console.log(`  1. Trust gate (free):`);
  console.log(`     ${trust.trusted ? "✅ trusted" : "⚠️  untrusted"} — ${trust.reason}`);
  if (trust.reputation) {
    console.log(`     anchors=${trust.reputation.totalAnchors} mean=${trust.reputation.meanConvictionScore} dualChain=${trust.reputation.dualChain}`);
  }

  // One paid order.
  console.log(`\n  2. Ordering signals-live (paid)...`);
  const { signals, paid, reason } = await getSignals();
  if (!signals) {
    console.log(`     ⚠️  No signals delivered — ${reason}`);
    console.log(`\n  Feedback prompt: did the agent explain WHY no signals were available?\n`);
    return;
  }
  console.log(`     ${paid ? "✅ paid order delivered" : "⚠️  teaser fallback (not paid)"} — ${reason}`);

  // Pretty-print the deliverable.
  console.log(`\n  3. Delivered JSON (signals-live/v1.2):`);
  console.log(`  ${"─".repeat(50)}`);
  console.log(JSON.stringify(signals, null, 2));
  console.log(`  ${"─".repeat(50)}`);

  // Inline feedback prompt — the point of Test & Earn.
  console.log(`\n  4. What to feed back (see FEEDBACK.md for the full list):`);
  console.log(`     • Was the JSON schema clear? Could you find the top candidate + guidance?`);
  console.log(`     • Did guidance.recommendedAction (${signals.guidance?.recommendedAction ?? "?"}) match what you'd have done?`);
  console.log(`     • Was the regime context (fear level ${signals.regime?.fearLevel ?? "?"}) useful?`);
  console.log(`     • Did the provenance/anchor links resolve?`);
  console.log(`     • One thing you'd change about the deliverable?\n`);
  console.log(`  Quote-post on X + submit in Discord per the Test & Earn rules.\n`);
}

async function main() {
  // ── Test mode: a single paid order, pretty-printed, with an inline
  // feedback prompt. Designed for human CROO Store testers, not allocators.
  // Bypasses the trust gate and edge pre-check so a tester gets straight to
  // the deliverable they're evaluating. See FEEDBACK.md for the questions.
  if (TEST_MODE) {
    return runTestMode();
  }

  // ── Test-wallet mode: score a famous public wallet via the wallet-score
  // service. The second testable product for CROO Test & Earn — behavioral
  // conviction scoring of an arbitrary wallet, not the agent's own signals.
  if (TEST_WALLET_MODE) {
    return runTestWalletMode();
  }

  if (!JSON_MODE) {
    console.log(`\n  BUYER AGENT — Allocator Decision Flow`);
    console.log(`  ${"─".repeat(50)}`);
    console.log(`  agent:     ${AGENT_URL}`);
    console.log(`  threshold: anchors≥${TRUST_MIN_ANCHORS} mean≥${TRUST_MIN_MEAN_SCORE} dualChain=${TRUST_REQUIRE_DUAL_CHAIN}`);
    console.log(`  max pos:   $${BUYER_MAX_POSITION_USD}${DRY_RUN ? "  (DRY-RUN)" : ""}${CHECK_EDGE ? "  (+edge)" : ""}\n`);
  }

  // Step 1: Trust gate (free).
  const trust = await trustGate();
  log("trust", trust.reason);
  if (!trust.trusted) {
    log("action", `STAND DOWN — ${trust.reason}`);
    if (!JSON_MODE) console.log(`\n  ❌ Untrusted — no paid call made, no position opened.\n`);
    emitAudit({ trust, edge: null, signals: null, decision: { action: "STAND_DOWN", symbol: null, usd: 0, reason: trust.reason } });
    return;
  }

  // Optional: edge-report pre-check (free). A sophisticated buyer checks
  // whether the signal has demonstrable edge before paying for live signals.
  let edge = null;
  if (CHECK_EDGE) {
    edge = await checkEdge();
    if (edge) {
      log("edge", `${edge.hasEdge ? "EDGE" : "NO EDGE"} — ${edge.verdict}`);
      if (!edge.hasEdge) {
        log("action", `WAIT — signal has no demonstrable edge over naive baseline`);
        if (!JSON_MODE) console.log(`\n  ⏸  No edge — skipping paid signals call.\n`);
        emitAudit({ trust, edge, signals: null, decision: { action: "WAIT", symbol: null, usd: 0, reason: "no demonstrable edge — conviction does not beat naive baseline" } });
        return;
      }
    } else {
      log("edge", "edge report unavailable — proceeding without edge pre-check");
    }
  }

  if (DRY_RUN) {
    log("action", "dry-run — stopping after trust gate (no paid call)");
    if (!JSON_MODE) console.log(`\n  ✅ Trusted (dry-run) — would call get_live_signals next.\n`);
    emitAudit({ trust, edge, signals: null, decision: { action: "DRY_RUN", symbol: null, usd: 0, reason: "dry-run — stopped after trust gate" } });
    return;
  }

  // Step 2: Get signals (paid, or teaser fallback).
  const { signals, paid, reason } = await getSignals();
  log("signals", reason);
  if (!signals) {
    log("action", `WAIT — ${reason}`);
    if (!JSON_MODE) console.log(`\n  ⏸  No signals — standing down.\n`);
    emitAudit({ trust, edge, signals: null, decision: { action: "WAIT", symbol: null, usd: 0, reason } });
    return;
  }

  // Step 3: Decide + audit.
  const decision = decide(signals);
  log(
    "guidance",
    `action=${signals.guidance?.recommendedAction} top=${signals.guidance?.topCandidate ?? "—"} size=${signals.guidance?.sizeMultiplier ?? 1}x behavioral=${signals.provenance?.behavioral?.status ?? "?"}`,
  );
  log("action", `${decision.action} ${decision.symbol ?? ""} ${decision.usd > 0 ? `$${decision.usd}` : ""} — ${decision.reason}`);

  emitAudit({ trust, edge, signals, decision });

  if (!JSON_MODE) {
    if (decision.action === "OPEN") {
      console.log(`\n  ✅ OPEN ${decision.symbol} for $${decision.usd} — ${decision.reason}`);
    } else {
      console.log(`\n  ⏸  ${decision.action.toUpperCase()} — ${decision.reason}`);
    }
    console.log();
  }
}

/** Emit the final audit record — JSON to stdout in --json mode, human log otherwise. */
function emitAudit({ trust, edge, signals, decision }) {
  const rep = trust?.reputation;
  const audit = {
    ts: ts(),
    trusted: trust?.trusted ?? false,
    anchors: rep?.totalAnchors ?? null,
    meanConviction: rep?.meanConvictionScore ?? null,
    dualChain: rep?.dualChain ?? null,
    edge: edge ? {
      hasEdge: edge.hasEdge,
      convictionSharpe: edge.convictionSharpe,
      naiveSharpe: edge.naiveSharpe,
      dataSource: edge.dataSource,
      staleSymbols: edge.staleSymbols,
      cached: edge.cached,
    } : null,
    paid: signals ? !signals.teaser : false,
    cycle: signals?.freshness?.cycle,
    stale: signals?.freshness?.stale,
    guidance: signals?.guidance?.recommendedAction,
    topCandidate: signals?.guidance?.topCandidate,
    behavioralStatus: signals?.provenance?.behavioral?.status,
    behavioralScore: signals?.provenance?.behavioral?.metrics?.score,
    decision: decision.action,
    symbol: decision.symbol,
    usd: decision.usd,
    reason: decision.reason,
  };
  if (JSON_MODE) {
    // Machine-readable: one JSON object per line, ready for a real allocator
    // agent to parse and persist as its verifiable pre-trade record.
    process.stdout.write(JSON.stringify(audit) + "\n");
  }
}

main().catch((err) => {
  log("error", err.message);
  console.error(err);
  process.exit(1);
});
