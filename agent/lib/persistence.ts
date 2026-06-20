/**
 * Agent Persistence Module
 *
 * Provides persistent storage for the agent's state, guardrail state,
 * and trade history using Inngest/SQLite-Sync (on Pinata) or a simple
 * local JSON file fallback for development.
 *
 * The Pinata `@pinata/sqlite-sync` skill (declared in manifest.json)
 * provides synchronized SQLite storage across agent restarts. In local
 * dev, we fall back to a JSON file at AGENT_DATA_DIR/state.json.
 *
 * Environment variables:\n *   AGENT_DATA_DIR  — Directory for persistent state files (default: ./data)\n *   PINATA_SQLITE   — Set to \"1\" when running on Pinata (uses SQLite Sync API)\n */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentServerState } from "../src/server.js";
import type { GuardrailStatus } from "./risk-guardrails.js";

// =============================================================================
// Types
// =============================================================================

export interface PersistentState {
  /** Agent server state for crash recovery */
  agent: Partial<AgentServerState> | null;
  /** Guardrail cumulative state */
  guardrails: {
    peakValueUsd: number;
    totalTradesExecuted: number;
    totalVolumeUsd: number;
    lastTradeAt: number | null;
  } | null;
  /** Last persisted timestamp */
  lastPersistedAt: number | null;
  /** Agent config fingerprint (to detect config changes between restarts) */
  configHash: string | null;
}

// =============================================================================
// Path Resolution
// =============================================================================

/** Get the data directory, creating it if needed. */
function getDataDir(): string {
  // Use AGENT_DATA_DIR env var, or default to <cwd>/data for predictability
  // across dev (tsx) and production (compiled JS).
  const dir = process.env.AGENT_DATA_DIR || join(process.cwd(), "data");
  if (!existsSync(dir)) {
    try {
      mkdirSync(dir, { recursive: true });
    } catch {
      // If we can't create the directory, fall back to a temp location
      return join(process.env.TMPDIR || "/tmp", "enw-agent-data");
    }
  }
  return dir;
}

// =============================================================================
// JSON File Persistence (local dev fallback)
// =============================================================================

const STATE_FILE = "state.json";

function getStatePath(): string {
  return join(getDataDir(), STATE_FILE);
}

function loadFromJson(): PersistentState {
  try {
    const path = getStatePath();
    if (!existsSync(path)) return createEmptyState();
    const raw = readFileSync(path, "utf-8");
    return JSON.parse(raw) as PersistentState;
  } catch {
    return createEmptyState();
  }
}

function saveToJson(state: PersistentState): void {
  try {
    const path = getStatePath();
    writeFileSync(path, JSON.stringify(state, null, 2), "utf-8");
  } catch (err) {
    console.warn("[persistence] Failed to write state file:", (err as Error)?.message || String(err));
  }
}

function createEmptyState(): PersistentState {
  return {
    agent: null,
    guardrails: null,
    lastPersistedAt: null,
    configHash: null,
  };
}

// =============================================================================
// Pinata SQLite Sync (production — used when PINATA_SQLITE=1)
// =============================================================================

/**
 * Write state via the Pinata SQLite Sync API.
 * This is a no-op in local dev — the JSON file is used instead.
 */
async function saveToSqliteSync(state: PersistentState): Promise<void> {
  if (process.env.PINATA_SQLITE !== "1") return;

  try {
    // On Pinata, we use fetch to call the SQLite Sync internal API.
    // The @pinata/sqlite-sync skill provides this endpoint.
    const payload = {
      table: "agent_state",
      key: "persistent_state",
      value: JSON.stringify(state),
    };

    const res = await fetch("http://localhost:3001/api/sqlite/upsert", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      console.warn(`[persistence] SQLite Sync write failed: ${res.status}`);
    }
  } catch (err) {
    console.warn("[persistence] SQLite Sync unavailable:", (err as Error)?.message || String(err));
  }
}

/**
 * Load state from Pinata SQLite Sync.
 */
async function loadFromSqliteSync(): Promise<PersistentState | null> {
  if (process.env.PINATA_SQLITE !== "1") return null;

  try {
    const res = await fetch(
      "http://localhost:3001/api/sqlite/get?table=agent_state&key=persistent_state"
    );

    if (!res.ok) return null;

    const data = (await res.json()) as { value?: string } | null;

    if (data?.value) {
      return JSON.parse(data.value) as PersistentState;
    }
    return null;
  } catch {
    return null;
  }
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Save agent and guardrail state persistently.
 * Called after each cycle completes.
 */
export async function persistState(params: {
  agentState: Partial<AgentServerState>;
  guardrails: {
    peakValueUsd: number;
    totalTradesExecuted: number;
    totalVolumeUsd: number;
    lastTradeAt: number | null;
  };
  configHash: string;
}): Promise<void> {
  const state: PersistentState = {
    agent: params.agentState,
    guardrails: params.guardrails,
    lastPersistedAt: Date.now(),
    configHash: params.configHash,
  };

  // Write to local JSON file (always available)
  saveToJson(state);

  // Write to SQLite Sync if on Pinata
  await saveToSqliteSync(state);
}

/**
 * Load the most recent persistent state.
 * Tries SQLite Sync first (Pinata), falls back to JSON file (local dev).
 */
export async function loadPersistentState(): Promise<PersistentState | null> {
  // Try SQLite Sync first (Pinata production)
  if (process.env.PINATA_SQLITE === "1") {
    const sqliteState = await loadFromSqliteSync();
    if (sqliteState) return sqliteState;
  }

  // Fall back to local JSON file
  return loadFromJson();
}

/**
 * Clear all persisted state (used on agent reset).
 */
export async function clearPersistentState(): Promise<void> {
  saveToJson(createEmptyState());

  if (process.env.PINATA_SQLITE === "1") {
    try {
      await fetch("http://localhost:3001/api/sqlite/delete?table=agent_state&key=persistent_state", {
        method: "DELETE",
      });
    } catch { /* ignore */ }
  }
}

/**
 * Export loadFromJson for testing.
 */
export { loadFromJson, saveToJson, getStatePath };
