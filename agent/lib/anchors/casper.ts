/**
 * Casper anchor adapter.
 *
 * Submits a ConvictionRecord to the Casper ConvictionRegistry contract on
 * Casper Testnet (Buildathon entry). Mirrors the schema of the Mantle adapter
 * — same record in, same AnchorResult out — so the orchestrator treats them
 * identically.
 *
 * Required env:
 *   - CSPR_CLOUD_TOKEN     — auth header for the cspr.cloud RPC
 *   - CASPER_OPERATOR_PEM  — path to the Ed25519 private key .pem
 *   - CASPER_REGISTRY_HASH — contract hash hex returned from deploy
 *                            (also fillable via AGENT_CONFIG.casper.testnet.registryHash)
 *
 * Without these, `isAvailable()` returns false and the orchestrator
 * gracefully skips this adapter — Mantle keeps anchoring.
 */

// casper-js-sdk ships pure CJS. Under Node's ESM runtime, named imports from
// a CJS module require the package to expose them at the top level — and the
// SDK's lib.node.js doesn't (verified: agent crashed at startup with
// "does not provide an export named 'Args'"). Default-import-then-destructure
// is the supported Node ESM ↔ CJS interop pattern.
import casperSdk from "casper-js-sdk";
import type {
  CLValue as CLValueT,
  PrivateKey as PrivateKeyT,
  PublicKey as PublicKeyT,
  RpcClient as RpcClientT,
} from "casper-js-sdk";
const {
  Args,
  CLTypeUInt8,
  CLValue,
  ContractCallBuilder,
  HttpHandler,
  KeyAlgorithm,
  PrivateKey,
  PublicKey,
  RpcClient,
  SessionBuilder,
  Transaction,
} = casperSdk;
type CLValue = CLValueT;
type PrivateKey = PrivateKeyT;
type PublicKey = PublicKeyT;
type RpcClient = RpcClientT;
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AGENT_CONFIG } from "../config.js";
import { getCasperExplorerTxUrl } from "../config.js";
import type { AnchorAdapter, AnchorResult, AnchoredRecord, Bytes32Hex, ConvictionRecord } from "./types.js";

// =============================================================================
// Internal helpers
// =============================================================================

/**
 * Replace common typographic characters with ASCII equivalents.
 *
 * Verified live: an em-dash (U+2014) in the archetype string triggered
 * `User error: 64649` inside the contract — likely Odra's String
 * deserializer choking on multi-byte UTF-8. We keep the archetype human-
 * readable on Mantle by sanitizing only at the Casper boundary.
 */
function sanitizeAscii(s: string): string {
  return s
    .replace(/[–—]/g, "-")  // en/em dashes
    .replace(/[‘’]/g, "'")  // curly single quotes
    .replace(/[“”]/g, '"')  // curly double quotes
    .replace(/…/g, "...")        // ellipsis
    // Drop anything else outside printable ASCII (safer than passing bytes
    // the contract may panic on; archetype is descriptive, not load-bearing).
    .replace(/[^\x20-\x7E]/g, "");
}

/**
 * Build a CLList<U8> from a 32-byte 0x-hex string.
 *
 * Odra's `casper_types::bytesrepr::Bytes` parameter type maps to CLType
 * `List(U8)`. CLByteArray(N) is a DIFFERENT CLType (`ByteArray(N)`) and won't
 * deserialize — verified on testnet: passing CLByteArray failed with
 * `User error: 64647`; passing this List<U8> succeeded with 13 effects.
 */
function hexToBytesArg(hex: string): CLValue {
  const s = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (s.length !== 64) {
    throw new Error(`expected 32-byte hex, got ${s.length / 2} bytes`);
  }
  const u8s: CLValue[] = [];
  for (let i = 0; i < 32; i++) {
    u8s.push(CLValue.newCLUint8(parseInt(s.slice(i * 2, i * 2 + 2), 16)));
  }
  return CLValue.newCLList(CLTypeUInt8, u8s);
}

/** Build a CLList<U8> from arbitrary bytes — same CLType as Odra's `Bytes`,
 *  so it deserializes into `Bytes`/`Vec<u8>` args and into the proxy wasm's
 *  `args` parameter (serialized RuntimeArgs). */
function bytesToListArg(bytes: Uint8Array): CLValue {
  const u8s: CLValue[] = new Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    u8s[i] = CLValue.newCLUint8(bytes[i]!);
  }
  return CLValue.newCLList(CLTypeUInt8, u8s);
}

/** Build the RPC client. Uses the public endpoint as primary (no auth, no
 *  quota); falls back to cspr.cloud (with CSPR_CLOUD_TOKEN) if the public
 *  node is unreachable. */
function buildRpcClient(): RpcClient {
  const urls = AGENT_CONFIG.casper.testnet.rpcUrls ?? [AGENT_CONFIG.casper.testnet.rpcUrl];
  const token = process.env.CSPR_CLOUD_TOKEN;
  for (const url of urls) {
    try {
      const handler = new HttpHandler(url);
      // cspr.cloud endpoints need the auth header; the public node doesn't.
      if (url.includes("cspr.cloud") && token) {
        handler.setCustomHeaders({ Authorization: token });
      }
      return new RpcClient(handler);
    } catch {
      continue;
    }
  }
  throw new Error("No reachable Casper RPC endpoint for tx submission");
}

/** Load operator keypair from the configured PEM file.
 *  Defaults to Ed25519 since that's what Casper Wallet produces. Override with
 *  CASPER_OPERATOR_ALGORITHM=secp256k1 for SECP keys. */
function loadOperatorKey(): PrivateKey {
  const path = process.env.CASPER_OPERATOR_PEM;
  if (!path) throw new Error("CASPER_OPERATOR_PEM not set");
  const pem = readFileSync(path, "utf-8");
  const algo =
    process.env.CASPER_OPERATOR_ALGORITHM === "secp256k1"
      ? KeyAlgorithm.SECP256K1
      : KeyAlgorithm.ED25519;
  return PrivateKey.fromPem(pem, algo);
}

/** Resolve the deployed contract hash (env or static config), normalized. */
function getRegistryHash(): string {
  const raw = process.env.CASPER_REGISTRY_HASH ?? AGENT_CONFIG.casper.testnet.registryHash;
  if (!raw || raw.trim() === "") {
    throw new Error("Casper registry hash not configured (deploy first, then set CASPER_REGISTRY_HASH)");
  }
  return raw.trim().startsWith("0x") ? raw.trim().slice(2) : raw.trim();
}

/**
 * Resolve the v2 ConvictionRegistry package hash, or null when not deployed.
 * v2 is a SEPARATE contract package from v1 — the v1 package hash stays in
 * CASPER_REGISTRY_HASH so the historical event feed keeps reading, while
 * CASPER_REGISTRY_V2_HASH gates the claim/epoch entry points. Setting the
 * env var (or config field) is the single switch that turns v2 on.
 */
export function getRegistryV2Hash(): string | null {
  const raw = process.env.CASPER_REGISTRY_V2_HASH ?? AGENT_CONFIG.casper.testnet.registryV2Hash;
  if (!raw || raw.trim() === "") return null;
  return raw.trim().startsWith("0x") ? raw.trim().slice(2) : raw.trim();
}

/**
 * How the adapter spends gas: "records" anchors every conviction record
 * on-chain (current behavior); "epoch" skips per-record writes — records
 * still land in the local epoch ledger and only anchor_epoch_root deploys.
 * Testnet faucet is one-shot, so epoch mode is the sustainable default once
 * v2 is live (and the intended Mainnet shape).
 */
export function getAnchorMode(): "records" | "epoch" {
  const raw = process.env.CASPER_ANCHOR_MODE ?? AGENT_CONFIG.casper.testnet.anchorMode;
  return raw === "epoch" ? "epoch" : "records";
}

// =============================================================================
// Adapter
// =============================================================================

export class CasperAnchorAdapter implements AnchorAdapter {
  readonly name = "casper";

  // Circuit breaker: after 5 consecutive anchor failures, skip Casper for
  // SKIP_AFTER_FAILURES cycles to avoid wasting RPC quota and polluting logs.
  private consecutiveFailures = 0;
  private lastFailureAt = 0;
  private static readonly CIRCUIT_THRESHOLD = 5;
  private static readonly CIRCUIT_COOLDOWN_MS = 30 * 60 * 1000; // 30 min

  // Balance cache so we don't query the operator's main purse on every cycle.
  private balanceCache: { balance: bigint; fetchedAt: number } | null = null;
  private static readonly BALANCE_CACHE_TTL_MS = 5 * 60 * 1000; // 5 min

  // 429 backoff: when the RPC rate-limits the balance check, stop hitting it
  // every cycle and use the cached value instead. Exponential backoff with a
  // cap so a prolonged cspr.cloud outage doesn't silence the balance check
  // for hours. Reset on the first successful query.
  private balanceCheckBackoffUntil = 0;
  private balanceCheckConsecutive429s = 0;
  private static readonly BALANCE_BACKOFF_BASE_MS = 15 * 60 * 1000; // 15 min
  private static readonly BALANCE_BACKOFF_MAX_MS = 4 * 60 * 60 * 1000; // 4h

  isAvailable(): boolean {
    // CSPR_CLOUD_TOKEN is no longer strictly required — the public
    // node.testnet.casper.network endpoint needs no auth. But we still need
    // the operator key + registry hash to do anything useful.
    if (!process.env.CASPER_OPERATOR_PEM) return false;
    if (!process.env.CASPER_REGISTRY_HASH && !AGENT_CONFIG.casper.testnet.registryHash) return false;
    return true;
  }

  private isCircuitOpen(): boolean {
    if (this.consecutiveFailures < CasperAnchorAdapter.CIRCUIT_THRESHOLD) return false;
    const cooledDown = Date.now() - this.lastFailureAt > CasperAnchorAdapter.CIRCUIT_COOLDOWN_MS;
    if (cooledDown) {
      this.consecutiveFailures = 0;
      return false;
    }
    return true;
  }

  /**
   * Query the operator's main-purse balance. Returns 0 if the account doesn't
   * exist or the RPC call fails, so an unfunded key is treated the same as a
   * depleted one. Result is cached for a few minutes to avoid an extra RPC
   * round-trip every cycle.
   *
   * 429 backoff: when the RPC rate-limits us, we stop querying for an
   * exponentially increasing period (15m → 30m → 1h → 2h → 4h cap) and
   * return the last cached balance. This prevents the agent from burning
   * RPC quota on a doomed check every cycle when cspr.cloud is throttling.
   */
  private async checkOperatorBalance(): Promise<{ sufficient: boolean; balance: bigint; minimum: bigint }> {
    const now = Date.now();
    const minimum = BigInt(AGENT_CONFIG.casper.testnet.minOperatorBalanceMotes);

    // Fast path: serve from cache within TTL.
    if (this.balanceCache && now - this.balanceCache.fetchedAt < CasperAnchorAdapter.BALANCE_CACHE_TTL_MS) {
      return { sufficient: this.balanceCache.balance >= minimum, balance: this.balanceCache.balance, minimum };
    }

    // Backoff path: if we're being rate-limited, don't hit the RPC. Use the
    // last cached balance (or 0 if we never got one) and wait out the backoff.
    if (now < this.balanceCheckBackoffUntil) {
      const remaining = Math.round((this.balanceCheckBackoffUntil - now) / 60_000);
      const cached = this.balanceCache?.balance ?? 0n;
      console.log(`  [Casper] Balance check in 429 backoff (${remaining}m remaining) — using cached ${cached.toString()} motes`);
      return { sufficient: cached >= minimum, balance: cached, minimum };
    }

    try {
      const key = loadOperatorKey();
      const token = process.env.CSPR_CLOUD_TOKEN ?? "";
      const res = await rpc("query_balance", {
        purse_identifier: { main_purse_under_public_key: key.publicKey.toHex() },
      }, token);
      const balance = BigInt(res?.balance ?? "0");
      this.balanceCache = { balance, fetchedAt: now };
      // Success — reset the backoff.
      this.balanceCheckConsecutive429s = 0;
      this.balanceCheckBackoffUntil = 0;
      return { sufficient: balance >= minimum, balance, minimum };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Detect rate-limiting (429 or the "access lim" body that cspr.cloud
      // returns when quota is exhausted). Enter backoff so we don't hammer
      // the RPC every cycle.
      const isRateLimit = message.includes("429") || message.includes("access lim");
      if (isRateLimit) {
        this.balanceCheckConsecutive429s += 1;
        const backoffMs = Math.min(
          CasperAnchorAdapter.BALANCE_BACKOFF_BASE_MS * (2 ** (this.balanceCheckConsecutive429s - 1)),
          CasperAnchorAdapter.BALANCE_BACKOFF_MAX_MS,
        );
        this.balanceCheckBackoffUntil = now + backoffMs;
        const backoffMin = Math.round(backoffMs / 60_000);
        console.warn(`  [Casper] Balance check rate-limited — backing off for ${backoffMin}m (attempt #${this.balanceCheckConsecutive429s})`);
      } else {
        console.warn(`  [Casper] Balance check failed: ${message}`);
      }
      const cached = this.balanceCache?.balance ?? 0n;
      return { sufficient: cached >= minimum, balance: cached, minimum };
    }
  }

  async anchor(record: ConvictionRecord): Promise<AnchorResult> {
    // Epoch mode: no per-record on-chain writes. The record still lands in
    // the local epoch ledger (casperV2PostAnchor) and is committed by the
    // daily anchor_epoch_root deploy — one tx per epoch instead of one per
    // record. Skipping here is honest (not a failure): the orchestrator
    // reports "skipped" and the loop continues normally.
    if (getAnchorMode() === "epoch") {
      return {
        adapter: this.name,
        status: "skipped",
        error: "CASPER_ANCHOR_MODE=epoch — per-record anchor off; epoch roots only",
      };
    }
    if (this.isCircuitOpen()) {
      return {
        adapter: this.name,
        status: "skipped",
        error: `Circuit open after ${CasperAnchorAdapter.CIRCUIT_THRESHOLD} consecutive failures; retrying in ${CasperAnchorAdapter.CIRCUIT_COOLDOWN_MS / 60000}m`,
      };
    }

    let key: PrivateKey;
    try {
      key = loadOperatorKey();
    } catch (err) {
      return {
        adapter: this.name,
        status: "failed",
        error: `key load: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    const callerPublicKey: PublicKey = key.publicKey;

    // Verify the operator account can actually pay for the deploy before we
    // build and submit it. This avoids guaranteed "Invalid transaction" errors
    // when the testnet key runs dry and saves RPC quota.
    const balanceCheck = await this.checkOperatorBalance();
    if (!balanceCheck.sufficient) {
      return {
        adapter: this.name,
        status: "skipped",
        error: `Operator balance too low: ${balanceCheck.balance.toString()} motes, need ${balanceCheck.minimum.toString()} motes`,
      };
    }

    let contractHash: string;
    try {
      contractHash = getRegistryHash();
    } catch (err) {
      return {
        adapter: this.name,
        status: "skipped",
        error: err instanceof Error ? err.message : String(err),
      };
    }

    // ── Build runtime args ──
    // Schema mirrors the Odra contract's `anchor_conviction` entry point.
    // Bytes args carry the 32-byte keccak digests verbatim; the contract
    // doesn't recompute them — the same hash means the same thing on every
    // chain the orchestrator publishes to.
    const args = Args.fromMap({
      subject_hash: hexToBytesArg(record.subjectHash),
      thesis_hash: hexToBytesArg(record.thesisHash),
      conviction_score: CLValue.newCLUint8(Math.min(100, Math.max(0, record.convictionScore))),
      archetype: CLValue.newCLString(sanitizeAscii(record.archetype)),
      timestamp: CLValue.newCLUint64(BigInt(record.timestamp)),
    });

    // ── Build the call ──
    let transaction;
    try {
      // byPackageHash resolves to the latest installed contract version
      // under the package — survives in-place upgrades. byHash would expect
      // an entity hash that changes per upgrade.
      transaction = new ContractCallBuilder()
        .from(callerPublicKey)
        .byPackageHash(contractHash)
        .entryPoint("anchor_conviction")
        .runtimeArgs(args)
        .chainName(AGENT_CONFIG.casper.testnet.chainName)
        .payment(Number(AGENT_CONFIG.casper.testnet.paymentMotes))
        .build();
    } catch (err) {
      return {
        adapter: this.name,
        status: "failed",
        error: `build: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    transaction.sign(key);

    // ── Submit + return ──
    try {
      const rpc = buildRpcClient();
      const result = await rpc.putTransaction(transaction);
      // V1 transactions populate transactionV1; legacy deploys populate `deploy`.
      const deployHash = result.transactionHash?.transactionV1?.toHex?.()
        ?? result.transactionHash?.deploy?.toHex?.()
        ?? "";

      this.consecutiveFailures = 0;
      this.lastFailureAt = 0;

      return {
        adapter: this.name,
        // Casper considers a submission "accepted" — confirmation requires
        // polling. We treat acceptance as success; orchestrator + state can
        // surface "pending → confirmed" as a follow-up enhancement.
        status: "success",
        txHash: deployHash,
        explorerUrl: deployHash ? getCasperExplorerTxUrl(deployHash) : undefined,
        // We don't report paymentMotes as gasUsed because unused gas is
        // refunded; the real execution cost is only known after confirmation.
      };
    } catch (err) {
      this.consecutiveFailures += 1;
      this.lastFailureAt = Date.now();
      const raw = typeof (err as { data?: unknown })?.data === "object" && (err as { data?: unknown }).data
        ? JSON.stringify((err as { data?: unknown }).data)
        : "";
      const message = err instanceof Error ? err.message : String(err);
      const detail = raw && raw !== message ? `${message} | data: ${raw}` : message;
      return {
        adapter: this.name,
        status: "failed",
        error: detail,
      };
    }
  }

  // ─── Read methods ─────────────────────────────────────────────────────────
  //
  // The Odra contract emits Casper Event Standard (CES) events on every
  // anchor — these are stored at the `__events` uref under numeric keys.
  // Reading them is free (state queries cost no gas), and we get the full
  // record without paying for entry-point execution.
  //
  // The records are indexed in-memory by subject and thesis hash, with a
  // short TTL so concurrent MCP queries don't hammer the RPC.

  async getSubjectHistory(subjectHash: Bytes32Hex): Promise<AnchoredRecord[]> {
    const records = await this.loadAllAnchored();
    const target = normalizeHex(subjectHash);
    return records.filter((r) => normalizeHex(r.subjectHash) === target);
  }

  async getLatestConviction(subjectHash: Bytes32Hex): Promise<AnchoredRecord | null> {
    const history = await this.getSubjectHistory(subjectHash);
    return history.length > 0 ? history[history.length - 1]! : null;
  }

  async getByThesis(thesisHash: Bytes32Hex): Promise<AnchoredRecord | null> {
    const records = await this.loadAllAnchored();
    const target = normalizeHex(thesisHash);
    return records.find((r) => normalizeHex(r.thesisHash) === target) ?? null;
  }

  private cachedRecords: { records: AnchoredRecord[]; expiresAt: number } | null = null;
  private static readonly READ_CACHE_TTL_MS = 30_000;

  /** Read all anchored records from the contract's event log, cached. */
  private async loadAllAnchored(): Promise<AnchoredRecord[]> {
    const now = Date.now();
    if (this.cachedRecords && this.cachedRecords.expiresAt > now) {
      return this.cachedRecords.records;
    }
    const records = await readAnchoredEvents();
    this.cachedRecords = { records, expiresAt: now + CasperAnchorAdapter.READ_CACHE_TTL_MS };
    return records;
  }
}

// ─── CES event reading ───────────────────────────────────────────────────────
//
// Pure functions outside the adapter so they're testable and the read path
// doesn't depend on the operator key (anonymous reads need only CSPR_CLOUD_TOKEN).

interface ContractEventRefs {
  eventsUref: string;
  eventsLengthUref: string;
}

/** Find the __events and __events_length urefs for our deployed contract. */
async function findContractEventUrefs(): Promise<ContractEventRefs | null> {
  const token = process.env.CSPR_CLOUD_TOKEN ?? "";
  const pkgHex = (process.env.CASPER_REGISTRY_HASH ?? AGENT_CONFIG.casper.testnet.registryHash).replace(/^0x/, "");
  if (!pkgHex) return null;

  // Look up the latest contract entity under the package, then read its named keys.
  const srh = await rpc("chain_get_state_root_hash", {}, token);
  const pkg = await rpc("state_get_item", {
    state_root_hash: srh.state_root_hash,
    key: `hash-${pkgHex}`,
    path: [],
  }, token);
  const entityHash: string | undefined = pkg.stored_value?.ContractPackage?.versions?.[0]?.contract_hash;
  if (!entityHash) return null;

  // The package returns `contract-<64hex>`; state_get_item needs `hash-<64hex>`.
  const entityHex = entityHash.replace(/^contract-/, "").replace(/^hash-/, "");
  const contract = await rpc("state_get_item", {
    state_root_hash: srh.state_root_hash,
    key: `hash-${entityHex}`,
    path: [],
  }, token);
  const namedKeys: Array<{ name: string; key: string }> = contract.stored_value?.Contract?.named_keys ?? [];
  const events = namedKeys.find((k) => k.name === "__events")?.key;
  const eventsLen = namedKeys.find((k) => k.name === "__events_length")?.key;
  if (!events || !eventsLen) return null;
  return { eventsUref: events, eventsLengthUref: eventsLen };
}

async function readAnchoredEvents(): Promise<AnchoredRecord[]> {
  const token = process.env.CSPR_CLOUD_TOKEN ?? "";
  const refs = await findContractEventUrefs();
  if (!refs) return [];

  const srh = (await rpc("chain_get_state_root_hash", {}, token)).state_root_hash;
  // Read total event count.
  const lenItem = await rpc("state_get_item", {
    state_root_hash: srh,
    key: refs.eventsLengthUref,
    path: [],
  }, token);
  const lenHex: string = lenItem.stored_value?.CLValue?.bytes ?? "00000000";
  const totalEvents = readU32LE(hexToUint8(lenHex));

  // Read each event entry from the __events dictionary.
  const out: AnchoredRecord[] = [];
  for (let i = 0; i < totalEvents; i++) {
    try {
      const item = await rpc("state_get_dictionary_item", {
        state_root_hash: srh,
        dictionary_identifier: {
          URef: { seed_uref: refs.eventsUref, dictionary_item_key: String(i) },
        },
      }, token);
      // The stored CLValue is List<U8>. `bytes` carries the wrapped form
      // (4-byte list length + payload); `parsed` is the unwrapped payload as
      // an array of u8 integers. We use `parsed` directly — same as Casper's
      // explorer does — so the decoder operates on the event payload itself.
      const parsed = item.stored_value?.CLValue?.parsed;
      if (!Array.isArray(parsed)) continue;
      const payload = Uint8Array.from(parsed as number[]);
      const decoded = decodeAnchoredEvent(payload);
      if (decoded) out.push(decoded);
    } catch {
      // Skip malformed entries — keep going.
    }
  }
  return out;
}

/** RPC helper with fallback chain — tries each endpoint in order until one
 *  succeeds. The public Casper Association node is primary (no auth, no
 *  quota); cspr.cloud is fallback (needs token, rate-limited). Skips 429
 *  responses and network errors to the next endpoint instead of failing.
 *
 *  We use `any` here because JSON-RPC responses are inherently dynamic; the
 *  call sites narrow as they walk known fields. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function rpc(method: string, params: unknown, token: string): Promise<any> {
  const urls = AGENT_CONFIG.casper.testnet.rpcUrls ?? [AGENT_CONFIG.casper.testnet.rpcUrl];
  let lastErr: Error | null = null;
  for (const url of urls) {
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      // cspr.cloud endpoints need the auth header; the public node doesn't.
      if (url.includes("cspr.cloud") && token) {
        headers.Authorization = token;
      }
      const r = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
      if (r.status === 429) {
        lastErr = new Error(`429 Too Many Requests from ${url}`);
        continue; // try next endpoint
      }
      if (!r.ok) {
        lastErr = new Error(`HTTP ${r.status} from ${url}`);
        continue;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = (await r.json()) as any;
      if (data?.error) throw new Error(data.error.message ?? "rpc error");
      return data?.result ?? {};
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      continue;
    }
  }
  throw lastErr ?? new Error("all Casper RPC endpoints failed");
}

/**
 * Decode a CES-encoded event into an AnchoredRecord if it's a ConvictionAnchored
 * event; return null for OperatorAuthorizationUpdated and other event types.
 *
 * Layout for ConvictionAnchored (matches the Rust #[odra::event] struct):
 *   - String  event_name     (u32 LE length + UTF-8 bytes)
 *   - Bytes   subject_hash   (u32 LE length + bytes)
 *   - Address anchored_by    (1 byte tag + 32 bytes account hash)
 *   - Bytes   thesis_hash    (u32 LE length + bytes)
 *   - u8      conviction_score (1 byte)
 *   - String  archetype      (u32 LE length + UTF-8 bytes)
 *
 * Note: the on-chain event does NOT carry the timestamp field (it's only in
 * the stored ConvictionRecord struct, not the event). For reads, we set
 * timestamp to 0 — callers that need it should query block headers.
 */
function decodeAnchoredEvent(bytes: Uint8Array): AnchoredRecord | null {
  let off = 0;
  const name = readString(bytes, off);
  if (!name) return null;
  off += 4 + name.value.length;
  if (name.value !== "event_ConvictionAnchored") return null;

  const subject = readBytes(bytes, off);
  if (!subject) return null;
  off += 4 + subject.value.length;

  const addr = readAddress(bytes, off);
  if (!addr) return null;
  off += addr.consumed;

  const thesis = readBytes(bytes, off);
  if (!thesis) return null;
  off += 4 + thesis.value.length;

  if (off >= bytes.length) return null;
  const score = bytes[off]!;
  off += 1;

  const archetype = readString(bytes, off);
  if (!archetype) return null;

  return {
    adapter: "casper",
    subjectHash: bytesToHex0x(subject.value),
    thesisHash: bytesToHex0x(thesis.value),
    convictionScore: score,
    archetype: archetype.value,
    timestamp: 0,
    anchoredBy: addr.hex,
    explorerUrl: undefined,
  };
}

// =============================================================================
// Exported helpers — used by the HTTP server for browser-wallet flows
// (balance query, build-anchor, submit-anchor). These keep CSPR_CLOUD_TOKEN
// and the contract config on the server side; the browser only signs.
// =============================================================================

/**
 * Query the CSPR balance (in motes) of any public key via the RPC fallback
 * chain. Returns 0n for unfunded or non-existent accounts. Does NOT require
 * the operator PEM — uses the public node (no auth) or cspr.cloud (with token).
 */
export async function queryBalance(publicKeyHex: string): Promise<bigint> {
  const token = process.env.CSPR_CLOUD_TOKEN ?? "";
  try {
    const res = await rpc("query_balance", {
      purse_identifier: { main_purse_under_public_key: publicKeyHex },
    }, token);
    return BigInt(res?.balance ?? "0");
  } catch {
    // Account doesn't exist yet on-chain → balance is 0.
    return 0n;
  }
}

/**
 * Build an unsigned anchor_conviction Transaction for a given caller's public
 * key. The server builds it (it has the contract hash + chain config); the
 * browser signs it with the Casper Wallet extension. Returns the transaction
 * as JSON (what the wallet's `sign()` method expects).
 */
export function buildAnchorTransaction(
  record: ConvictionRecord,
  callerPublicKeyHex: string,
): unknown {
  const contractHash = getRegistryHash();
  const callerPublicKey = PublicKey.fromHex(callerPublicKeyHex);

  const args = Args.fromMap({
    subject_hash: hexToBytesArg(record.subjectHash),
    thesis_hash: hexToBytesArg(record.thesisHash),
    conviction_score: CLValue.newCLUint8(Math.min(100, Math.max(0, record.convictionScore))),
    archetype: CLValue.newCLString(sanitizeAscii(record.archetype)),
    timestamp: CLValue.newCLUint64(BigInt(record.timestamp)),
  });

  const transaction = new ContractCallBuilder()
    .from(callerPublicKey)
    .byPackageHash(contractHash)
    .entryPoint("anchor_conviction")
    .runtimeArgs(args)
    .chainName(AGENT_CONFIG.casper.testnet.chainName)
    .payment(Number(AGENT_CONFIG.casper.testnet.paymentMotes))
    .build();

  return transaction.toJSON();
}

/**
 * Reconstruct a Transaction from JSON, attach a wallet-provided signature,
 * and submit it to the Casper Testnet RPC. Returns the deploy/transaction hash.
 */
export async function submitSignedTransaction(
  transactionJson: unknown,
  signatureHex: string,
  signerPublicKeyHex: string,
): Promise<{ txHash: string; explorerUrl: string }> {
  const transaction = Transaction.fromJSON(transactionJson);
  const sigBytes = hexToUint8(signatureHex);
  const pubKey = PublicKey.fromHex(signerPublicKeyHex);
  transaction.setSignature(sigBytes, pubKey);

  const client = buildRpcClient();
  const result = await client.putTransaction(transaction);
  const txHash = result.transactionHash?.transactionV1?.toHex?.()
    ?? result.transactionHash?.deploy?.toHex?.()
    ?? "";
  if (!txHash) throw new Error("RPC accepted the transaction but returned no hash");
  return { txHash, explorerUrl: getCasperExplorerTxUrl(txHash) };
}

// ─── Byte primitives ─────────────────────────────────────────────────────────

function readU32LE(bytes: Uint8Array, offset = 0): number {
  return (bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16) | (bytes[offset + 3]! << 24)) >>> 0;
}

function readBytes(buf: Uint8Array, offset: number): { value: Uint8Array } | null {
  if (offset + 4 > buf.length) return null;
  const len = readU32LE(buf, offset);
  if (offset + 4 + len > buf.length) return null;
  return { value: buf.subarray(offset + 4, offset + 4 + len) };
}

function readString(buf: Uint8Array, offset: number): { value: string } | null {
  const b = readBytes(buf, offset);
  if (!b) return null;
  return { value: new TextDecoder().decode(b.value) };
}

/** Casper Address: 1-byte variant tag + 32-byte hash. */
function readAddress(buf: Uint8Array, offset: number): { hex: string; consumed: number } | null {
  if (offset + 33 > buf.length) return null;
  const tag = buf[offset]!;
  const hash = buf.subarray(offset + 1, offset + 33);
  return { hex: `${tag.toString(16).padStart(2, "0")}${bytesToHex(hash)}`, consumed: 33 };
}

function hexToUint8(hex: string): Uint8Array {
  const s = hex.startsWith("0x") ? hex.slice(2) : hex;
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += bytes[i]!.toString(16).padStart(2, "0");
  return out;
}

function bytesToHex0x(bytes: Uint8Array): Bytes32Hex {
  return `0x${bytesToHex(bytes)}` as Bytes32Hex;
}

function normalizeHex(hex: string): string {
  return hex.toLowerCase().replace(/^0x/, "");
}

// =============================================================================
// ConvictionRegistry v2 — claim lifecycle + epoch roots
// =============================================================================
//
// v2 is a separate contract package (CASPER_REGISTRY_V2_HASH). Every v2 write
// goes through `callV2EntryPoint`, which picks the submission shape:
//
//   - attached = 0 motes → plain ContractCallBuilder (works when the contract's
//     claim_fee is 0 — set via `set_config` post-deploy).
//   - attached > 0 → session-wasm deploy of Odra's proxy_caller_with_return
//     (vendored at casper/resources/). On VM-Casper-v1 there is no
//     `transferred_value` field — payable entry points take a hidden
//     `cargo_purse` URef holding the motes, and only session code can create
//     the purse. The proxy creates it, funds it with `amount` from the
//     caller's main purse, then call_versioned_contract's the entry point
//     with `cargo_purse` injected.

export const CLAIM_TYPES = {
  GENERIC: 0,
  PRICE_THESIS: 1,
  ATTESTATION: 2,
  RISK_ASSESSMENT: 3,
} as const;
export type ClaimType = (typeof CLAIM_TYPES)[keyof typeof CLAIM_TYPES];

export const CLAIM_OUTCOMES = {
  UNRESOLVED: 0,
  VALIDATED: 1,
  INVALIDATED: 2,
  MIXED: 3,
  EXPIRED: 4,
} as const;
export type ClaimOutcome = (typeof CLAIM_OUTCOMES)[keyof typeof CLAIM_OUTCOMES];

export interface V2ClaimAnchorParams {
  subjectHash: Bytes32Hex;
  claimHash: Bytes32Hex;
  claimType: ClaimType;
  /** Free-form domain tag, e.g. "crypto-trading". Stored on-chain. */
  domain: string;
  /** 0–100 stated confidence. */
  confidence: number;
  /** ms since epoch; 0 = no resolution horizon. */
  expiresAtMs: number;
  /** Evidence digest binding the claim to its off-chain analysis. */
  evidenceHash: Bytes32Hex;
  timestampMs: number;
}

let proxyWasmCache: Uint8Array | null = null;

/** Load Odra's proxy_caller_with_return.wasm — vendored from
 *  odra-casper-rpc-client 2.8.1 (Apache-2.0). Required for payable calls. */
function loadProxyWasm(): Uint8Array {
  if (proxyWasmCache) return proxyWasmCache;
  const dir = dirname(fileURLToPath(import.meta.url));
  const path = join(dir, "..", "..", "..", "casper", "resources", "proxy_caller_with_return.wasm");
  proxyWasmCache = new Uint8Array(readFileSync(path));
  return proxyWasmCache;
}

/**
 * Submit one entry-point call to the v2 registry package. Returns the deploy
 * hash. Throws on submission failure — callers decide how to surface it.
 *
 * `attachedMotes` is the value that lands in the contract's `cargo_purse`:
 * for `anchor_claim` that's fee + bond; for `dispute_claim` the counter-bond.
 * Zero means a plain contract call (no proxy wasm needed).
 */
async function callV2EntryPoint(
  entryPoint: string,
  args: InstanceType<typeof Args>,
  attachedMotes = 0n,
): Promise<string> {
  const contractHash = getRegistryV2Hash();
  if (!contractHash) throw new Error("CASPER_REGISTRY_V2_HASH not configured");

  const key = loadOperatorKey();
  let transaction;
  if (attachedMotes === 0n) {
    transaction = new ContractCallBuilder()
      .from(key.publicKey)
      .byPackageHash(contractHash)
      .entryPoint(entryPoint)
      .runtimeArgs(args)
      .chainName(AGENT_CONFIG.casper.testnet.chainName)
      .payment(Number(AGENT_CONFIG.casper.testnet.paymentMotes))
      .build();
  } else {
    // Proxy-wasm session deploy — the caller's main purse funds a fresh
    // cargo purse holding `attachedMotes`, which the contract then takes
    // via handle_attached_value(). package_hash is ContractPackageHash
    // (CL ByteArray(32)); `args` is the bytesrepr-serialized RuntimeArgs
    // of the real call, passed as List<U8>.
    const pkgBytes = hexToUint8(contractHash);
    const proxyArgs = Args.fromMap({
      package_hash: CLValue.newCLByteArray(pkgBytes),
      entry_point: CLValue.newCLString(entryPoint),
      args: bytesToListArg(args.toBytes()),
      attached_value: CLValue.newCLUInt512(attachedMotes),
      amount: CLValue.newCLUInt512(attachedMotes),
    });
    transaction = new SessionBuilder()
      .from(key.publicKey)
      .wasm(loadProxyWasm())
      .runtimeArgs(proxyArgs)
      .chainName(AGENT_CONFIG.casper.testnet.chainName)
      .payment(Number(AGENT_CONFIG.casper.testnet.paymentMotes))
      .build();
  }

  transaction.sign(key);
  const client = buildRpcClient();
  const result = await client.putTransaction(transaction);
  const deployHash = result.transactionHash?.transactionV1?.toHex?.()
    ?? result.transactionHash?.deploy?.toHex?.()
    ?? "";
  if (!deployHash) throw new Error("RPC accepted the transaction but returned no hash");
  return deployHash;
}

/** register_agent(subject_hash, name, endpoint, domain_tags) — registers or
 *  (when called by the same owner) updates an agent profile. */
export async function v2RegisterAgent(
  subjectHash: Bytes32Hex,
  name: string,
  endpoint: string,
  domainTags: string,
): Promise<string> {
  const args = Args.fromMap({
    subject_hash: hexToBytesArg(subjectHash),
    name: CLValue.newCLString(sanitizeAscii(name)),
    endpoint: CLValue.newCLString(sanitizeAscii(endpoint)),
    domain_tags: CLValue.newCLString(sanitizeAscii(domainTags)),
  });
  return callV2EntryPoint("register_agent", args);
}

/** anchor_claim(...) — `attachedMotes` = claim fee + bond. */
export async function v2AnchorClaim(params: V2ClaimAnchorParams, attachedMotes = 0n): Promise<string> {
  const args = Args.fromMap({
    subject_hash: hexToBytesArg(params.subjectHash),
    claim_hash: hexToBytesArg(params.claimHash),
    claim_type: CLValue.newCLUint8(params.claimType),
    domain: CLValue.newCLString(sanitizeAscii(params.domain)),
    confidence: CLValue.newCLUint8(Math.min(100, Math.max(0, params.confidence))),
    expires_at: CLValue.newCLUint64(BigInt(Math.floor(params.expiresAtMs))),
    evidence_hash: hexToBytesArg(params.evidenceHash),
    timestamp: CLValue.newCLUint64(BigInt(Math.floor(params.timestampMs))),
  });
  return callV2EntryPoint("anchor_claim", args, attachedMotes);
}

/** resolve_claim(claim_hash, outcome, resolution_hash) — proposes an outcome;
 *  the dispute window opens from the chain's block time at execution. */
export async function v2ResolveClaim(
  claimHash: Bytes32Hex,
  outcome: ClaimOutcome,
  resolutionHash: Bytes32Hex,
): Promise<string> {
  const args = Args.fromMap({
    claim_hash: hexToBytesArg(claimHash),
    outcome: CLValue.newCLUint8(outcome),
    resolution_hash: hexToBytesArg(resolutionHash),
  });
  return callV2EntryPoint("resolve_claim", args);
}

/** dispute_claim(claim_hash) — payable; counterBondMotes must cover
 *  max(claim.bond, 1 CSPR). */
export async function v2DisputeClaim(claimHash: Bytes32Hex, counterBondMotes: bigint): Promise<string> {
  const args = Args.fromMap({ claim_hash: hexToBytesArg(claimHash) });
  return callV2EntryPoint("dispute_claim", args, counterBondMotes);
}

/** finalize_resolution(claim_hash) — settles bonds after the dispute window. */
export async function v2FinalizeResolution(claimHash: Bytes32Hex): Promise<string> {
  const args = Args.fromMap({ claim_hash: hexToBytesArg(claimHash) });
  return callV2EntryPoint("finalize_resolution", args);
}

/** anchor_epoch_root(epoch_id, merkle_root, record_count) — one tx commits to
 *  an entire epoch of off-chain ledger records. */
export async function v2AnchorEpochRoot(
  epochId: number,
  merkleRootHex: string,
  recordCount: number,
): Promise<string> {
  const args = Args.fromMap({
    epoch_id: CLValue.newCLUint64(BigInt(epochId)),
    merkle_root: bytesToListArg(hexToUint8(merkleRootHex)),
    record_count: CLValue.newCLUint64(BigInt(recordCount)),
  });
  return callV2EntryPoint("anchor_epoch_root", args);
}
