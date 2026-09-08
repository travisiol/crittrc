/**
 * The map and the walk across it.
 *
 * `findPath` is what the bots live on — every route they take, every trip
 * to a spot or to the trader, is a breadth-first search over this grid. A
 * map that generates a spot nobody can reach is a bug that only shows up
 * as bots standing still, so the reachability of every working spot is
 * checked one at a time, by name.
 *
 * The maps are generated from a fixed seed, so all of this is deterministic.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  T,
  canStand,
  dist2,
  facingTile,
  findPath,
  getMap,
  isBlocking,
  mulberry32,
  tileAt,
  type GameMap,
} from "../../web/src/shared/maps";

const meadow = getMap("meadow");
const den = getMap("den");

const centre = (x: number, y: number) => ({ x: x + 0.5, y: y + 0.5 });
const spawnOf = (m: GameMap) => centre(m.spawn.x, m.spawn.y);

/**
 * Spots whose stand tile cannot be reached from the meadow spawn.
 *
 * Empty, and it must stay empty. It held pond_3 once: the pond's shore ring
 * made (42,9) and (42,11) blocking, water sat at (41,10), the tree line
 * owned x >= 44, and two of the forty decorative trees landed on (43,9)
 * and (43,13), leaving a four-tile pocket nobody could walk into. The fix
 * in `buildMeadow` clears the lane at x=43 after the decoration, and the
 * test below is what stops the scatter closing it again.
 */
const UNREACHABLE_SPOTS: Record<string, string> = {};

// ── The grid itself ─────────────────────────────────────────────────

test("the tile table is a set of distinct ids", () => {
  const ids = Object.values(T);
  assert.equal(new Set(ids).size, ids.length, "two tiles share an id");
  for (const id of ids) assert.ok(Number.isInteger(id) && id >= 0 && id < 256, `${id} does not fit in a Uint8Array`);
});

test("blocking is what the game says it is", () => {
  for (const t of [T.WATER, T.SHORE, T.TREE, T.BUSH, T.ROCK, T.FENCE, T.WALL, T.ROOF, T.DOOR, T.STONE, T.VOID, T.SIGN, T.BOARD, T.NEST]) {
    assert.ok(isBlocking(t), `${t} should block`);
  }
  for (const t of [T.GRASS, T.FLOWERS, T.PATH, T.DIRT, T.PLANK, T.GATE, T.TALLGRASS]) {
    assert.ok(!isBlocking(t), `${t} should be walkable`);
  }
});

test("tileAt is VOID outside the grid", () => {
  assert.equal(tileAt(meadow, -1, 0), T.VOID);
  assert.equal(tileAt(meadow, 0, -1), T.VOID);
  assert.equal(tileAt(meadow, meadow.width, 0), T.VOID);
  assert.equal(tileAt(meadow, 0, meadow.height), T.VOID);
  assert.ok(!canStand(meadow, -0.5, 5), "nobody stands outside the map");
});

test("both maps are built once and always the same", () => {
  assert.equal(getMap("meadow"), meadow, "getMap should hand back the cached map");
  assert.equal(getMap("den"), den);
  for (const m of [meadow, den]) {
    assert.equal(m.tiles.length, m.width * m.height);
    assert.ok(canStand(m, spawnOf(m).x, spawnOf(m).y), `${m.id}: you cannot stand on the spawn`);
  }
  assert.equal(meadow.spots.length, 12, "the meadow has twelve working spots");
  assert.equal(den.spots.length, 0);
  assert.equal(meadow.wild, true);
  assert.equal(den.wild, false);
});

test("mulberry32 is deterministic and stays in range", () => {
  const a = mulberry32(20260908);
  const b = mulberry32(20260908);
  for (let i = 0; i < 100; i++) {
    const v = a();
    assert.equal(v, b(), "the same seed diverged");
    assert.ok(v >= 0 && v < 1, `${v} is out of range`);
  }
  assert.notEqual(mulberry32(1)(), mulberry32(2)(), "two seeds gave the same first number");
});

// ── findPath ────────────────────────────────────────────────────────

test("findPath returns null into a blocked tile", () => {
  const from = spawnOf(meadow);
  const blocked: Array<[number, number, string]> = [
    [0, 0, "the corner of the tree line"],
    [35, 10, "the middle of the pond"],
    [meadow.width - 1, meadow.height - 1, "the far corner"],
  ];
  for (const [x, y, what] of blocked) {
    assert.ok(isBlocking(tileAt(meadow, x, y)), `${what} at (${x},${y}) is not actually blocked`);
    assert.equal(findPath(meadow, from, centre(x, y)), null, `walked into ${what}`);
  }
  // Out-of-range targets are clamped onto the edge, which is tree line.
  assert.equal(findPath(meadow, from, { x: -50, y: -50 }), null);
  assert.equal(findPath(meadow, from, { x: 9_999, y: 9_999 }), null);
});

test("findPath returns an empty array for the tile you are already on", () => {
  const from = spawnOf(meadow);
  assert.deepEqual(findPath(meadow, from, from), []);
  // Anywhere inside the same tile counts as the same tile.
  assert.deepEqual(findPath(meadow, { x: 22.1, y: 21.9 }, { x: 22.9, y: 21.05 }), []);
  assert.deepEqual(findPath(den, spawnOf(den), spawnOf(den)), []);
});

test("a path is contiguous, standable, and ends where it was asked to", () => {
  const from = spawnOf(meadow);
  const targets = [
    ...meadow.spots.filter((s) => !UNREACHABLE_SPOTS[s.id]).map((s) => centre(s.standX, s.standY)),
    centre(2, 18), // the west gate
    centre(20, 10), // in front of the trader
    centre(9, 12), // the thicket hollow
  ];

  for (const to of targets) {
    const path = findPath(meadow, from, to)!;
    assert.ok(path !== null, `no route to ${to.x},${to.y}`);
    assert.ok(path.length > 0);

    let prev = from;
    for (const step of path) {
      // Every step is one tile, on an axis, from the one before it.
      const dx = Math.abs(Math.floor(step.x) - Math.floor(prev.x));
      const dy = Math.abs(Math.floor(step.y) - Math.floor(prev.y));
      assert.equal(dx + dy, 1, `jumped from (${prev.x},${prev.y}) to (${step.x},${step.y})`);

      // Every tile on the way is one you can actually stand on.
      assert.ok(canStand(meadow, step.x, step.y), `step (${step.x},${step.y}) is not standable`);

      // Steps are tile centres, which is what the bots steer towards.
      assert.equal(step.x % 1, 0.5, `step x ${step.x} is not a tile centre`);
      assert.equal(step.y % 1, 0.5, `step y ${step.y} is not a tile centre`);
      prev = step;
    }

    const last = path[path.length - 1];
    assert.equal(Math.floor(last.x), Math.floor(to.x), "the path does not end on the target tile");
    assert.equal(Math.floor(last.y), Math.floor(to.y));

    // Breadth-first, so it is never shorter than walking straight there.
    const manhattan = Math.abs(Math.floor(to.x) - Math.floor(from.x)) + Math.abs(Math.floor(to.y) - Math.floor(from.y));
    assert.ok(path.length >= manhattan, `${path.length} steps for a ${manhattan}-tile gap`);

    // No tile is visited twice: BFS marks as it goes.
    const seen = new Set(path.map((p) => `${p.x},${p.y}`));
    assert.equal(seen.size, path.length, "the path doubles back on itself");
  }
});

test("findPath is symmetric: everywhere you can reach, you can come back from", () => {
  const from = spawnOf(meadow);
  for (const s of meadow.spots) {
    if (UNREACHABLE_SPOTS[s.id]) continue;
    const to = centre(s.standX, s.standY);
    const out = findPath(meadow, from, to);
    const back = findPath(meadow, to, from);
    assert.ok(out !== null && back !== null, `${s.id} is one-way`);
    assert.equal(out!.length, back!.length, `${s.id}: the walk home is a different length`);
  }
});

test("every working spot can be reached from the meadow spawn", async (t) => {
  const from = spawnOf(meadow);
  assert.equal(meadow.spots.length, 12);

  for (const spot of meadow.spots) {
    const skip = UNREACHABLE_SPOTS[spot.id];
    await t.test(`${spot.id} (${spot.job})`, { skip: skip ?? false }, () => {
      // The tile the critter works is the bush, shore or rock itself, so it
      // is meant to be blocking; the stand tile beside it is not.
      assert.ok(isBlocking(tileAt(meadow, spot.x, spot.y)), `${spot.id}: the work tile should be scenery`);
      assert.ok(canStand(meadow, spot.standX + 0.5, spot.standY + 0.5), `${spot.id}: cannot stand at the spot`);
      // The stand tile is next to the tile being worked.
      assert.equal(dist2(spot.x, spot.y, spot.standX, spot.standY), 1, `${spot.id}: stand tile is not adjacent`);
      assert.ok(spot.capacity > 0);

      const path = findPath(meadow, from, centre(spot.standX, spot.standY));
      assert.ok(path !== null, `${spot.id}: no way there from the spawn`);
      assert.ok(path!.length > 0);
      for (const step of path!) assert.ok(canStand(meadow, step.x, step.y));
    });
  }
});

test("the west gate is reachable, and it leads to the den", () => {
  const gate = meadow.interactables.find((i) => i.kind === "gate" && i.to === "den");
  assert.ok(gate, "the meadow has no gate to the den");
  assert.ok(canStand(meadow, gate!.x + 0.5, gate!.y + 0.5), "you cannot stand on the gate tile");
  assert.equal(tileAt(meadow, gate!.x, gate!.y), T.GATE);

  const path = findPath(meadow, spawnOf(meadow), centre(gate!.x, gate!.y));
  assert.ok(path !== null, "no route from the spawn to the west gate");
  for (const step of path!) assert.ok(canStand(meadow, step.x, step.y));
  assert.equal(Math.floor(path![path!.length - 1].x), gate!.x);
  assert.equal(Math.floor(path![path!.length - 1].y), gate!.y);

  // And back again from the den side.
  const home = den.interactables.find((i) => i.kind === "gate" && i.to === "meadow")!;
  assert.ok(home);
  const back = findPath(den, spawnOf(den), centre(home.x, home.y));
  assert.ok(back !== null, "no route from the den spawn to the way out");
});

test("the trader, the hatcher and the den board can all be walked up to", () => {
  const from = spawnOf(meadow);
  for (const npc of meadow.npcs) {
    // Bots stand a tile below an NPC to talk to it, so that is the tile
    // that has to be reachable — not the one the NPC is drawn on.
    const talk = centre(npc.x, npc.y + 1);
    const path = findPath(meadow, from, talk);
    assert.ok(path !== null, `no route to stand in front of ${npc.name} at (${npc.x},${npc.y + 1})`);
  }
  const board = den.interactables.find((i) => i.kind === "board")!;
  const beside = findPath(den, spawnOf(den), centre(board.x - 1, board.y));
  assert.ok(beside !== null, "no route to the den board");
});

// ── canStand and facing ─────────────────────────────────────────────

test("canStand refuses to put a foot in scenery", () => {
  assert.ok(!canStand(meadow, 35.5, 10.5), "standing in the pond");
  assert.ok(!canStand(meadow, 0.5, 0.5), "standing in a tree");
  assert.ok(canStand(meadow, 22.5, 21.5), "the spawn should be walkable");
  assert.ok(canStand(meadow, 2.5, 18.5), "the gate should be walkable");

  // The foot box is wider than a point, so a tile centre next to a wall is
  // fine but a position pressed up against it is not.
  const water = { x: 35, y: 10 };
  assert.ok(!canStand(meadow, water.x + 0.5, water.y + 0.5));
});

test("every standable tile in the meadow agrees with isBlocking at its centre", () => {
  let standable = 0;
  for (let y = 0; y < meadow.height; y++) {
    for (let x = 0; x < meadow.width; x++) {
      const ok = canStand(meadow, x + 0.5, y + 0.5);
      assert.equal(ok, !isBlocking(tileAt(meadow, x, y)), `(${x},${y}) disagrees`);
      if (ok) standable++;
    }
  }
  assert.ok(standable > 500, `only ${standable} standable tiles in a ${meadow.width}x${meadow.height} meadow`);
});

test("facingTile points at the neighbour it names", () => {
  assert.deepEqual(facingTile(5.5, 5.5, "up"), { x: 5, y: 4 });
  assert.deepEqual(facingTile(5.5, 5.5, "down"), { x: 5, y: 6 });
  assert.deepEqual(facingTile(5.5, 5.5, "left"), { x: 4, y: 5 });
  assert.deepEqual(facingTile(5.5, 5.5, "right"), { x: 6, y: 5 });
  // The position is floored first, so anywhere in a tile gives the same answer.
  assert.deepEqual(facingTile(5.99, 5.01, "up"), { x: 5, y: 4 });
});

test("dist2 is the squared distance, so comparisons never take a square root", () => {
  assert.equal(dist2(0, 0, 3, 4), 25);
  assert.equal(dist2(2, 2, 2, 2), 0);
  assert.equal(dist2(1, 1, 0, 1), 1);
});
