import { writeFileSync } from "node:fs";
import { db } from "./db";

/**
 * A reward window in one file. Every keeper's gold is read from the
 * database, the pot for the window is split by gold share, and the result
 * is written as the leaves a Merkle tree is built from before
 * `RewardPot.openWindow` is called.
 *
 *   npx tsx src/snapshot.ts <pot_amount_wei> [out.json]
 *
 * The gold itself is NOT taken here. Taking gold is the last step, done
 * once the window is open on chain, so nobody loses gold to a window that
 * never opened. See contracts/README.md for the full order of operations.
 */

const [, , potArg, outArg] = process.argv;
if (!potArg) {
  console.error("usage: tsx src/snapshot.ts <pot_amount_wei> [out.json]");
  process.exit(1);
}
const pot = BigInt(potArg);
const rows = db.prepare("SELECT id, name, gold FROM keepers WHERE gold > 0 ORDER BY gold DESC").all() as Array<{
  id: string;
  name: string;
  gold: number;
}>;
const totalGold = rows.reduce((s, r) => s + BigInt(r.gold), 0n);
const leaves = rows.map((r) => ({
  address: r.id,
  name: r.name,
  gold: r.gold,
  amount: totalGold === 0n ? "0" : ((pot * BigInt(r.gold)) / totalGold).toString(),
}));
const out = {
  at: new Date().toISOString(),
  pot: pot.toString(),
  totalGold: totalGold.toString(),
  keepers: leaves.length,
  leaves,
};
const file = outArg ?? `./data/window-${Date.now()}.json`;
writeFileSync(file, JSON.stringify(out, null, 2));
console.log(`wrote ${file}: ${leaves.length} keepers, ${totalGold} gold hundredths, pot ${pot}`);
