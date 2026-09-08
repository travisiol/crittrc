/**
 * Cash-out arithmetic.
 *
 * `tokensForGold` is the one piece of maths standing between a pile of
 * gold and a signed promise of tokens, so it gets held to the rule the
 * comment in payout.ts states: division truncates, and the remainder stays
 * gold. Nothing here goes near a chain — `weiPerGold`, `tokensForGold` and
 * `formatTokens` are pure, and the module's viem client is never called.
 *
 * The rate and the decimals are read from the environment, so they are set
 * before the first import. `weiPerGold()` reads `config.tokensPerGold`
 * every time it is called — the rate is published and may change while the
 * server runs — while `decimals` is captured once at import, which is why
 * the last test reloads the module to change it.
 */
import test, { after } from "node:test";
import assert from "node:assert/strict";

import { openTempDb } from "./helpers/tempdb";

process.env.TOKENS_PER_GOLD = "10";
process.env.REWARD_TOKEN_DECIMALS = "18";
process.env.REWARD_TOKEN_SYMBOL = "CRITTR";

// payout.ts pulls in db.ts for totalEarned(), so a temp file has to exist
// before it is imported.
const tmp = await openTempDb("payout");
after(() => tmp.dispose());

const configUrl = new URL("../src/config.ts", import.meta.url).href;
const payoutUrl = new URL("../src/payout.ts", import.meta.url).href;

type ConfigModule = typeof import("../src/config");
type PayoutModule = typeof import("../src/payout");

const { config } = (await import(configUrl)) as ConfigModule;
const { weiPerGold, tokensForGold, formatTokens } = (await import(`${payoutUrl}?v=base`)) as PayoutModule;

const ONE = 10n ** 18n;
const rate = config.tokensPerGold;
after(() => {
  config.tokensPerGold = rate;
});

test("weiPerGold parses the published rate at the token's decimals", () => {
  assert.equal(config.tokensPerGold, "10");
  assert.equal(config.rewardTokenDecimals, 18);
  assert.equal(weiPerGold(), 10n * ONE);
  assert.equal(formatTokens(weiPerGold()), "10");
});

test("one whole gold is worth exactly the rate", () => {
  // Gold is stored in hundredths: 100 hundredths is 1.00 gold.
  assert.equal(tokensForGold(100), 10n * ONE);
  assert.equal(tokensForGold(250), 25n * ONE);
  assert.equal(tokensForGold(10_000), 1_000n * ONE);
});

test("tokensForGold scales linearly", () => {
  const base = tokensForGold(300);
  assert.equal(tokensForGold(600), base * 2n);
  assert.equal(tokensForGold(900), base * 3n);
  assert.equal(tokensForGold(3_000), base * 10n);
  // Additive too, at this rate, because nothing is lost to truncation.
  assert.equal(tokensForGold(400) + tokensForGold(500), tokensForGold(900));
});

test("tokensForGold refuses anything that is not a positive whole number", () => {
  assert.equal(tokensForGold(0), 0n);
  assert.equal(tokensForGold(-1), 0n);
  assert.equal(tokensForGold(-10_000), 0n);
  assert.equal(tokensForGold(1.5), 0n);
  assert.equal(tokensForGold(100.0001), 0n);
  assert.equal(tokensForGold(Number.NaN), 0n);
  assert.equal(tokensForGold(Number.POSITIVE_INFINITY), 0n);
  // A whole number that arrived as a float is still whole.
  assert.equal(tokensForGold(100.0), 10n * ONE);
});

test("the division truncates, so the pot never overpays", () => {
  // One wei per whole gold makes the rounding visible: a hundredth of a
  // gold is worth a hundredth of a wei, and there is no such thing.
  config.tokensPerGold = "0.000000000000000001";
  try {
    assert.equal(weiPerGold(), 1n, "the rate should be one wei per gold");
    assert.equal(tokensForGold(99), 0n, "0.99 gold rounds down to nothing");
    assert.equal(tokensForGold(100), 1n);
    assert.equal(tokensForGold(150), 1n, "1.50 gold must not round up to 2");
    assert.equal(tokensForGold(199), 1n);
    assert.equal(tokensForGold(200), 2n);
    // Splitting a cash-out in two can only ever pay less, never more.
    for (const [a, b] of [
      [150, 150],
      [125, 175],
      [99, 201],
    ]) {
      assert.ok(
        tokensForGold(a) + tokensForGold(b) <= tokensForGold(a + b),
        `${a}+${b} paid more split than whole`,
      );
    }
  } finally {
    config.tokensPerGold = rate;
  }
});

test("a rate of zero yields nothing at all", () => {
  config.tokensPerGold = "0";
  try {
    assert.equal(weiPerGold(), 0n);
    assert.equal(tokensForGold(100), 0n);
    assert.equal(tokensForGold(1_000_000), 0n, "no amount of gold is worth anything at zero");
  } finally {
    config.tokensPerGold = rate;
  }
});

test("a rate that is not a number is treated as zero, not as a crash", () => {
  for (const bad of ["", "abc", "1.2.3", "ten"]) {
    config.tokensPerGold = bad;
    assert.equal(weiPerGold(), 0n, `rate "${bad}"`);
    assert.equal(tokensForGold(10_000), 0n, `rate "${bad}"`);
  }
  config.tokensPerGold = rate;
});

test("formatTokens is the inverse of the rate, at the token's decimals", () => {
  assert.equal(formatTokens(0n), "0");
  assert.equal(formatTokens(ONE), "1");
  assert.equal(formatTokens(25n * ONE), "25");
  assert.equal(formatTokens(ONE / 2n), "0.5");
  assert.equal(formatTokens(tokensForGold(250)), "25");
});

test("the decimals come from the environment, not from a constant", async () => {
  // A fresh module instance is the only way to move `decimals`: payout.ts
  // reads it once, at import. Re-import config from the new environment and
  // transplant it onto the singleton the fresh payout module will read.
  process.env.REWARD_TOKEN_DECIMALS = "6";
  process.env.TOKENS_PER_GOLD = "10";
  const fresh = (await import(`${configUrl}?d=6`)) as ConfigModule;
  assert.equal(fresh.config.rewardTokenDecimals, 6);
  Object.assign(config, fresh.config);
  const six = (await import(`${payoutUrl}?v=d6`)) as PayoutModule;

  assert.equal(six.weiPerGold(), 10_000_000n, "10 tokens at 6 decimals");
  assert.equal(six.tokensForGold(100), 10_000_000n);
  assert.equal(six.formatTokens(six.tokensForGold(100)), "10");
  // Truncation still bites, and now it bites much sooner.
  assert.equal(six.tokensForGold(1), 100_000n);

  process.env.REWARD_TOKEN_DECIMALS = "18";
  const back = (await import(`${configUrl}?d=18`)) as ConfigModule;
  Object.assign(config, back.config);
});
