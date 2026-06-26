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
import { getCasperExplorerTxUrl } from "../explorers.js";
import type { AnchorAdapter, AnchorResult, ConvictionRecord } from "./types.js";

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

  isAvailable(): boolean {
    if (!process.env.CSPR_CLOUD_TOKEN) return false;
    if (!process.env.CASPER_OPERATOR_PEM) return false;
    if (!process.env.CASPER_REGISTRY_HASH && !AGENT_CONFIG.casper.testnet.registryHash) return false;
    return true;
  }

  async anchor(record: ConvictionRecord): Promise<AnchorResult> {
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

      return {
        adapter: this.name,
        // Casper considers a submission "accepted" — confirmation requires
        // polling. We treat acceptance as success; orchestrator + state can
        // surface "pending → confirmed" as a follow-up enhancement.
        status: "success",
        txHash: deployHash,
        explorerUrl: deployHash ? getCasperExplorerTxUrl(deployHash) : undefined,
        gasUsed: AGENT_CONFIG.casper.testnet.paymentMotes,
      };
    } catch (err) {
      return {
        adapter: this.name,
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
