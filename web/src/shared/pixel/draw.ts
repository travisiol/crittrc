/**
 * Browser-side rasteriser for the string sprites and the procedural
 * tileset. Everything renders once into small offscreen canvases and is
 * blitted from there, so the per-frame cost is one drawImage per entity.
 *
 * This file touches `document`, so it must only be imported from client
 * code (the world server imports the data files next to it, never this).
 */

import { T } from "../maps";
import type { Facing } from "../maps";
import type { Look } from "../protocol";
import { mulberry32 } from "../maps";
import {
  CRITTER_SPRITES,
  EGG,
  EYE_COLORS,
  HAIR_COLORS,
  HAT_COLORS,
  KEEPER_HATS,
  KEEPER_HEAD,
  KEEPER_LEGS,
  KEEPER_TORSO,
  OUTFIT_COLORS,
  OUTLINE,
  ROD,
  SHOE,
  SKIN_COLORS,
  type Grid,
  type Palette,
} from "./sprites";

export const TILE = 16;
export const KEEPER_W = 16;
export const KEEPER_H = 24;

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

function ctx2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("2d context unavailable");
  ctx.imageSmoothingEnabled = false;
  return ctx;
}

/** Paint a grid onto a context at (ox, oy). Unknown letters are skipped. */
export function paintGrid(
  ctx: CanvasRenderingContext2D,
  grid: Grid,
  palette: Palette,
  ox = 0,
  oy = 0,
  flip = false,
) {
  for (let y = 0; y < grid.length; y++) {
    const row = grid[y];
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      if (ch === ".") continue;
      const color = palette[ch];
      if (!color) continue;
      ctx.fillStyle = color;
      const px = flip ? row.length - 1 - x : x;
      ctx.fillRect(ox + px, oy + y, 1, 1);
    }
  }
}

export function renderGrid(grid: Grid, palette: Palette, flip = false): HTMLCanvasElement {
  const w = grid.reduce((m, r) => Math.max(m, r.length), 0);
  const c = makeCanvas(w, grid.length);
  paintGrid(ctx2d(c), grid, palette, 0, 0, flip);
  return c;
}

// ── Critters ────────────────────────────────────────────────────────

const critterCache = new Map<string, HTMLCanvasElement>();

export function critterSprite(species: number, facing: Facing): HTMLCanvasElement {
  const key = `${species}:${facing === "left" ? "L" : "R"}`;
  let c = critterCache.get(key);
  if (!c) {
    const def = CRITTER_SPRITES[species - 1] ?? CRITTER_SPRITES[0];
    c = renderGrid(def.grid, def.palette, facing === "left");
    critterCache.set(key, c);
  }
  return c;
}

let eggCanvas: HTMLCanvasElement | null = null;
export function eggSprite(): HTMLCanvasElement {
  if (!eggCanvas) eggCanvas = renderGrid(EGG.grid, EGG.palette);
  return eggCanvas;
}

// ── Keeper ──────────────────────────────────────────────────────────

const keeperCache = new Map<string, HTMLCanvasElement>();

export function keeperPalette(look: Look): Palette {
  const outfit = OUTFIT_COLORS[look.outfit % OUTFIT_COLORS.length];
  return {
    K: OUTLINE,
    h: HAIR_COLORS[look.hair % HAIR_COLORS.length],
    s: SKIN_COLORS[look.skin % SKIN_COLORS.length],
    E: EYE_COLORS[look.eyes % EYE_COLORS.length],
    o: outfit[0],
    p: outfit[1],
    S: SHOE,
  };
}

/**
 * A keeper frame: head for the facing, hat on top, torso, one of three leg
 * frames. `facing: "left"` is the flipped side view.
 */
export function keeperSprite(look: Look, facing: Facing, legFrame: number): HTMLCanvasElement {
  const key = `${look.skin}${look.eyes}${look.outfit}${look.hair}${look.hat}:${facing}:${legFrame}`;
  let c = keeperCache.get(key);
  if (c) return c;
  c = makeCanvas(KEEPER_W, KEEPER_H);
  const ctx = ctx2d(c);
  const pal = keeperPalette(look);
  const flip = facing === "left";
  const head = facing === "up" ? KEEPER_HEAD.back : facing === "down" ? KEEPER_HEAD.front : KEEPER_HEAD.side;
  paintGrid(ctx, head, pal, 0, 0, flip);
  paintGrid(ctx, KEEPER_TORSO, pal, 0, 13, flip);
  paintGrid(ctx, KEEPER_LEGS[legFrame % KEEPER_LEGS.length], pal, 0, 19, flip);
  const hat = KEEPER_HATS[look.hat % KEEPER_HATS.length];
  if (hat.length) {
    const [hc, hd] = HAT_COLORS[look.hat % HAT_COLORS.length];
    paintGrid(ctx, hat, { K: OUTLINE, H: hc, h: hd }, 0, 0, flip);
  }
  keeperCache.set(key, c);
  return c;
}

let rodCanvas: HTMLCanvasElement | null = null;
export function rodSprite(): HTMLCanvasElement {
  if (!rodCanvas) rodCanvas = renderGrid(ROD.grid, ROD.palette);
  return rodCanvas;
}

// ── Tileset ─────────────────────────────────────────────────────────

export const TILE_VARIANTS = 4;
const TILE_COUNT = 21;

type Painter = (ctx: CanvasRenderingContext2D, rnd: () => number, variant: number) => void;

const C = {
  grass: "#79c14f",
  grassDark: "#5ea63c",
  grassLight: "#9ad86a",
  blade: "#4f9634",
  water: "#4fa9e0",
  waterLight: "#8fd0f5",
  waterDark: "#3d8fc6",
  shore: "#8fcbee",
  sand: "#e6d69a",
  path: "#d9c9a3",
  cobble: "#cbb98f",
  cobbleDark: "#b8a77e",
  dirt: "#b8905a",
  dirtDark: "#9c7646",
  dirtLight: "#c9a06a",
  canopy: "#3e8a3a",
  canopyLight: "#57a84a",
  canopyDark: "#2b5e28",
  trunk: "#6b4426",
  bush: "#3f7f37",
  berry: "#d8452e",
  rock: "#8a8f96",
  rockLight: "#b3b7bd",
  rockDark: "#5c6169",
  wood: "#a9713f",
  woodLight: "#c58b52",
  woodDark: "#7a4f2c",
  wall: "#c9a06a",
  wallLine: "#a8834f",
  roof: "#c4553a",
  roofDark: "#a3432c",
  roofLight: "#d96a4c",
  door: "#5a3a1e",
  doorDark: "#3d2612",
  knob: "#f2c14e",
  stone: "#9a9ea6",
  stoneDark: "#6a6f78",
  moss: "#5f9b3a",
  void: "#1a2a17",
  straw: "#d9b566",
  strawDark: "#8a6a30",
  paper: "#fbf6e6",
  pink: "#ff8fb0",
};

const px = (ctx: CanvasRenderingContext2D, x: number, y: number, color: string, w = 1, h = 1) => {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
};

const blob = (
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  color: string,
) => {
  ctx.fillStyle = color;
  for (let y = 0; y < TILE; y++)
    for (let x = 0; x < TILE; x++) {
      const dx = (x + 0.5 - cx) / rx;
      const dy = (y + 0.5 - cy) / ry;
      if (dx * dx + dy * dy <= 1) ctx.fillRect(x, y, 1, 1);
    }
};

function grassBase(ctx: CanvasRenderingContext2D, rnd: () => number) {
  px(ctx, 0, 0, C.grass, TILE, TILE);
  for (let i = 0; i < 7; i++) px(ctx, Math.floor(rnd() * TILE), Math.floor(rnd() * TILE), C.grassDark);
  for (let i = 0; i < 3; i++) px(ctx, Math.floor(rnd() * TILE), Math.floor(rnd() * TILE), C.grassLight);
}

const painters: Record<number, Painter> = {
  [T.GRASS]: (ctx, rnd) => grassBase(ctx, rnd),
  [T.FLOWERS]: (ctx, rnd) => {
    grassBase(ctx, rnd);
    const colors = ["#ffffff", C.pink, "#ffe066", "#a9d3ff"];
    for (let i = 0; i < 3; i++) {
      const x = 1 + Math.floor(rnd() * 13);
      const y = 1 + Math.floor(rnd() * 13);
      const col = colors[Math.floor(rnd() * colors.length)];
      px(ctx, x, y, col, 2, 2);
      px(ctx, x, y, "#fff7c2");
    }
  },
  [T.TALLGRASS]: (ctx, rnd) => {
    grassBase(ctx, rnd);
    for (let i = 0; i < 5; i++) {
      const x = Math.floor(rnd() * 15);
      const y = 3 + Math.floor(rnd() * 9);
      px(ctx, x, y, C.blade, 1, 4);
      px(ctx, x + 1, y + 1, C.grassDark, 1, 3);
    }
  },
  [T.WATER]: (ctx, rnd, frame) => {
    px(ctx, 0, 0, C.water, TILE, TILE);
    const off = frame * 2;
    px(ctx, (2 + off) % 16, 3, C.waterLight, 5, 1);
    px(ctx, (9 + off) % 16, 9, C.waterLight, 4, 1);
    px(ctx, (12 + off) % 16, 13, C.waterDark, 3, 1);
    px(ctx, (5 + off * 3) % 16, 6, C.waterDark, 2, 1);
    void rnd;
  },
  [T.SHORE]: (ctx, rnd, frame) => {
    px(ctx, 0, 0, C.shore, TILE, TILE);
    const off = frame * 2;
    px(ctx, (4 + off) % 16, 5, "#c6e8fa", 4, 1);
    px(ctx, (10 + off) % 16, 11, "#c6e8fa", 3, 1);
    for (let i = 0; i < 6; i++) px(ctx, Math.floor(rnd() * TILE), Math.floor(rnd() * TILE), C.sand);
  },
  [T.PATH]: (ctx, rnd) => {
    px(ctx, 0, 0, C.path, TILE, TILE);
    for (let i = 0; i < 5; i++) {
      const x = Math.floor(rnd() * 12);
      const y = Math.floor(rnd() * 12);
      px(ctx, x, y, C.cobble, 4, 3);
      px(ctx, x, y + 3, C.cobbleDark, 4, 1);
      px(ctx, x + 4, y + 1, C.cobbleDark, 1, 3);
    }
  },
  [T.DIRT]: (ctx, rnd) => {
    px(ctx, 0, 0, C.dirt, TILE, TILE);
    for (let i = 0; i < 8; i++) px(ctx, Math.floor(rnd() * TILE), Math.floor(rnd() * TILE), C.dirtDark);
    for (let i = 0; i < 4; i++) px(ctx, Math.floor(rnd() * TILE), Math.floor(rnd() * TILE), C.dirtLight, 2, 1);
  },
  [T.TREE]: (ctx, rnd, v) => {
    grassBase(ctx, rnd);
    px(ctx, 7, 12, C.trunk, 2, 4);
    blob(ctx, 8, 7, 7.5 + (v % 2) * 0.5, 6.5, C.canopyDark);
    blob(ctx, 8, 6.5, 6.5, 5.5, C.canopy);
    blob(ctx, 6, 5, 3, 2.5, C.canopyLight);
    for (let i = 0; i < 4; i++) px(ctx, 2 + Math.floor(rnd() * 12), 3 + Math.floor(rnd() * 8), C.canopyDark);
  },
  [T.BUSH]: (ctx, rnd) => {
    grassBase(ctx, rnd);
    blob(ctx, 8, 9.5, 7.5, 5.5, C.canopyDark);
    blob(ctx, 8, 9, 6.5, 4.5, C.bush);
    blob(ctx, 6, 7.5, 3, 2, C.canopyLight);
    for (let i = 0; i < 4; i++) px(ctx, 3 + Math.floor(rnd() * 10), 6 + Math.floor(rnd() * 6), C.berry);
  },
  [T.ROCK]: (ctx, rnd) => {
    px(ctx, 0, 0, C.dirt, TILE, TILE);
    for (let i = 0; i < 5; i++) px(ctx, Math.floor(rnd() * TILE), Math.floor(rnd() * TILE), C.dirtDark);
    blob(ctx, 8, 9.5, 7, 5.5, C.rockDark);
    blob(ctx, 8, 8.5, 6, 4.5, C.rock);
    blob(ctx, 6, 6.5, 3, 2, C.rockLight);
    px(ctx, 9, 10, C.rockDark, 3, 1);
  },
  [T.FENCE]: (ctx, rnd) => {
    grassBase(ctx, rnd);
    px(ctx, 0, 6, C.woodLight, TILE, 2);
    px(ctx, 0, 11, C.woodLight, TILE, 2);
    px(ctx, 0, 8, C.woodDark, TILE, 1);
    px(ctx, 0, 13, C.woodDark, TILE, 1);
    px(ctx, 2, 3, C.wood, 3, 12);
    px(ctx, 11, 3, C.wood, 3, 12);
    px(ctx, 2, 15, C.woodDark, 3, 1);
    px(ctx, 11, 15, C.woodDark, 3, 1);
  },
  [T.WALL]: (ctx) => {
    px(ctx, 0, 0, C.wall, TILE, TILE);
    for (let y = 3; y < TILE; y += 4) px(ctx, 0, y, C.wallLine, TILE, 1);
    px(ctx, 0, 0, C.woodDark, TILE, 1);
  },
  [T.ROOF]: (ctx, rnd, v) => {
    px(ctx, 0, 0, C.roof, TILE, TILE);
    for (let y = 0; y < TILE; y += 4) {
      px(ctx, 0, y + 3, C.roofDark, TILE, 1);
      for (let x = (y / 4 + v) % 2 ? 2 : 0; x < TILE; x += 4) px(ctx, x, y, C.roofDark, 1, 3);
    }
    for (let i = 0; i < 3; i++) px(ctx, Math.floor(rnd() * TILE), Math.floor(rnd() * TILE), C.roofLight, 2, 1);
  },
  [T.DOOR]: (ctx) => {
    painters[T.WALL](ctx, () => 0, 0);
    px(ctx, 4, 2, C.doorDark, 8, 14);
    px(ctx, 5, 3, C.door, 6, 13);
    px(ctx, 9, 9, C.knob);
    px(ctx, 6, 4, C.woodLight, 4, 1);
  },
  [T.STONE]: (ctx, rnd) => {
    px(ctx, 0, 0, C.path, TILE, TILE);
    blob(ctx, 8, 9, 7.5, 6.5, C.stoneDark);
    blob(ctx, 8, 8, 6.5, 5.5, C.stone);
    blob(ctx, 6, 6, 3, 2, "#c1c5cb");
    for (let i = 0; i < 4; i++) px(ctx, 3 + Math.floor(rnd() * 10), 6 + Math.floor(rnd() * 7), C.moss);
  },
  [T.VOID]: (ctx) => px(ctx, 0, 0, C.void, TILE, TILE),
  [T.SIGN]: (ctx, rnd) => {
    grassBase(ctx, rnd);
    px(ctx, 7, 8, C.woodDark, 2, 8);
    px(ctx, 3, 3, C.woodDark, 10, 6);
    px(ctx, 4, 4, C.wall, 8, 4);
    px(ctx, 5, 5, C.woodDark, 6, 1);
    px(ctx, 5, 7, C.woodDark, 4, 1);
  },
  [T.BOARD]: (ctx, rnd) => {
    grassBase(ctx, rnd);
    px(ctx, 2, 10, C.woodDark, 2, 6);
    px(ctx, 12, 10, C.woodDark, 2, 6);
    px(ctx, 1, 1, C.woodDark, 14, 10);
    px(ctx, 2, 2, C.wall, 12, 8);
    px(ctx, 3, 3, C.paper, 3, 3);
    px(ctx, 7, 3, C.pink, 3, 2);
    px(ctx, 11, 4, C.paper, 2, 3);
    px(ctx, 4, 7, C.paper, 5, 2);
  },
  [T.NEST]: (ctx, rnd) => {
    grassBase(ctx, rnd);
    blob(ctx, 8, 9, 7, 5, C.strawDark);
    blob(ctx, 8, 8.5, 6, 4, C.straw);
    blob(ctx, 8, 9, 3.5, 2.2, C.strawDark);
    for (let i = 0; i < 6; i++) px(ctx, 2 + Math.floor(rnd() * 12), 5 + Math.floor(rnd() * 8), "#f0d28a");
  },
  [T.PLANK]: (ctx) => {
    px(ctx, 0, 0, C.water, TILE, TILE);
    px(ctx, 0, 0, C.wood, TILE, TILE);
    for (let y = 3; y < TILE; y += 4) px(ctx, 0, y, C.woodDark, TILE, 1);
    px(ctx, 0, 0, C.woodDark, 1, TILE);
    px(ctx, 15, 0, C.woodDark, 1, TILE);
  },
  [T.GATE]: (ctx, rnd) => {
    painters[T.PATH](ctx, rnd, 0);
    px(ctx, 0, 0, C.wood, 3, TILE);
    px(ctx, 13, 0, C.wood, 3, TILE);
    px(ctx, 0, 15, C.woodDark, 3, 1);
    px(ctx, 13, 15, C.woodDark, 3, 1);
  },
};

let atlas: HTMLCanvasElement | null = null;

/**
 * The tileset atlas: one column per tile type, one row per variant. Water
 * and shore read the row as an animation frame; everything else as a
 * random variant chosen from the tile position.
 */
export function tileAtlas(): HTMLCanvasElement {
  if (atlas) return atlas;
  atlas = makeCanvas(TILE * TILE_COUNT, TILE * TILE_VARIANTS);
  const ctx = ctx2d(atlas);
  for (let t = 0; t < TILE_COUNT; t++) {
    const painter = painters[t] ?? painters[T.VOID];
    for (let v = 0; v < TILE_VARIANTS; v++) {
      const tile = makeCanvas(TILE, TILE);
      painter(ctx2d(tile), mulberry32(t * 97 + v * 13 + 1), v);
      ctx.drawImage(tile, t * TILE, v * TILE);
    }
  }
  return atlas;
}

export function hashXY(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return (h ^ (h >>> 16)) >>> 0;
}

export function isAnimatedTile(t: number): boolean {
  return t === T.WATER || t === T.SHORE;
}

// ── Item glyphs (8x8) ───────────────────────────────────────────────

const ITEM_COLORS: Record<string, [string, string]> = {
  berry: ["#c23b6b", "#f07aa0"],
  pod: ["#e0a030", "#ffd98a"],
  cap: ["#cfd8ff", "#ffffff"],
  truffle: ["#4a2e1a", "#7a5533"],
  leaves: ["#8a7a3a", "#b5a35a"],
  twig: ["#6b4426", "#8f5f3a"],
  nest: ["#b08a44", "#d9b566"],
  minnow: ["#7fb7d9", "#bfe0f0"],
  bass: ["#5f8f5a", "#a3c99a"],
  pike: ["#8fb5c9", "#e2f2f8"],
  koi: ["#e0a030", "#ffd23f"],
  boot: ["#5a3a1e", "#8a6a3a"],
  can: ["#8a8f96", "#c1c5cb"],
  weed: ["#3f7f37", "#7bd151"],
  copper: ["#b86a3a", "#e0925a"],
  silver: ["#a9adb5", "#e8eaee"],
  opal: ["#e0533c", "#ffb08a"],
  shard: ["#7ee0d0", "#e8fffb"],
  gravel: ["#6a6f78", "#9a9ea6"],
  nail: ["#7a4a2a", "#a9713f"],
  pot: ["#a86b3a", "#d9a066"],
  tuft: ["#5f9b3a", "#8fcc5a"],
  pearl: ["#dfe6ee", "#ffffff"],
  stub: ["#f2c14e", "#fff2a8"],
  flint: ["#3a3d44", "#8a8f96"],
  dust: ["#e8c66a", "#fff2a8"],
  feather: ["#f6f4ee", "#ffffff"],
  treat: ["#d8452e", "#ffb08a"],
  gold: ["#e0a030", "#ffd23f"],
};

const GLYPH_SHAPES: Record<string, Grid> = {
  round: ["..aaaa..", ".aabbaa.", "aabbbaaa", "aabbaaaa", "aaaaaaaa", "aaaaaaaa", ".aaaaaa.", "..aaaa.."],
  fish: ["........", "...aaa.a", "..abbaaa", ".aaaaaaa", "..aaaaaa", "...aaa.a", "........", "........"],
  gem: ["...aa...", "..abba..", ".abbbaa.", "aabbaaaa", ".aaaaaa.", "..aaaa..", "...aa...", "........"],
  junk: ["........", ".aa..aa.", "..aaaa..", "..abba..", "..aaaa..", ".aa..aa.", "........", "........"],
  leaf: [".......a", "....aaba", "...abbaa", "..abbaaa", ".aabaaa.", "aaaaaa..", "aa......", "........"],
  bar: ["........", "........", "aaaaaaaa", "abbbbbba", "aaaaaaaa", "........", "........", "........"],
  star: ["...aa...", "...ab...", ".aabbaa.", "aabbbbaa", ".aabbaa.", "..a..a..", ".a....a.", "........"],
  feather: [".....aa.", "....abba", "...abba.", "..abba..", ".abba...", "abba....", "aa......", "........"],
  treat: ["........", ".aaaaaa.", "abbabbba", "aabaabaa", "abbabbba", ".aaaaaa.", "........", "........"],
};

const GLYPH_SHAPE_BY_KEY: Record<string, string> = {
  berry: "round",
  pod: "round",
  cap: "round",
  truffle: "round",
  leaves: "leaf",
  twig: "bar",
  nest: "junk",
  minnow: "fish",
  bass: "fish",
  pike: "fish",
  koi: "fish",
  boot: "junk",
  can: "junk",
  weed: "leaf",
  copper: "gem",
  silver: "gem",
  opal: "gem",
  shard: "star",
  gravel: "junk",
  nail: "bar",
  pot: "junk",
  tuft: "leaf",
  pearl: "round",
  stub: "bar",
  flint: "gem",
  dust: "star",
  feather: "feather",
  treat: "treat",
  gold: "round",
};

const glyphCache = new Map<string, HTMLCanvasElement>();

export function itemGlyph(glyph: string): HTMLCanvasElement {
  let c = glyphCache.get(glyph);
  if (c) return c;
  const [a, b] = ITEM_COLORS[glyph] ?? ["#888", "#ccc"];
  const shape = GLYPH_SHAPES[GLYPH_SHAPE_BY_KEY[glyph] ?? "round"];
  c = renderGrid(shape, { a, b });
  glyphCache.set(glyph, c);
  return c;
}
