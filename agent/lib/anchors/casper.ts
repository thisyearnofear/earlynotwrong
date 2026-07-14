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
  RpcClient,
} = casperSdk;
type CLValue = CLValueT;
type PrivateKey = PrivateKeyT;
type PublicKey = PublicKeyT;
type RpcClient = RpcClientT;
import { readFileSync } from "node:fs";
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

/** Build the RPC client with the cspr.cloud auth header. */
function buildRpcClient(): RpcClient {
  const token = process.env.CSPR_CLOUD_TOKEN;
  if (!token) throw new Error("CSPR_CLOUD_TOKEN not set");
  const handler = new HttpHandler(AGENT_CONFIG.casper.testnet.rpcUrl);
  handler.setCustomHeaders({ Authorization: token });
  return new RpcClient(handler);
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

  isAvailable(): boolean {
    if (!process.env.CSPR_CLOUD_TOKEN) return false;
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
   */
  private async checkOperatorBalance(): Promise<{ sufficient: boolean; balance: bigint; minimum: bigint }> {
    const now = Date.now();
    const minimum = BigInt(AGENT_CONFIG.casper.testnet.minOperatorBalanceMotes);
    if (this.balanceCache && now - this.balanceCache.fetchedAt < CasperAnchorAdapter.BALANCE_CACHE_TTL_MS) {
      return { sufficient: this.balanceCache.balance >= minimum, balance: this.balanceCache.balance, minimum };
    }
    try {
      const key = loadOperatorKey();
      const token = process.env.CSPR_CLOUD_TOKEN!;
      const res = await rpc("query_balance", {
        purse_identifier: { main_purse_under_public_key: key.publicKey.toHex() },
      }, token);
      const balance = BigInt(res?.balance ?? "0");
      this.balanceCache = { balance, fetchedAt: now };
      return { sufficient: balance >= minimum, balance, minimum };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[Casper] Balance check failed: ${message}`);
      return { sufficient: false, balance: 0n, minimum };
    }
  }

  async anchor(record: ConvictionRecord): Promise<AnchorResult> {
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
  const token = process.env.CSPR_CLOUD_TOKEN;
  const pkgHex = (process.env.CASPER_REGISTRY_HASH ?? AGENT_CONFIG.casper.testnet.registryHash).replace(/^0x/, "");
  if (!token || !pkgHex) return null;

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
  const token = process.env.CSPR_CLOUD_TOKEN;
  if (!token) return [];
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

/** RPC helper — never throws on jsonrpc errors, returns the loose result envelope.
 *  We use `any` here because JSON-RPC responses are inherently dynamic; the
 *  call sites narrow as they walk known fields. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function rpc(method: string, params: unknown, token: string): Promise<any> {
  const r = await fetch(AGENT_CONFIG.casper.testnet.rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: token },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = (await r.json()) as any;
  if (data?.error) throw new Error(data.error.message ?? "rpc error");
  return data?.result ?? {};
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
