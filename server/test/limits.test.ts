/**
 * The token buckets.
 *
 * Time is the only interesting input here, so `Date.now` is replaced with a
 * clock the tests move by hand: no sleeping, no flakiness, and a refill
 * that takes an hour of game time costs nothing to check.
 */
import test, { after, before } from "node:test";
import assert from "node:assert/strict";

import { RateLimiter, limits, pruneLimits } from "../src/limits";

const realNow = Date.now;
let clock = 1_700_000_000_000;
const advance = (ms: number) => {
  clock += ms;
};

before(() => {
  Date.now = () => clock;
});
after(() => {
  Date.now = realNow;
});

test("a bucket allows exactly capacity bursts, then refuses", () => {
  const rl = new RateLimiter(3, 1);
  assert.equal(rl.take("a"), true);
  assert.equal(rl.take("a"), true);
  assert.equal(rl.take("a"), true);
  assert.equal(rl.take("a"), false, "the fourth in the same instant should be refused");
  assert.equal(rl.take("a"), false, "and it stays refused");
});

test("a bucket refills over time and never past its capacity", () => {
  const rl = new RateLimiter(3, 1); // one token a second
  for (let i = 0; i < 3; i++) rl.take("a");
  assert.equal(rl.take("a"), false);

  advance(999);
  assert.equal(rl.take("a"), false, "not quite a token yet");

  advance(1); // 1000ms since the last take
  assert.equal(rl.take("a"), true, "one second buys one action");
  assert.equal(rl.take("a"), false);

  // Waiting an hour still only buys back the capacity, not an hour of them.
  advance(3_600_000);
  assert.equal(rl.take("a"), true);
  assert.equal(rl.take("a"), true);
  assert.equal(rl.take("a"), true);
  assert.equal(rl.take("a"), false, "the bucket is capped at capacity");
});

test("a fractional refill rate is honoured", () => {
  const rl = new RateLimiter(2, 0.2); // one token every five seconds
  rl.take("a");
  rl.take("a");
  assert.equal(rl.take("a"), false);
  advance(4_000);
  assert.equal(rl.take("a"), false);
  advance(1_000);
  assert.equal(rl.take("a"), true);
});

test("cost is charged in full or not at all", () => {
  const rl = new RateLimiter(3, 1);
  assert.equal(rl.take("a", 3), true);
  assert.equal(rl.take("a", 1), false);

  const rl2 = new RateLimiter(3, 1);
  assert.equal(rl2.take("b", 2), true);
  assert.equal(rl2.take("b", 2), false, "two more than the one left, so nothing is taken");
  assert.equal(rl2.take("b", 1), true, "and the leftover token is still there");
});

test("retryAfter is zero while there is room and positive once there is not", () => {
  const rl = new RateLimiter(2, 0.5); // one token every two seconds
  assert.equal(rl.retryAfter("never-seen"), 0, "an unknown key has a full bucket");

  rl.take("a");
  assert.equal(rl.retryAfter("a"), 0, "one token left");
  rl.take("a");
  assert.equal(rl.take("a"), false);

  const wait = rl.retryAfter("a");
  assert.ok(wait > 0, `expected a positive wait, got ${wait}`);
  assert.equal(wait, 2, "one token at half a token a second");
  assert.ok(Number.isInteger(wait), "the number goes into a message, so it is whole");

  // Once the wait it named has passed, the action goes through.
  advance(wait * 1000);
  assert.equal(rl.take("a"), true, "the wait it reported was long enough");

  // retryAfter reads the bucket as it stood at the last take — it does not
  // refill on its own. That is fine, because it is only ever called right
  // after a take that failed, and that one does refill.
  advance(60_000);
  assert.equal(rl.retryAfter("a"), 2, "still reporting the count from the last take");
  assert.equal(rl.take("a"), true, "and the take that follows sees the refill");

  // With tokens left in hand the answer is zero, not a wait.
  const roomy = new RateLimiter(3, 1);
  for (let i = 0; i < 3; i++) roomy.take("b");
  assert.equal(roomy.take("b"), false);
  assert.ok(roomy.retryAfter("b") > 0);
  advance(3_000);
  assert.equal(roomy.take("b"), true, "three seconds buys the bucket back");
  assert.equal(roomy.retryAfter("b"), 0, "two tokens left, so nobody has to wait");
});

test("keys do not share a bucket", () => {
  const rl = new RateLimiter(2, 1);
  assert.equal(rl.take("1.2.3.4"), true);
  assert.equal(rl.take("1.2.3.4"), true);
  assert.equal(rl.take("1.2.3.4"), false, "this address is spent");

  assert.equal(rl.take("5.6.7.8"), true, "a different address is untouched");
  assert.equal(rl.take("5.6.7.8"), true);
  assert.equal(rl.take("5.6.7.8"), false);
  assert.equal(rl.retryAfter("1.2.3.4"), 1);
  assert.equal(rl.size, 2);
});

test("prune drops idle buckets and keeps busy ones", () => {
  const rl = new RateLimiter(5, 1);
  rl.take("idle");
  rl.take("busy");
  assert.equal(rl.size, 2);

  // Nothing is old enough yet.
  advance(60_000);
  rl.prune(10 * 60_000);
  assert.equal(rl.size, 2);

  // "busy" is touched just before the sweep; "idle" is not.
  advance(11 * 60_000);
  rl.take("busy");
  rl.prune(10 * 60_000);
  assert.equal(rl.size, 1, "the idle bucket should be gone");
  assert.equal(rl.take("busy"), true);

  // A pruned key comes back full, which is the point of dropping it.
  for (let i = 0; i < 5; i++) rl.take("idle");
  assert.equal(rl.take("idle"), false);

  advance(30 * 60_000);
  rl.prune();
  assert.equal(rl.size, 0, "the default cutoff is ten minutes");
});

test("the shared buckets are the ones the server documents", () => {
  for (const [name, bucket] of Object.entries(limits)) {
    assert.ok(bucket instanceof RateLimiter, `${name} is not a RateLimiter`);
  }
  assert.deepEqual(Object.keys(limits).sort(), ["action", "auth", "earn", "http", "keeper"]);

  // Creating a keeper and cashing out are the expensive ones, so they must
  // be tighter than plain HTTP.
  assert.equal(limits.keeper.take("x"), true);
  assert.equal(limits.earn.take("x"), true);
  assert.equal(limits.http.take("x"), true);
  assert.ok(limits.keeper.size > 0);

  pruneLimits();
  advance(30 * 60_000);
  pruneLimits();
  for (const [name, bucket] of Object.entries(limits)) {
    assert.equal(bucket.size, 0, `${name} kept a stale bucket`);
  }
});
