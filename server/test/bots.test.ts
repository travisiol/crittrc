/**
 * The meadow's own keepers.
 *
 * Bots are the first thing anyone sees, and they are driven by the same
 * pathfinder and the same map as a player, so the things worth checking
 * are the ones that would show as somebody standing in a bush: a name the
 * server would refuse, a spawn inside a tree, or a coordinate that has
 * gone NaN and never comes back.
 *
 * `stepBot` calls `Math.random` directly, so the simulation below swaps it
 * for a seeded generator: the same three hundred seconds of meadow every
 * run, no flakes.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { makeBotNames, makeBots, stepBot, botCritterView, botPlayerView, describeBots, type Bot, type BotContext } from "../src/bots";
import { JOB_SECONDS } from "../../web/src/shared/items";
import { canStand, getMap, mulberry32 } from "../../web/src/shared/maps";
import { NICKNAME_RE, SPECIES } from "../../web/src/shared/species";
import { LOOK_COUNTS, type Look } from "../../web/src/shared/protocol";

const map = getMap("meadow");
const NOBODY = () => false;

// ── Names ───────────────────────────────────────────────────────────

test("makeBotNames returns the number asked for", () => {
  for (const count of [1, 5, 34, 100]) {
    const names = makeBotNames(count, 91_337, NOBODY);
    assert.equal(names.length, count, `asked for ${count}`);
  }
  assert.deepEqual(makeBotNames(0, 1, NOBODY), []);
});

test("bot names pass the game's own nickname rule", () => {
  const names = makeBotNames(200, 4_242, NOBODY);
  for (const name of names) {
    assert.match(name, NICKNAME_RE, `"${name}" would be refused by the fitting room`);
    assert.ok(name.length >= 3 && name.length <= 8, `"${name}" is ${name.length} characters`);
  }
});

test("bot names do not repeat, even case-insensitively", () => {
  const names = makeBotNames(200, 7, NOBODY);
  const lowered = names.map((n) => n.toLowerCase());
  assert.equal(new Set(lowered).size, names.length, "two bots share a name");
});

test("makeBotNames respects the taken predicate", () => {
  const asked: string[] = [];
  const names = makeBotNames(40, 11, (n) => {
    asked.push(n);
    return n.toLowerCase().startsWith("mo");
  });
  assert.ok(asked.length >= names.length, "the predicate was not consulted for every name");
  assert.equal(names.length, 40);
  for (const n of names) assert.ok(!n.toLowerCase().startsWith("mo"), `"${n}" should have been refused`);

  // A name the world already holds is skipped without giving up on the rest.
  const first = makeBotNames(20, 3, NOBODY);
  const held = new Set(first.slice(0, 5).map((n) => n.toLowerCase()));
  const second = makeBotNames(20, 3, (n) => held.has(n.toLowerCase()));
  assert.equal(second.length, 20);
  for (const n of second) assert.ok(!held.has(n.toLowerCase()), `"${n}" was already taken`);
});

test("a world where every name is taken gives up instead of spinning", () => {
  // The guard in makeBotNames is what stops this becoming an infinite loop.
  const names = makeBotNames(50, 5, () => true);
  assert.deepEqual(names, []);
});

test("the same seed builds the same crowd", () => {
  assert.deepEqual(makeBotNames(30, 1_234, NOBODY), makeBotNames(30, 1_234, NOBODY));
  assert.notDeepEqual(makeBotNames(30, 1_234, NOBODY), makeBotNames(30, 5_678, NOBODY));
});

// ── Placing them ────────────────────────────────────────────────────

test("makeBots puts every bot somewhere it can stand", () => {
  for (const seed of [1, 42, 20_260_908]) {
    const names = makeBotNames(40, seed, NOBODY);
    const bots = makeBots("meadow-1", names, seed);
    assert.equal(bots.length, names.length);
    for (const bot of bots) {
      assert.ok(canStand(map, bot.x, bot.y), `${bot.name} spawned at (${bot.x},${bot.y})`);
      assert.ok(Number.isFinite(bot.x) && Number.isFinite(bot.y));
      assert.ok(bot.x > 0 && bot.x < map.width && bot.y > 0 && bot.y < map.height, "spawned off the map");
    }
  }
});

test("every bot gets between one and three critters", () => {
  const bots = makeBots("meadow-2", makeBotNames(60, 9, NOBODY), 9);
  const ids = new Set<string>();
  for (const bot of bots) {
    assert.ok(bot.critters.length >= 1 && bot.critters.length <= 3, `${bot.name} has ${bot.critters.length} critters`);
    for (const cr of bot.critters) {
      assert.ok(!ids.has(cr.id), `duplicate critter id ${cr.id}`);
      ids.add(cr.id);
      const species = SPECIES.find((s) => s.id === cr.species);
      assert.ok(species, `critter has species ${cr.species}, which does not exist`);
      assert.equal(cr.name, species!.name);
      assert.equal(cr.state, "follow");
      assert.ok(canStand(map, cr.x, cr.y), "a critter spawned in scenery");
    }
  }
  // A bot is nothing more than scenery, so it never carries a party of four.
  assert.ok(bots.some((b) => b.critters.length === 1));
  assert.ok(bots.some((b) => b.critters.length === 3));
});

test("bots are given a valid look and a real speed", () => {
  const bots = makeBots("meadow-3", makeBotNames(40, 21, NOBODY), 21);
  const botIds = new Set<string>();
  for (const bot of bots) {
    assert.ok(!botIds.has(bot.id), `duplicate bot id ${bot.id}`);
    botIds.add(bot.id);
    assert.match(bot.id, /^bot-meadow-3-\d+$/);
    for (const key of Object.keys(LOOK_COUNTS) as Array<keyof Look>) {
      const v = bot.look[key];
      assert.ok(Number.isInteger(v) && v >= 0 && v < LOOK_COUNTS[key], `${bot.name}.look.${key} is ${v}`);
    }
    assert.ok(bot.speed > 0 && bot.speed < 10, `${bot.name} moves at ${bot.speed} tiles a second`);
    assert.deepEqual(bot.path, []);
    assert.equal(bot.spot, null);
  }
  assert.match(describeBots(bots), /^40 keepers, \d+ critters$/);
});

// ── Living in the meadow ────────────────────────────────────────────

test("stepping a bot for five minutes keeps it on the map and out of the scenery", () => {
  const names = makeBotNames(34, 91_337, NOBODY);
  const bots = makeBots("meadow-1", names, 91_337);
  const said: Array<{ name: string; text: string }> = [];
  let everWorked = false;

  const botsAtSpot = (spotId: string) =>
    bots.reduce((n, b) => n + b.critters.filter((c) => c.job?.spotId === spotId).length, 0);

  const ctx: BotContext = {
    map,
    botsAtSpot,
    spotIsFull: (spot) => botsAtSpot(spot.id) >= spot.capacity,
    jobSeconds: (kind) => JOB_SECONDS[kind],
    say: (bot, text) => said.push({ name: bot.name, text }),
  };

  const realRandom = Math.random;
  const rnd = mulberry32(20_260_908);
  Math.random = rnd;
  try {
    const dt = 0.1;
    let now = Date.now();
    const start = bots.map((b) => ({ x: b.x, y: b.y }));

    for (let tick = 0; tick < 3_000; tick++) {
      now += 100;
      for (const bot of bots) {
        stepBot(bot, ctx, dt, now);

        assert.ok(Number.isFinite(bot.x), `${bot.name} x went to ${bot.x} on tick ${tick}`);
        assert.ok(Number.isFinite(bot.y), `${bot.name} y went to ${bot.y} on tick ${tick}`);
        assert.ok(canStand(map, bot.x, bot.y), `${bot.name} stood in scenery at (${bot.x},${bot.y}) on tick ${tick}`);

        for (const step of bot.path) {
          assert.ok(Number.isFinite(step.x) && Number.isFinite(step.y), `${bot.name} has a NaN waypoint`);
        }
        for (const cr of bot.critters) {
          assert.ok(Number.isFinite(cr.x) && Number.isFinite(cr.y), `${cr.id} went to (${cr.x},${cr.y})`);
          if (cr.state === "work") {
            everWorked = true;
            assert.ok(cr.job, "a working critter with no job");
            assert.ok(cr.job!.endsAt > cr.job!.startedAt, "a job that ends before it starts");
          }
        }
        for (const point of bot.trail) {
          assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y), `${bot.name} has a NaN trail point`);
        }
        assert.ok(bot.trail.length <= 24, "the trail grew without bound");
      }
    }

    // The meadow should look alive, not frozen: they walk, they talk, and
    // their critters end up at the spots.
    const moved = bots.filter((b, i) => Math.hypot(b.x - start[i].x, b.y - start[i].y) > 1).length;
    assert.ok(moved > bots.length / 2, `only ${moved} of ${bots.length} bots went anywhere`);
    assert.ok(said.length > 0, "nobody said anything in five minutes");
    assert.ok(everWorked, "no bot ever sent a critter to a spot");
    for (const line of said) assert.ok(line.text.length > 0 && line.text.length <= 72, `"${line.text}"`);
  } finally {
    Math.random = realRandom;
  }
});

test("the views sent to the client are rounded and complete", () => {
  const bots = makeBots("meadow-1", makeBotNames(4, 5, NOBODY), 5);
  for (const bot of bots) {
    const view = botPlayerView(bot);
    assert.equal(view.id, bot.id);
    assert.equal(view.name, bot.name);
    assert.deepEqual(view.look, bot.look);
    // Two decimals on the wire: the snapshot goes out ten times a second.
    assert.equal(Math.round(view.x * 100) / 100, view.x);
    assert.equal(Math.round(view.y * 100) / 100, view.y);
    assert.ok(Number.isFinite(view.x) && Number.isFinite(view.y));

    for (const cr of bot.critters) {
      const cv = botCritterView(bot, cr);
      assert.equal(cv.owner, bot.id);
      assert.equal(cv.species, cr.species);
      assert.equal(cv.state, "follow");
      assert.equal(cv.job, undefined, "an idle critter should not carry a job");
      assert.ok(Number.isFinite(cv.x) && Number.isFinite(cv.y));
    }
  }
});
