/**
 * The interlocks in assertConfig.
 *
 * These are the checks that stop the server booting into a shape where a
 * script can drain the payout contract, so each one is worth a test of its
 * own. `config` is built once at import from `process.env`, which means
 * every case needs a fresh module: this file loads `src/config.ts` through
 * a dynamic import with a cache-busting query string, which the tsx loader
 * treats as a distinct module and re-evaluates. (A child process per case
 * would work too, but this is in-process, deterministic, and the first
 * test below proves the isolation actually happens.)
 *
 * config.ts imports nothing and touches no disk, so no database is needed.
 */
import test from "node:test";
import assert from "node:assert/strict";

const configUrl = new URL("../src/config.ts", import.meta.url).href;

type ConfigModule = typeof import("../src/config");

/** Everything config.ts reads that these tests care about. */
const KEYS = [
  "GATE",
  "EGGS_ADDRESS",
  "PAYOUT_ADDRESS",
  "REWARD_TOKEN",
  "PAYOUT_SIGNER_KEY",
  "ALLOW_OPEN_GATE_EARNING",
  "SOLVENCY_BUFFER_PCT",
  "JOB_SCALE",
] as const;

const ADDRESS = "0x" + "11".repeat(20);
const TOKEN = "0x" + "22".repeat(20);
const KEY = "0x" + "33".repeat(32);
/** The three settings that together switch earning on. */
const EARNING = { PAYOUT_ADDRESS: ADDRESS, REWARD_TOKEN: TOKEN, PAYOUT_SIGNER_KEY: KEY };

let caseNumber = 0;

/** A fresh config module built from exactly this environment. */
async function load(env: Partial<Record<(typeof KEYS)[number], string>>): Promise<ConfigModule> {
  const saved = new Map(KEYS.map((k) => [k, process.env[k]] as const));
  try {
    for (const k of KEYS) delete process.env[k];
    for (const [k, v] of Object.entries(env)) process.env[k] = v;
    return (await import(`${configUrl}?case=${++caseNumber}`)) as ConfigModule;
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test("each case really does get its own module", async () => {
  const open = await load({ GATE: "open" });
  const eggs = await load({ GATE: "eggs", EGGS_ADDRESS: ADDRESS });
  assert.equal(open.config.gate, "open");
  assert.equal(eggs.config.gate, "eggs");
  assert.notEqual(open.config, eggs.config, "the two loads shared one config object");
});

test("a fresh checkout starts", async () => {
  const { assertConfig, config, earningConfigured, earningReason } = await load({});
  assert.doesNotThrow(assertConfig);
  assert.equal(config.gate, "open");
  assert.equal(earningConfigured(), false);
  assert.equal(earningReason(), "The payout contract is not deployed yet.");
});

test("earning behind an open door is refused", async () => {
  const { assertConfig, config, earningConfigured } = await load({ GATE: "open", ...EARNING });
  assert.equal(earningConfigured(), true);
  assert.equal(config.allowOpenGateEarning, false);
  assert.throws(assertConfig, (e: Error) => {
    assert.match(e.message, /Refusing to start/);
    assert.match(e.message, /earning is configured while the door is open/);
    // The message has to tell the operator what to do about it.
    assert.match(e.message, /GATE=eggs/);
    assert.match(e.message, /ALLOW_OPEN_GATE_EARNING=true/);
    return true;
  });
});

test("ALLOW_OPEN_GATE_EARNING=true says out loud that it is a test", async () => {
  const { assertConfig, config } = await load({
    GATE: "open",
    ...EARNING,
    ALLOW_OPEN_GATE_EARNING: "true",
  });
  assert.equal(config.allowOpenGateEarning, true);
  assert.doesNotThrow(assertConfig);
});

test("only the exact string true opens that door", async () => {
  for (const value of ["TRUE", "True", "1", "yes", "false", ""]) {
    const { assertConfig, config } = await load({ GATE: "open", ...EARNING, ALLOW_OPEN_GATE_EARNING: value });
    assert.equal(config.allowOpenGateEarning, false, `ALLOW_OPEN_GATE_EARNING=${value}`);
    assert.throws(assertConfig, /Refusing to start/, `ALLOW_OPEN_GATE_EARNING=${value}`);
  }
});

test("GATE=eggs with an address is the shape earning is meant to run in", async () => {
  const { assertConfig, config, earningConfigured } = await load({
    GATE: "eggs",
    EGGS_ADDRESS: ADDRESS,
    ...EARNING,
  });
  assert.equal(config.gate, "eggs");
  assert.equal(config.eggsAddress, ADDRESS);
  assert.equal(earningConfigured(), true);
  assert.doesNotThrow(assertConfig);
});

test("GATE=eggs without an address is refused", async () => {
  const missing = await load({ GATE: "eggs" });
  assert.throws(missing.assertConfig, /GATE=eggs needs EGGS_ADDRESS/);

  // And it has to be a contract address, not any old string.
  for (const bad of ["0x123", "not-an-address", "0x" + "11".repeat(19), ADDRESS + "ff"]) {
    const { assertConfig } = await load({ GATE: "eggs", EGGS_ADDRESS: bad });
    assert.throws(assertConfig, /GATE=eggs needs EGGS_ADDRESS/, `EGGS_ADDRESS=${bad}`);
  }
});

test("SOLVENCY_BUFFER_PCT has to be a percentage of the pot", async () => {
  for (const bad of ["-1", "100", "101", "1000"]) {
    const { assertConfig } = await load({ SOLVENCY_BUFFER_PCT: bad });
    assert.throws(assertConfig, /SOLVENCY_BUFFER_PCT must be between 0 and 99/, `SOLVENCY_BUFFER_PCT=${bad}`);
  }
  for (const ok of ["0", "5", "50", "99"]) {
    const { assertConfig, config } = await load({ SOLVENCY_BUFFER_PCT: ok });
    assert.equal(config.solvencyBufferPct, Number(ok));
    assert.doesNotThrow(assertConfig, `SOLVENCY_BUFFER_PCT=${ok}`);
  }
  const dflt = await load({});
  assert.equal(dflt.config.solvencyBufferPct, 5);
});

test("JOB_SCALE has to move time forwards", async () => {
  for (const bad of ["0", "-1", "abc"]) {
    const { assertConfig } = await load({ JOB_SCALE: bad });
    assert.throws(assertConfig, /JOB_SCALE must be > 0/, `JOB_SCALE=${bad}`);
  }
  const fast = await load({ JOB_SCALE: "0.05" });
  assert.equal(fast.config.jobScale, 0.05);
  assert.doesNotThrow(fast.assertConfig);
});

test("earningConfigured needs all three settings, and says which is missing", async () => {
  const cases: Array<[Partial<Record<(typeof KEYS)[number], string>>, string]> = [
    [{}, "The payout contract is not deployed yet."],
    [{ PAYOUT_ADDRESS: ADDRESS }, "The token address is not set yet."],
    [{ PAYOUT_ADDRESS: ADDRESS, REWARD_TOKEN: TOKEN }, "The game has no signing key yet."],
    [{ PAYOUT_ADDRESS: "0xnope", REWARD_TOKEN: TOKEN, PAYOUT_SIGNER_KEY: KEY }, "The payout contract is not deployed yet."],
  ];
  for (const [env, reason] of cases) {
    const { earningConfigured, earningReason } = await load(env);
    assert.equal(earningConfigured(), false, JSON.stringify(env));
    assert.equal(earningReason(), reason);
  }
  const full = await load(EARNING);
  assert.equal(full.earningConfigured(), true);
  assert.equal(full.earningReason(), null);
});

test("values are trimmed, so a stray space in a .env file is harmless", async () => {
  const { config, earningConfigured } = await load({
    GATE: " eggs ",
    EGGS_ADDRESS: `  ${ADDRESS}  `,
    ...EARNING,
  });
  assert.equal(config.gate, "eggs");
  assert.equal(config.eggsAddress, ADDRESS);
  assert.equal(earningConfigured(), true);
});
