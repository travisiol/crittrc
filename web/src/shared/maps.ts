import type { JobKind } from "./species";

/**
 * The two places you can stand in. Maps are generated in code from a seed
 * rather than drawn by hand, so the server and every client build the same
 * grid from the same function and nothing has to be shipped as an asset.
 */

export const T = {
  GRASS: 0,
  FLOWERS: 1,
  WATER: 2,
  SHORE: 3,
  PATH: 4,
  DIRT: 5,
  TREE: 6,
  BUSH: 7,
  ROCK: 8,
  FENCE: 9,
  WALL: 10,
  ROOF: 11,
  DOOR: 12,
  STONE: 13,
  VOID: 14,
  SIGN: 15,
  BOARD: 16,
  NEST: 17,
  PLANK: 18,
  GATE: 19,
  TALLGRASS: 20,
} as const;

export type Tile = (typeof T)[keyof typeof T];

const BLOCKING = new Set<number>([
  T.WATER,
  T.SHORE,
  T.TREE,
  T.BUSH,
  T.ROCK,
  T.FENCE,
  T.WALL,
  T.ROOF,
  T.DOOR,
  T.STONE,
  T.VOID,
  T.SIGN,
  T.BOARD,
  T.NEST,
]);

export function isBlocking(tile: number): boolean {
  return BLOCKING.has(tile);
}

export type MapId = "meadow" | "den";

export interface Spot {
  id: string;
  job: JobKind;
  /** The tile the critter works on (a bush, a shore tile, a rock). */
  x: number;
  y: number;
  /** Where a working critter stands. */
  standX: number;
  standY: number;
  capacity: number;
}

export interface Npc {
  key: "trader" | "hatcher" | "warden" | "angler";
  name: string;
  x: number;
  y: number;
  facing: Facing;
}

export interface Interactable {
  kind: "gate" | "board" | "sign" | "door";
  x: number;
  y: number;
  label: string;
  /** For gates: where you end up. */
  to?: MapId;
  text?: string;
}

export interface GameMap {
  id: MapId;
  name: string;
  width: number;
  height: number;
  tiles: Uint8Array;
  spawn: { x: number; y: number };
  spots: Spot[];
  npcs: Npc[];
  interactables: Interactable[];
  /** Tiles wild critters may wander on. */
  wild: boolean;
}

export type Facing = "up" | "down" | "left" | "right";

/** Deterministic PRNG so decoration is identical everywhere. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Grid {
  tiles: Uint8Array;
  constructor(
    public width: number,
    public height: number,
    fill: number,
  ) {
    this.tiles = new Uint8Array(width * height).fill(fill);
  }
  get(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return T.VOID;
    return this.tiles[y * this.width + x];
  }
  set(x: number, y: number, t: number) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    this.tiles[y * this.width + x] = t;
  }
  rect(x0: number, y0: number, x1: number, y1: number, t: number) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.set(x, y, t);
  }
  ellipse(cx: number, cy: number, rx: number, ry: number, t: number) {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x - cx) / rx;
        const dy = (y - cy) / ry;
        if (dx * dx + dy * dy <= 1) this.set(x, y, t);
      }
  }
  /** Paint `t` on every walkable tile that touches a `target` tile. */
  ring(target: number, t: number) {
    const out: Array<[number, number]> = [];
    for (let y = 0; y < this.height; y++)
      for (let x = 0; x < this.width; x++) {
        if (this.get(x, y) !== T.GRASS && this.get(x, y) !== T.FLOWERS) continue;
        let touch = false;
        for (let dy = -1; dy <= 1 && !touch; dy++)
          for (let dx = -1; dx <= 1; dx++)
            if (this.get(x + dx, y + dy) === target) {
              touch = true;
              break;
            }
        if (touch) out.push([x, y]);
      }
    for (const [x, y] of out) this.set(x, y, t);
  }
  /** Straight or L-shaped path between two points. */
  path(x0: number, y0: number, x1: number, y1: number, t: number = T.PATH) {
    let x = x0;
    let y = y0;
    while (x !== x1) {
      if (!isBlocking(this.get(x, y))) this.set(x, y, t);
      x += Math.sign(x1 - x);
    }
    while (y !== y1) {
      if (!isBlocking(this.get(x, y))) this.set(x, y, t);
      y += Math.sign(y1 - y);
    }
    if (!isBlocking(this.get(x, y))) this.set(x, y, t);
  }
  hut(x: number, y: number, w: number, h: number, doorOffset: number) {
    // Roof on the top rows, wall on the bottom two, door in the wall.
    this.rect(x, y, x + w - 1, y + h - 3, T.ROOF);
    this.rect(x, y + h - 2, x + w - 1, y + h - 1, T.WALL);
    this.set(x + doorOffset, y + h - 1, T.DOOR);
  }
}

function buildMeadow(): GameMap {
  const W = 46;
  const H = 36;
  const g = new Grid(W, H, T.GRASS);
  const rnd = mulberry32(20260908);

  // Flower patches and tall grass scattered over the lawn.
  for (let i = 0; i < 140; i++) {
    const x = Math.floor(rnd() * W);
    const y = Math.floor(rnd() * H);
    g.set(x, y, rnd() < 0.6 ? T.FLOWERS : T.TALLGRASS);
  }

  // Tree line: two rows on every edge, a few more leaning in.
  g.rect(0, 0, W - 1, 1, T.TREE);
  g.rect(0, H - 2, W - 1, H - 1, T.TREE);
  g.rect(0, 0, 1, H - 1, T.TREE);
  g.rect(W - 2, 0, W - 1, H - 1, T.TREE);
  for (let i = 0; i < 40; i++) {
    const side = Math.floor(rnd() * 4);
    const along = 2 + Math.floor(rnd() * (side < 2 ? W - 4 : H - 4));
    if (side === 0) g.set(along, 2, T.TREE);
    if (side === 1) g.set(along, H - 3, T.TREE);
    if (side === 2) g.set(2, along, T.TREE);
    if (side === 3) g.set(W - 3, along, T.TREE);
  }

  // The pond, top right, with a shallow shore all round and a short dock.
  g.ellipse(35, 10, 6.5, 4.5, T.WATER);
  g.ring(T.WATER, T.SHORE);
  g.rect(31, 14, 31, 15, T.PLANK);

  // The thicket, left: dense bushes with a walkable hollow inside.
  for (let y = 7; y <= 16; y++)
    for (let x = 5; x <= 13; x++) {
      const inner = x >= 8 && x <= 10 && y >= 10 && y <= 13;
      if (!inner && rnd() < 0.82) g.set(x, y, T.BUSH);
    }
  g.rect(8, 10, 10, 13, T.DIRT);
  g.set(9, 17, T.DIRT);
  g.set(9, 16, T.DIRT);
  g.set(9, 15, T.DIRT);
  g.set(9, 14, T.DIRT);

  // The quarry, bottom right: a dirt floor with rock piles.
  g.rect(31, 24, 42, 32, T.DIRT);
  for (let i = 0; i < 26; i++) {
    const x = 31 + Math.floor(rnd() * 12);
    const y = 24 + Math.floor(rnd() * 9);
    if (!(x >= 34 && x <= 38 && y >= 26 && y <= 30)) g.set(x, y, T.ROCK);
  }

  // Huts along the north: the trader and the hatchery.
  g.hut(17, 3, 6, 5, 3); // trader: door at (20,7)
  g.hut(25, 3, 6, 5, 2); // hatchery: door at (27,7)
  g.set(23, 8, T.SIGN);

  // The meeting stone in the middle of a paved plaza.
  g.ellipse(22, 18, 6.5, 4.5, T.PATH);
  g.rect(21, 17, 22, 18, T.STONE);

  // Paths from the plaza outward.
  g.path(22, 14, 20, 8); // to the trader door
  g.path(23, 14, 27, 8); // to the hatchery door
  g.path(28, 18, 31, 16); // to the dock
  g.path(16, 18, 9, 18); // to the thicket
  g.path(22, 22, 35, 25); // to the quarry
  g.path(16, 18, 4, 18); // to the gate

  // The den gate in the west tree line.
  g.rect(2, 16, 3, 16, T.FENCE);
  g.rect(2, 20, 3, 20, T.FENCE);
  g.set(2, 18, T.GATE);
  g.set(3, 17, T.SIGN);
  g.set(2, 17, T.FENCE);
  g.set(2, 19, T.FENCE);
  g.set(3, 19, T.FENCE);
  g.set(3, 16, T.FENCE);

  // The lane between the pond and the east tree line is the only way round
  // to the far bank, and the decorative tree scatter above is happy to
  // close it. Two trees at (43,9) and (43,13) once sealed the pond_3 spot
  // into a four-tile pocket nobody could reach. Keep the lane open on
  // purpose, after the decoration rather than before it. Nothing at x=43
  // can be shore: the water stops at x=41.
  for (let y = 4; y <= 20; y++) g.set(43, y, T.GRASS);

  // Fence the quarry lip so the path reads as the only way in.
  g.rect(31, 23, 42, 23, T.FENCE);
  g.set(35, 23, T.DIRT);
  g.set(36, 23, T.DIRT);

  const spots: Spot[] = [
    // Thicket: bushes on the rim of the hollow.
    { id: "thicket_1", job: "forage", x: 7, y: 11, standX: 8, standY: 11, capacity: 3 },
    { id: "thicket_2", job: "forage", x: 11, y: 11, standX: 10, standY: 11, capacity: 3 },
    { id: "thicket_3", job: "forage", x: 7, y: 13, standX: 8, standY: 13, capacity: 3 },
    { id: "thicket_4", job: "forage", x: 11, y: 13, standX: 10, standY: 13, capacity: 3 },
    // Pond: shore tiles reachable from the bank and the dock.
    { id: "pond_1", job: "fish", x: 31, y: 13, standX: 31, standY: 14, capacity: 3 },
    { id: "pond_2", job: "fish", x: 29, y: 10, standX: 28, standY: 10, capacity: 3 },
    { id: "pond_3", job: "fish", x: 41, y: 10, standX: 42, standY: 10, capacity: 3 },
    { id: "pond_4", job: "fish", x: 36, y: 15, standX: 36, standY: 16, capacity: 3 },
    // Quarry: rocks fixed at the centre so they are always there.
    { id: "quarry_1", job: "dig", x: 34, y: 27, standX: 35, standY: 27, capacity: 3 },
    { id: "quarry_2", job: "dig", x: 38, y: 27, standX: 37, standY: 27, capacity: 3 },
    { id: "quarry_3", job: "dig", x: 34, y: 30, standX: 35, standY: 30, capacity: 3 },
    { id: "quarry_4", job: "dig", x: 38, y: 30, standX: 37, standY: 30, capacity: 3 },
  ];
  for (const s of spots) {
    g.set(s.x, s.y, s.job === "forage" ? T.BUSH : s.job === "dig" ? T.ROCK : T.SHORE);
    if (s.job !== "fish") g.set(s.standX, s.standY, T.DIRT);
  }
  // Make sure the bank tiles the fishers stand on are walkable.
  g.set(31, 14, T.PLANK);
  g.set(28, 10, T.GRASS);
  g.set(42, 10, T.GRASS);
  g.set(36, 16, T.GRASS);
  // and the water tiles they face are water.
  g.set(31, 13, T.WATER);
  g.set(29, 10, T.WATER);
  g.set(41, 10, T.WATER);
  g.set(36, 15, T.WATER);
  for (const s of spots) if (s.job === "fish") g.set(s.x, s.y, T.WATER);

  const npcs: Npc[] = [
    { key: "trader", name: "TRADER", x: 20, y: 9, facing: "down" },
    { key: "hatcher", name: "HATCHER", x: 27, y: 9, facing: "down" },
    { key: "warden", name: "WARDEN", x: 5, y: 19, facing: "right" },
    { key: "angler", name: "ANGLER", x: 40, y: 15, facing: "up" },
  ];

  const interactables: Interactable[] = [
    { kind: "gate", x: 2, y: 18, label: "Go to your den", to: "den" },
    {
      kind: "sign",
      x: 3,
      y: 17,
      label: "Read",
      text: "WEST GATE - Your den is through here. Nobody else can follow.",
    },
    {
      kind: "sign",
      x: 23,
      y: 8,
      label: "Read",
      text: "TRADER buys what your critters bring back. HATCHERY is not open yet.",
    },
  ];

  return {
    id: "meadow",
    name: "The Meadow",
    width: W,
    height: H,
    tiles: g.tiles,
    spawn: { x: 22, y: 21 },
    spots,
    npcs,
    interactables,
    wild: true,
  };
}

function buildDen(): GameMap {
  const W = 26;
  const H = 20;
  const g = new Grid(W, H, T.GRASS);
  const rnd = mulberry32(7);

  for (let i = 0; i < 30; i++) g.set(Math.floor(rnd() * W), Math.floor(rnd() * H), T.FLOWERS);

  g.rect(0, 0, W - 1, 0, T.TREE);
  g.rect(0, 0, 0, H - 1, T.TREE);
  g.rect(W - 1, 0, W - 1, H - 1, T.TREE);
  g.rect(0, H - 1, W - 1, H - 1, T.FENCE);
  g.set(12, H - 1, T.GATE);
  g.set(13, H - 1, T.GATE);

  // The house, top centre, with the board beside the door.
  g.hut(10, 2, 6, 5, 3);
  g.set(15, 7, T.BOARD);

  // A short path from the door down to the gate.
  g.path(13, 7, 13, H - 2);
  g.path(12, 7, 12, H - 2);

  // Three nests in a row on the left, a small pond on the right.
  g.set(4, 9, T.NEST);
  g.set(4, 12, T.NEST);
  g.set(4, 15, T.NEST);
  g.rect(3, 8, 6, 8, T.FENCE);
  g.rect(3, 16, 6, 16, T.FENCE);
  g.rect(6, 9, 6, 15, T.FENCE);
  g.set(6, 12, T.GRASS);
  g.ellipse(20, 12, 2.5, 2, T.WATER);
  g.ring(T.WATER, T.SHORE);

  return {
    id: "den",
    name: "Your Den",
    width: W,
    height: H,
    tiles: g.tiles,
    spawn: { x: 12, y: 16 },
    spots: [],
    npcs: [],
    interactables: [
      { kind: "gate", x: 12, y: H - 1, label: "Back to the meadow", to: "meadow" },
      { kind: "gate", x: 13, y: H - 1, label: "Back to the meadow", to: "meadow" },
      { kind: "board", x: 15, y: 7, label: "Read the board" },
      { kind: "door", x: 13, y: 6, label: "Knock", text: "The house is not open yet." },
    ],
    wild: false,
  };
}

const cache: Partial<Record<MapId, GameMap>> = {};

export function getMap(id: MapId): GameMap {
  if (!cache[id]) cache[id] = id === "meadow" ? buildMeadow() : buildDen();
  return cache[id]!;
}

export function tileAt(map: GameMap, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return T.VOID;
  return map.tiles[y * map.width + x];
}

/** Axis-aligned foot box test against the grid. Positions are in tiles. */
export function canStand(map: GameMap, x: number, y: number): boolean {
  const half = 0.3;
  const corners: Array<[number, number]> = [
    [x - half, y - 0.15],
    [x + half, y - 0.15],
    [x - half, y + 0.3],
    [x + half, y + 0.3],
  ];
  return corners.every(([cx, cy]) => !isBlocking(tileAt(map, Math.floor(cx), Math.floor(cy))));
}

/** The tile one step ahead of a position, given a facing. */
export function facingTile(x: number, y: number, facing: Facing): { x: number; y: number } {
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  switch (facing) {
    case "up":
      return { x: tx, y: ty - 1 };
    case "down":
      return { x: tx, y: ty + 1 };
    case "left":
      return { x: tx - 1, y: ty };
    case "right":
      return { x: tx + 1, y: ty };
  }
}

/**
 * Shortest walk between two tiles, as a list of tile centres to aim at.
 * A plain breadth-first search: the meadow is 46x36, so the whole grid is
 * cheaper to sweep than any heuristic would be to maintain. Returns null
 * when there is no way through.
 */
export function findPath(
  map: GameMap,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Array<{ x: number; y: number }> | null {
  const w = map.width;
  const h = map.height;
  const sx = Math.max(0, Math.min(w - 1, Math.floor(from.x)));
  const sy = Math.max(0, Math.min(h - 1, Math.floor(from.y)));
  const tx = Math.max(0, Math.min(w - 1, Math.floor(to.x)));
  const ty = Math.max(0, Math.min(h - 1, Math.floor(to.y)));
  const start = sy * w + sx;
  const target = ty * w + tx;
  if (start === target) return [];
  if (!canStand(map, tx + 0.5, ty + 0.5)) return null;

  const prev = new Int32Array(w * h).fill(-1);
  const seen = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  let head = 0;
  let tail = 0;
  queue[tail++] = start;
  seen[start] = 1;
  let found = false;

  while (head < tail) {
    const cur = queue[head++];
    if (cur === target) {
      found = true;
      break;
    }
    const cx = cur % w;
    const cy = (cur - cx) / w;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const idx = ny * w + nx;
      if (seen[idx]) continue;
      if (!canStand(map, nx + 0.5, ny + 0.5)) continue;
      seen[idx] = 1;
      prev[idx] = cur;
      queue[tail++] = idx;
    }
  }
  if (!found) return null;

  const path: Array<{ x: number; y: number }> = [];
  let cur = target;
  while (cur !== start) {
    const cx = cur % w;
    path.push({ x: cx + 0.5, y: (cur - cx) / w + 0.5 });
    cur = prev[cur];
    if (cur < 0) return null;
  }
  return path.reverse();
}

export function dist2(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}
