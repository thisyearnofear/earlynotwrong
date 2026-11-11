/**
 * RYO-CHAN practice-trading agent — Track 1 (Autonomous Agents).
 *
 * One cycle:
 *   1. scan_market         → candidate universe
 *   2. market_overview     → regime context
 *   3. analyze_token       → per-candidate evidence
 *   4. check_safety        → hard veto gate
 *   5. compare_tokens      → head-to-head on the top 2
 *   6. score + decide      → conviction-driven BUY / HOLD / EXIT / SKIP
 *   7. append to hash-chained reasoning ledger (practice trades only — no real funds)
 *
 * "Early, not wrong" ported to RYO data: buy contrarian setups with verified
 * safety, hold through ordinary drawdown, exit when the thesis breaks.
 */
import { RyoClient, type ToolResult } from './client.ts';
import { record, loadState, saveState, sha256, type PaperPosition } from './ledger.ts';

// ---------- generic evidence extraction (RYO payloads are documented loosely) ----------

function num(obj: unknown, ...keys: string[]): number | undefined {
  if (obj == null || typeof obj !== 'object') return undefined;
  const stack: unknown[] = [obj];
  while (stack.length) {
    const cur = stack.pop();
    if (cur && typeof cur === 'object' && !Array.isArray(cur)) {
      for (const [k, v] of Object.entries(cur as Record<string, unknown>)) {
        if (keys.some((k2) => k.toLowerCase().includes(k2)) && typeof v === 'number' && Number.isFinite(v)) return v;
        if (v && typeof v === 'object') stack.push(v);
      }
    }
  }
  return undefined;
}

function tokens(obj: unknown): string[] {
  const out = new Set<string>();
  const stack: unknown[] = [obj];
  while (stack.length) {
    const cur = stack.pop();
    if (Array.isArray(cur)) {
      for (const v of cur) {
        if (v && typeof v === 'object') {
          const s = (v as Record<string, unknown>).symbol ?? (v as Record<string, unknown>).ticker;
          if (typeof s === 'string' && s.length <= 12) out.add(s.toUpperCase());
          stack.push(v);
        }
      }
    } else if (cur && typeof cur === 'object') stack.push(...Object.values(cur as Record<string, unknown>));
  }
  return [...out].filter((s) => !/^(USD|USDT|USDC|BNB)$/.test(s)).slice(0, 12);
}

function digest(r: ToolResult): string {
  return `${r.tool}:${r.transport}:${sha256(JSON.stringify(r.data)).slice(0, 12)}`;
}

// ---------- conviction scoring (0–100) ----------

export interface Conviction {
  score: number;
  factors: Record<string, number>;
  notes: string[];
}

export function scoreCandidate(analysis: unknown, safety: unknown, overview: unknown): Conviction {
  const f: Record<string, number> = {};
  const notes: string[] = [];

  // Contrarian (30): down 7d/24h during fear is the entry, not the exit.
  const chg7d = num(analysis, '7d', 'percent_change_7d', 'change_7d') ?? 0;
  f.contrarian = chg7d < 0 ? Math.min(30, Math.abs(chg7d) * 1.5) : Math.max(0, 10 - chg7d * 0.5);
  if (chg7d < -10) notes.push(`down ${chg7d.toFixed(1)}% over 7d — contrarian window`);

  // Quality (20): market cap + liquidity.
  const mcap = num(analysis, 'market_cap', 'mcap') ?? 0;
  const liq = num(analysis, 'liquidity', 'volume_24h', 'volume') ?? 0;
  f.quality = mcap > 0 ? Math.min(12, Math.log10(Math.max(mcap, 1)) * 1.5) : 4;
  f.quality += liq > 0 ? Math.min(8, Math.log10(Math.max(liq, 1))) : 2;

  // Timing (10): 24h stabilization after a drop.
  const chg24h = num(analysis, '24h', 'percent_change_24h', 'change_24h') ?? 0;
  f.timing = chg24h > -3 && chg24h < 8 ? 10 : chg24h >= 8 ? 4 : 2;
  if (chg24h >= 8) notes.push(`+${chg24h.toFixed(1)}% 24h — chasing, timing penalty`);

  // Regime (20): market fear level.
  const fear = num(overview, 'fear', 'greed', 'sentiment') ?? 50;
  f.regime = fear <= 30 ? 20 : fear <= 50 ? 14 : fear <= 70 ? 8 : 4;
  if (fear <= 30) notes.push(`fear regime (${fear}) — asymmetry favors buyers`);

  // Safety (up to +10, hard gate below).
  const safeScore = num(safety, 'score', 'safety_score', 'risk');
  const honeypot = JSON.stringify(safety).toLowerCase().includes('honeypot');
  f.safety = honeypot ? 0 : safeScore != null ? Math.min(10, Math.max(0, safeScore / 10)) : 5;
  if (honeypot) notes.push('honeypot flag — hard veto');

  return { score: Math.round(Object.values(f).reduce((a, b) => a + b, 0)), factors: f, notes };
}

const ENTRY_MIN_CONVICTION = 55;
const EXIT_INVALIDATION_PCT = -35;
const TAKE_PROFIT_PCT = 50;
const TRAIL_GIVEBACK_PCT = 30;

// ---------- one agent cycle ----------

export async function runCycle(client: RyoClient): Promise<void> {
  const state = loadState();
  state.cycle += 1;
  const cycle = state.cycle;
  const evidence: Record<string, unknown> = {};

  console.log(`\n=== cycle ${cycle} — ${new Date().toISOString()} ===`);

  const scan = await client.tool('scan_market');
  const overview = await client.tool('market_overview');
  evidence.scan = digest(scan);
  evidence.overview = digest(overview);
  if (!scan.ok) {
    console.log(`scan_market failed: ${scan.error} — recording SKIP to keep the trail honest`);
    record(cycle, '-', 'SKIP', 0, `market scan unavailable: ${scan.error}`, evidence);
    saveState(state);
    return;
  }

  const candidates = tokens(scan.data);
  console.log(`candidates: ${candidates.join(', ') || '(none)'}`);

  // Manage open paper positions first.
  for (const pos of [...state.positions]) {
    const a = await client.tool('analyze_token', { symbol: pos.symbol });
    const px = num(a.data, 'price_usd', 'price', 'usd') ?? pos.entryPriceUsd;
    pos.peakPriceUsd = Math.max(pos.peakPriceUsd, px);
    const pnl = ((px - pos.entryPriceUsd) / pos.entryPriceUsd) * 100;
    const giveback = ((px - pos.peakPriceUsd) / pos.peakPriceUsd) * 100;
    let action: 'HOLD' | 'EXIT' = 'HOLD';
    let reason = `pnl ${pnl.toFixed(1)}% — thesis intact`;
    if (pnl <= EXIT_INVALIDATION_PCT) { action = 'EXIT'; reason = `pnl ${pnl.toFixed(1)}% — thesis invalidated`; }
    else if (giveback <= -TRAIL_GIVEBACK_PCT && pnl > TAKE_PROFIT_PCT) { action = 'EXIT'; reason = `trailed ${giveback.toFixed(1)}% from peak after +${pnl.toFixed(0)}% — locking asymmetry`; }
    const entry = record(cycle, pos.symbol, action, 0, reason, { ...evidence, analyze: digest(a) }, { priceUsd: px });
    console.log(`  ${pos.symbol}: ${action} (${reason})`);
    if (action === 'EXIT') {
      state.cashUsd += pos.sizeUsd * (1 + pnl / 100);
      state.positions = state.positions.filter((p) => p.symbol !== pos.symbol);
    }
    void entry;
  }

  // Score candidates.
  const scored: { symbol: string; c: Conviction; ev: Record<string, string> }[] = [];
  for (const symbol of candidates) {
    if (state.positions.some((p) => p.symbol === symbol)) continue;
    const [a, s] = await Promise.all([
      client.tool('analyze_token', { symbol }),
      client.tool('check_safety', { symbol }),
    ]);
    const c = scoreCandidate(a.data, s.data, overview.data);
    scored.push({ symbol, c, ev: { analyze: digest(a), safety: digest(s) } });
    console.log(`  ${symbol}: conviction ${c.score} ${JSON.stringify(c.factors)}`);
  }
  scored.sort((x, y) => y.c.score - x.c.score);

  // Head-to-head check on the top 2 before committing.
  if (scored.length >= 2) {
    const cmp = await client.tool('compare_tokens', { symbols: [scored[0].symbol, scored[1].symbol] });
    evidence.compare = digest(cmp);
  }

  const top = scored[0];
  if (top && top.c.score >= ENTRY_MIN_CONVICTION && state.positions.length < 3) {
    const sizeUsd = Math.min(state.cashUsd * 0.15, 1500);
    if (sizeUsd >= 10) {
      const deep = await client.tool('deep_analysis', { symbol: top.symbol });
      const px = num(deep.data, 'price_usd', 'price', 'usd') ?? 0;
      const reason = `conviction ${top.c.score} ≥ ${ENTRY_MIN_CONVICTION}; ${top.c.notes.join('; ') || 'factors aligned'}`;
      record(cycle, top.symbol, 'BUY', top.c.score, reason, { ...evidence, ...top.ev, deep: digest(deep) }, { sizeUsd, priceUsd: px });
      const pos: PaperPosition = { symbol: top.symbol, entryPriceUsd: px || 1, sizeUsd, openedAt: new Date().toISOString(), peakPriceUsd: px || 1 };
      state.positions.push(pos);
      state.cashUsd -= sizeUsd;
      console.log(`  BUY ${top.symbol} $${sizeUsd.toFixed(0)} — ${reason}`);
    }
  } else if (top) {
    record(cycle, top.symbol, 'SKIP', top.c.score, `conviction ${top.c.score} below entry threshold ${ENTRY_MIN_CONVICTION}`, { ...evidence, ...top.ev });
    console.log(`  SKIP — best conviction ${top.c.score} < ${ENTRY_MIN_CONVICTION}`);
  }

  saveState(state);
  console.log(`state: cash $${state.cashUsd.toFixed(0)}, positions ${state.positions.map((p) => p.symbol).join(', ') || 'none'}`);
}
