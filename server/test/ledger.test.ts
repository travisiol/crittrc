/**
 * The entitlement ledger.
 *
 * `cashOut` is the only write that turns gold into a promise of tokens,
 * and `totalEarned()` is the number the solvency check is built on — if it
 * drifts, the server either refuses honest cash-outs or promises money the
 * contract cannot pay. Both are exercised here against a real database.
 */
import test, { after } from "node:test";
import assert from "node:assert/strict";

import { address, look, openTempDb } from "./helpers/tempdb";

const tmp = await openTempDb("ledger");
const { cashOut, createKeeper, getKeeper, listPayouts, totalEarned, getMeta, db } = tmp.db;
after(() => tmp.dispose());

const ONE = 10n ** 18n;

function keeperWith(n: number, gold: number) {
  const k = createKeeper(address(n), `Keeper${n}`, look(n));
  db.prepare("UPDATE keepers SET gold = ? WHERE id = ?").run(gold, k.id);
  return getKeeper(k.id)!;
}

test("a fresh database has earned nothing", () => {
  assert.equal(totalEarned(), 0n);
  assert.equal(getMeta("total_earned"), "0", "the running total is written on first read");
});

test("cashOut spends gold and raises earned together", () => {
  const k = keeperWith(1, 2_500);
  assert.equal(k.gold, 2_500);
  assert.equal(k.earned, 0n);

  cashOut(k, 1_000, 100n * ONE, "10");

  // The row that was handed in is updated in place...
  assert.equal(k.gold, 1_500);
  assert.equal(k.earned, 100n * ONE);
  // ...and so is what is actually on disk.
  const stored = getKeeper(k.id)!;
  assert.equal(stored.gold, 1_500);
  assert.equal(stored.earned, 100n * ONE);

  // The payout is recorded with the rate that was in force at the time.
  const rows = listPayouts(k.id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].gold, 1_000);
  assert.equal(rows[0].tokens, (100n * ONE).toString());
  assert.equal(rows[0].rate, "10");
  assert.ok(rows[0].at > 0 && rows[0].at <= Date.now());

  // And so is the gold leaving the keeper's hands.
  const led = db
    .prepare("SELECT kind, gold FROM ledger WHERE keeper = ? ORDER BY id DESC LIMIT 1")
    .get(k.id) as { kind: string; gold: number };
  assert.equal(led.kind, "cashout");
  assert.equal(Number(led.gold), -1_000, "the ledger row is negative gold");
});

test("cashing out everything leaves nothing behind", () => {
  const k = keeperWith(2, 700);
  cashOut(k, 700, 70n * ONE, "10");
  assert.equal(getKeeper(k.id)!.gold, 0);
  assert.equal(getKeeper(k.id)!.earned, 70n * ONE);
});

test("totalEarned tracks the running sum across cash-outs and keepers", () => {
  // Two keepers already cashed out above: 100 + 70 tokens.
  assert.equal(totalEarned(), 170n * ONE);

  const a = getKeeper(address(1))!;
  cashOut(a, 500, 50n * ONE, "10");
  assert.equal(totalEarned(), 220n * ONE);

  const c = keeperWith(3, 10_000);
  cashOut(c, 4_000, 400n * ONE, "10");
  cashOut(c, 1_000, 100n * ONE, "10");
  assert.equal(totalEarned(), 720n * ONE);

  // The running total is the sum of every keeper's cumulative entitlement.
  const summed = (db.prepare("SELECT earned FROM keepers").all() as Array<{ earned: string | null }>).reduce(
    (s, r) => s + BigInt(r.earned ?? "0"),
    0n,
  );
  assert.equal(totalEarned(), summed);

  // It is bigger than a SQLite integer can hold, which is why it is text.
  assert.ok(totalEarned() > BigInt(Number.MAX_SAFE_INTEGER));
});

test("totalEarned back-fills when the meta row is missing", () => {
  const before = totalEarned();
  assert.ok(before > 0n);

  // A database written before the running total existed: the keepers have
  // their `earned` values, but nothing has ever added them up.
  db.prepare("DELETE FROM meta WHERE key = 'total_earned'").run();
  assert.equal(getMeta("total_earned"), null);

  assert.equal(totalEarned(), before, "the sum should be rebuilt from the keeper rows");
  assert.equal(getMeta("total_earned"), before.toString(), "and written back so it is only done once");

  // Doing it twice changes nothing.
  assert.equal(totalEarned(), before);
});

test("a stored total is trusted over re-summing, which is the point of it", () => {
  const real = totalEarned();
  db.prepare("UPDATE meta SET value = ? WHERE key = 'total_earned'").run("42");
  assert.equal(totalEarned(), 42n, "the stored value wins while it is there");
  db.prepare("UPDATE meta SET value = ? WHERE key = 'total_earned'").run(real.toString());
  assert.equal(totalEarned(), real);
});

test("a cash-out that throws leaves the database exactly as it was", () => {
  const k = keeperWith(4, 3_000);
  const goldBefore = getKeeper(k.id)!.gold;
  const earnedBefore = getKeeper(k.id)!.earned;
  const totalBefore = totalEarned();
  const payoutsBefore = listPayouts(k.id).length;

  // `k.earned += tokens` is the first thing that touches a bigint, so a
  // token amount that is not one blows up inside the transaction.
  assert.throws(() => cashOut(k, 1_000, 5 as unknown as bigint, "10"), TypeError);

  const after = getKeeper(k.id)!;
  assert.equal(after.gold, goldBefore, "gold was rolled back");
  assert.equal(after.earned, earnedBefore, "entitlement was rolled back");
  assert.equal(totalEarned(), totalBefore, "the running total was rolled back");
  assert.equal(listPayouts(k.id).length, payoutsBefore, "no payout row was left behind");

  // The keeper can still cash out afterwards; the connection is not wedged.
  const fresh = getKeeper(k.id)!;
  cashOut(fresh, 1_000, 100n * ONE, "10");
  assert.equal(getKeeper(k.id)!.gold, goldBefore - 1_000);
});

test("listPayouts returns newest first and respects its limit", () => {
  const k = keeperWith(5, 10_000);
  for (let i = 1; i <= 5; i++) cashOut(k, i * 100, BigInt(i) * ONE, String(i));

  const all = listPayouts(k.id, 10);
  assert.equal(all.length, 5);
  assert.deepEqual(
    all.map((r) => r.gold),
    [500, 400, 300, 200, 100],
    "newest cash-out first",
  );
  assert.deepEqual(
    all.map((r) => r.rate),
    ["5", "4", "3", "2", "1"],
  );
  for (let i = 1; i < all.length; i++) assert.ok(all[i - 1].at >= all[i].at, "timestamps run backwards");

  const two = listPayouts(k.id, 2);
  assert.equal(two.length, 2);
  assert.deepEqual(
    two.map((r) => r.gold),
    [500, 400],
  );
  assert.equal(listPayouts(k.id).length, 5, "the default limit is 10");

  // One keeper's history never leaks into another's.
  assert.ok(listPayouts(address(2)).every((r) => r.gold === 700));
  assert.equal(listPayouts(address(999)).length, 0);
});
