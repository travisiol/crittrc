/**
 * The loot tables.
 *
 * These are the only place in the game where time turns into something
 * saleable, so the shape of the table and the way affinity and treats bend
 * it are worth pinning down. Nothing here touches the database or the
 * network: items.ts is pure data plus two functions.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  ITEMS,
  JOB_SECONDS,
  LOOT,
  SHOP,
  lootTable,
  rollLoot,
  type LootRow,
} from "../../web/src/shared/items";
import { mulberry32 } from "../../web/src/shared/maps";
import { SPECIES, type JobKind } from "../../web/src/shared/species";

const JOBS: JobKind[] = ["forage", "fish", "dig"];

const totalWeight = (t: LootRow[]) => t.reduce((s, r) => s + r.weight, 0);
const junkWeight = (t: LootRow[]) =>
  t.filter((r) => ITEMS[r.item].rarity === "junk").reduce((s, r) => s + r.weight, 0);
/** The share of rolls the table says should come back worthless. */
const junkShare = (t: LootRow[]) => junkWeight(t) / totalWeight(t);

/** Roll a table many times and report what fraction actually came back junk. */
function rolledJunkShare(table: LootRow[], rolls: number, seed: number): number {
  const rnd = mulberry32(seed);
  let junk = 0;
  for (let i = 0; i < rolls; i++) if (ITEMS[rollLoot(table, rnd)].rarity === "junk") junk++;
  return junk / rolls;
}

test("every job has a table that sums to a positive weight", () => {
  for (const job of JOBS) {
    const table = LOOT[job];
    assert.ok(table.length > 0, `${job} has no rows`);
    assert.ok(totalWeight(table) > 0, `${job} sums to ${totalWeight(table)}`);
    for (const row of table) {
      assert.ok(row.weight > 0, `${job}/${row.item} has weight ${row.weight}`);
      assert.ok(ITEMS[row.item], `${job} drops "${row.item}", which is not an item`);
    }
    // A table that is all junk or all treasure would make affinity meaningless.
    assert.ok(junkWeight(table) > 0, `${job} has no junk to take away`);
    assert.ok(totalWeight(table) - junkWeight(table) > 0, `${job} has nothing worth keeping`);
  }
});

test("job data lines up with the rest of the game", () => {
  for (const job of JOBS) {
    assert.ok(JOB_SECONDS[job] > 0, `${job} takes no time`);
    // Every drop is tagged as coming from the job whose table it is in.
    for (const row of LOOT[job]) assert.equal(ITEMS[row.item].from, job, `${row.item} claims a different job`);
  }
  // Junk is worthless and everything else is not; the trader reads `price`.
  for (const item of Object.values(ITEMS)) {
    if (item.rarity === "junk") assert.equal(item.price, 0, `${item.key} is junk but priced`);
    else if (item.from && item.from !== "shop") assert.ok(item.price > 0, `${item.key} is priceless`);
  }
  // Every species has an affinity for a job that actually has a table,
  // and leaves a keepsake the trader knows about.
  for (const s of SPECIES) {
    assert.ok(LOOT[s.affinity], `${s.key} has affinity for "${s.affinity}"`);
    assert.ok(ITEMS[s.keepsake], `${s.key} leaves "${s.keepsake}", which is not an item`);
  }
  for (const key of Object.keys(SHOP)) assert.ok(ITEMS[key], `the shop sells "${key}", which is not an item`);
});

test("lootTable halves junk with affinity and halves it again when fed", () => {
  for (const job of JOBS) {
    const base = lootTable(job, { affinity: false, fed: false });
    const aff = lootTable(job, { affinity: true, fed: false });
    const fed = lootTable(job, { affinity: false, fed: true });
    const both = lootTable(job, { affinity: true, fed: true });

    assert.equal(junkWeight(aff), junkWeight(base) / 2, `${job}: affinity should halve junk`);
    assert.equal(junkWeight(fed), junkWeight(base) / 2, `${job}: a treat should halve junk`);
    assert.equal(junkWeight(both), junkWeight(base) / 4, `${job}: both should quarter junk`);

    // Non-junk weights are left exactly where they were, so the real drops
    // keep their odds relative to each other.
    for (const table of [aff, fed, both]) {
      for (const row of table) {
        if (ITEMS[row.item].rarity === "junk") continue;
        const original = LOOT[job].find((r) => r.item === row.item)!;
        assert.equal(row.weight, original.weight, `${job}/${row.item} moved`);
      }
      assert.deepEqual(
        table.map((r) => r.item),
        LOOT[job].map((r) => r.item),
        `${job}: the rows changed order`,
      );
    }
  }
});

test("lootTable never writes back into LOOT", () => {
  const before = JSON.parse(JSON.stringify(LOOT)) as typeof LOOT;
  for (const job of JOBS) {
    lootTable(job, { affinity: true, fed: true });
    lootTable(job, { affinity: false, fed: false });
  }
  assert.deepEqual(JSON.parse(JSON.stringify(LOOT)), before, "LOOT was mutated by lootTable");
});

test("rollLoot only ever returns an item from the table it was handed", () => {
  for (const job of JOBS) {
    for (const opts of [
      { affinity: false, fed: false },
      { affinity: true, fed: false },
      { affinity: true, fed: true },
    ]) {
      const table = lootTable(job, opts);
      const allowed = new Set(table.map((r) => r.item));
      const rnd = mulberry32(1234 + job.length);
      for (let i = 0; i < 5_000; i++) {
        const got = rollLoot(table, rnd);
        assert.equal(typeof got, "string");
        assert.ok(allowed.has(got), `${job} rolled "${got}", which is not in the table`);
        assert.ok(ITEMS[got], `${job} rolled "${got}", which is not an item`);
      }
    }
  }
});

test("rollLoot holds up at the ends of the range", () => {
  const table = lootTable("forage", { affinity: false, fed: false });
  const allowed = new Set(table.map((r) => r.item));
  // A generator stuck at 0, at almost-1, and at exactly 1 must still answer.
  for (const stuck of [0, 0.999999999, 1]) {
    const got = rollLoot(table, () => stuck);
    assert.ok(allowed.has(got), `rnd()=${stuck} returned "${got}"`);
  }
  // rnd() === 0 lands on the first row; rnd() === 1 falls through to the last.
  assert.equal(rollLoot(table, () => 0), table[0].item);
  assert.equal(rollLoot(table, () => 1), table[table.length - 1].item);
});

test("the junk share drops when affinity and a treat are on", () => {
  const ROLLS = 40_000;
  for (const job of JOBS) {
    const base = lootTable(job, { affinity: false, fed: false });
    const aff = lootTable(job, { affinity: true, fed: false });
    const both = lootTable(job, { affinity: true, fed: true });

    const seenBase = rolledJunkShare(base, ROLLS, 20260908);
    const seenAff = rolledJunkShare(aff, ROLLS, 20260908);
    const seenBoth = rolledJunkShare(both, ROLLS, 20260908);

    // Direction first: each help makes the pile of rubbish smaller.
    assert.ok(seenAff < seenBase, `${job}: affinity did not help (${seenAff} vs ${seenBase})`);
    assert.ok(seenBoth < seenAff, `${job}: the treat did not help (${seenBoth} vs ${seenAff})`);

    // Then rough magnitude: what actually came back should sit near what
    // the weights promise. Two points of slack over forty thousand rolls.
    for (const [label, seen, table] of [
      ["base", seenBase, base],
      ["affinity", seenAff, aff],
      ["affinity+fed", seenBoth, both],
    ] as const) {
      const want = junkShare(table);
      assert.ok(
        Math.abs(seen - want) < 0.02,
        `${job}/${label}: rolled ${seen.toFixed(3)} junk, table says ${want.toFixed(3)}`,
      );
    }

    // And the help is worth having: better than a third of the junk gone.
    assert.ok(seenBase - seenBoth > 0.25, `${job}: only ${(seenBase - seenBoth).toFixed(3)} of junk removed`);
    assert.ok(seenBase > 0.5 && seenBoth < 0.3, `${job}: ${seenBase.toFixed(3)} -> ${seenBoth.toFixed(3)}`);
  }
});
