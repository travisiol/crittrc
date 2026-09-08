/**
 * Gold, bags and the trader's ceiling.
 *
 * Everything a keeper owns lives in SQLite, so these run against a real
 * database file in a temp folder rather than a stub — the same driver, the
 * same schema, the same foreign keys. The trader's own arithmetic needs a
 * socket, but the two numbers it is built on (the daily cap and the way
 * gold is formatted) do not, and those are what is checked here.
 */
import test, { after, before } from "node:test";
import assert from "node:assert/strict";

import { BAG_CAPACITY, SHOP, TRADER_DAILY_CAP, formatGold } from "../../web/src/shared/items";
import { address, look, openTempDb } from "./helpers/tempdb";

const tmp = await openTempDb("gold");
const {
  addToBag,
  bagCount,
  counts,
  createKeeper,
  getBag,
  getKeeper,
  insertCritter,
  ledger,
  nameTaken,
  setFed,
  setGold,
  setNestCollected,
  setSold,
  listCritters,
  db,
} = tmp.db;

const KEEPER = address(1);
const OTHER = address(2);

before(() => {
  createKeeper(KEEPER, "Tester", look(1));
  createKeeper(OTHER, "Second", look(2));
});

after(() => tmp.dispose());

// ── The bag ─────────────────────────────────────────────────────────

test("addToBag and getBag round-trip", () => {
  assert.deepEqual(getBag(KEEPER), []);
  assert.equal(bagCount(KEEPER), 0);

  assert.equal(addToBag(KEEPER, "pearl", 3), 3);
  assert.equal(addToBag(KEEPER, "pearl", 2), 5);
  assert.equal(addToBag(KEEPER, "moon_cap", 1), 1);

  // Rows come back sorted by item key, which is what the client renders.
  assert.deepEqual(getBag(KEEPER), [
    { item: "moon_cap", qty: 1 },
    { item: "pearl", qty: 5 },
  ]);
  assert.equal(bagCount(KEEPER), 6);
});

test("a stack that reaches zero is deleted, not left at 0", () => {
  addToBag(KEEPER, "gravel", 4);
  assert.equal(addToBag(KEEPER, "gravel", -4), 0);
  assert.ok(
    !getBag(KEEPER).some((e) => e.item === "gravel"),
    "an emptied stack should leave the bag entirely",
  );

  // Overshooting the other way clamps at zero rather than going negative,
  // and the row still goes.
  addToBag(KEEPER, "tin_can", 2);
  assert.equal(addToBag(KEEPER, "tin_can", -7), 0);
  assert.deepEqual(getBag(KEEPER).filter((e) => e.item === "tin_can"), []);

  // And the stack starts clean the next time something is put in it.
  assert.equal(addToBag(KEEPER, "tin_can", 1), 1);
  addToBag(KEEPER, "tin_can", -1);
});

test("bags belong to one keeper each", () => {
  addToBag(OTHER, "pearl", 9);
  assert.equal(getBag(OTHER).find((e) => e.item === "pearl")!.qty, 9);
  assert.equal(getBag(KEEPER).find((e) => e.item === "pearl")!.qty, 5);
  assert.equal(bagCount(OTHER), 9);
  addToBag(OTHER, "pearl", -9);
  assert.equal(bagCount(OTHER), 0);
});

test("bagCount counts units, and the capacity is a real number of them", () => {
  assert.ok(BAG_CAPACITY > 0);
  assert.ok(Number.isInteger(BAG_CAPACITY));
  const before = bagCount(KEEPER);
  addToBag(KEEPER, "old_boot", BAG_CAPACITY);
  assert.equal(bagCount(KEEPER), before + BAG_CAPACITY);
  addToBag(KEEPER, "old_boot", -BAG_CAPACITY);
  assert.equal(bagCount(KEEPER), before);
});

// ── Gold on the keeper row ──────────────────────────────────────────

test("a new keeper starts with nothing and setGold round-trips", () => {
  const fresh = createKeeper(address(3), "Freshly", look(3));
  assert.equal(fresh.gold, 0);
  assert.equal(fresh.earned, 0n);
  assert.equal(fresh.sold_today, 0);
  assert.equal(fresh.sold_day, "");
  assert.deepEqual(fresh.look, look(3));

  setGold(fresh.id, 12_345);
  assert.equal(getKeeper(fresh.id)!.gold, 12_345);
  setGold(fresh.id, 0);
  assert.equal(getKeeper(fresh.id)!.gold, 0);
});

test("names are taken case-insensitively, so nobody gets a near-copy", () => {
  assert.ok(nameTaken("Tester"));
  assert.ok(nameTaken("tESTER"));
  assert.ok(!nameTaken("Nobody"));
  assert.equal(getKeeper("0xnot-a-keeper"), null);
});

test("the trader's day counter round-trips", () => {
  setSold(KEEPER, "2026-09-08", 4_200);
  const k = getKeeper(KEEPER)!;
  assert.equal(k.sold_day, "2026-09-08");
  assert.equal(k.sold_today, 4_200);
  setSold(KEEPER, "2026-09-09", 0);
  assert.equal(getKeeper(KEEPER)!.sold_today, 0);
});

test("the nest timestamp round-trips", () => {
  setNestCollected(KEEPER, 1_700_000_000_000);
  assert.equal(getKeeper(KEEPER)!.nest_collected_at, 1_700_000_000_000);
});

// ── The numbers the trader is built on ──────────────────────────────

test("formatGold turns hundredths into gold with two decimals", () => {
  assert.equal(formatGold(0), "0.00");
  assert.equal(formatGold(1), "0.01");
  assert.equal(formatGold(9), "0.09");
  assert.equal(formatGold(10), "0.10");
  assert.equal(formatGold(150), "1.50");
  assert.equal(formatGold(250), "2.50");
  assert.equal(formatGold(1_234), "12.34");
  assert.equal(formatGold(10_000), "100.00");
  assert.equal(formatGold(1_000_000), "10000.00");
  // Cash-out writes a negative gold row into the ledger, so it has to read.
  assert.equal(formatGold(-50), "-0.50");
  // Always two decimals, never scientific notation, never a bare integer.
  for (const n of [0, 1, 7, 99, 100, 101, 99_999]) {
    assert.match(formatGold(n), /^-?\d+\.\d{2}$/, `formatGold(${n})`);
  }
});

test("TRADER_DAILY_CAP is the number items.ts publishes", () => {
  assert.equal(TRADER_DAILY_CAP, 10_000);
  assert.equal(formatGold(TRADER_DAILY_CAP), "100.00", "the cap is 100 gold a day");
  assert.ok(Number.isInteger(TRADER_DAILY_CAP) && TRADER_DAILY_CAP > 0);
  // The cap has to be worth more than a single sale, or the trader is shut.
  assert.ok(TRADER_DAILY_CAP > Math.max(...Object.values(SHOP)));
});

// ── The rest of the keeper's things ─────────────────────────────────

test("critters belong to a keeper and feeding sticks", () => {
  insertCritter({ id: "c-1", keeper: KEEPER, species: 1, name: "Mossit", token_id: null });
  insertCritter({ id: "c-2", keeper: KEEPER, species: 2, name: "Tidlet", token_id: 7 });
  const mine = listCritters(KEEPER);
  assert.equal(mine.length, 2);
  assert.equal(mine[0].fed, 0);
  assert.equal(mine[1].token_id, 7);

  setFed("c-1", true);
  assert.equal(listCritters(KEEPER).find((c) => c.id === "c-1")!.fed, 1);
  setFed("c-1", false);
  assert.equal(listCritters(KEEPER).find((c) => c.id === "c-1")!.fed, 0);
});

test("the ledger keeps a row for every gold movement", () => {
  // node:sqlite hands back null-prototype rows, so copy them into plain
  // objects before comparing shapes.
  const rows = () =>
    (
      db.prepare("SELECT kind, item, qty, gold FROM ledger WHERE keeper = ? ORDER BY id").all(KEEPER) as Array<{
        kind: string;
        item: string | null;
        qty: number;
        gold: number;
      }>
    ).map((r) => ({ kind: r.kind, item: r.item, qty: Number(r.qty), gold: Number(r.gold) }));
  const before = rows().length;
  ledger(KEEPER, "sell", "pearl", 5, 1_250);
  ledger(KEEPER, "buy", "treat", 2, -100);
  const after = rows();
  assert.equal(after.length, before + 2);
  assert.deepEqual(after[after.length - 2], { kind: "sell", item: "pearl", qty: 5, gold: 1_250 });
  assert.deepEqual(after[after.length - 1], { kind: "buy", item: "treat", qty: 2, gold: -100 });
});

test("counts() reports what is actually in the tables", () => {
  setGold(KEEPER, 500);
  setGold(OTHER, 250);
  const c = counts();
  assert.equal(c.keepers, 3);
  assert.equal(c.critters, 2);
  assert.equal(c.gold, 750, "gold is summed across keepers");
  setGold(KEEPER, 0);
  setGold(OTHER, 0);
});
