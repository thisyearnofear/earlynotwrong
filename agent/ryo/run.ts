/**
 * RYO-CHAN practice agent runner.
 *
 *   RYO_MCP_KEY=ryo_mcp_... npx tsx agent/ryo/run.ts            # one cycle
 *   RYO_MCP_KEY=... npx tsx agent/ryo/run.ts --cycles 5 --interval 60
 *   npx tsx agent/ryo/run.ts --verify                           # audit the ledger chain
 */
import { RyoClient } from './client.ts';
import { runCycle } from './agent.ts';
import { verifyChain, LEDGER_PATH } from './ledger.ts';

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const opt = (name: string, dflt: number) => {
  const i = args.indexOf(name);
  return i >= 0 ? Number(args[i + 1]) : dflt;
};

if (flag('--verify')) {
  const r = verifyChain();
  console.log(`${LEDGER_PATH}: ${r.entries} entries — chain ${r.ok ? 'INTACT' : `BROKEN at entry ${r.brokenAt}`}`);
  process.exit(r.ok ? 0 : 1);
}

const cycles = opt('--cycles', 1);
const intervalSec = opt('--interval', 60);
const client = new RyoClient();

for (let i = 0; i < cycles; i++) {
  try {
    await runCycle(client);
  } catch (e) {
    console.error('cycle error:', e);
  }
  if (i < cycles - 1) await new Promise((r) => setTimeout(r, intervalSec * 1000));
}
console.log(`\ndone — ledger at ${LEDGER_PATH} (--verify to audit)`);
