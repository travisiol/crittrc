/**
 * A living diorama: a slice of a real map with critters and keepers walking
 * around in it, drawn straight from the same tileset and sprites the game
 * uses. Nothing here talks to the server — it is scenery for the landing
 * page and the title screen, and it says so.
 */

import { canStand, getMap, mulberry32, type Facing, type GameMap, type MapId } from "../maps";
import type { Look } from "../protocol";
import { SPECIES } from "../species";
import { KEEPER_H, TILE, critterSprite, hashXY, isAnimatedTile, keeperSprite, tileAtlas } from "./draw";

export interface DioramaOptions {
  map?: MapId;
  /** Where to point the camera, in tiles. */
  center: { x: number; y: number };
  /** Art pixels per screen pixel. Integer, or the art stops being crisp. */
  scale?: number;
  critters?: number;
  keepers?: number;
  /** Slow horizontal sway, in tiles. */
  drift?: number;
  /** 0 = untouched, 1 = black. */
  dim?: number;
  pollen?: number;
  vignette?: boolean;
  seed?: number;
}

interface Walker {
  kind: "critter" | "keeper";
  species: number;
  look: Look;
  x: number;
  y: number;
  tx: number;
  ty: number;
  facing: Facing;
  moving: boolean;
  speed: number;
  nextThinkAt: number;
  phase: number;
}

interface Mote {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  size: number;
}

const LOOKS: Look[] = [
  { skin: 0, eyes: 1, outfit: 0, hair: 2, hat: 2 },
  { skin: 2, eyes: 0, outfit: 1, hair: 0, hat: 1 },
  { skin: 1, eyes: 2, outfit: 4, hair: 3, hat: 0 },
  { skin: 3, eyes: 0, outfit: 2, hair: 4, hat: 3 },
  { skin: 1, eyes: 1, outfit: 5, hair: 1, hat: 2 },
  { skin: 2, eyes: 2, outfit: 3, hair: 5, hat: 0 },
];

export class Diorama {
  private ctx: CanvasRenderingContext2D;
  private map: GameMap;
  private walkers: Walker[] = [];
  private motes: Mote[] = [];
  private width = 0;
  private height = 0;
  private raf = 0;
  private last = 0;
  private running = false;
  private rnd: () => number;

  constructor(
    private canvas: HTMLCanvasElement,
    private opts: DioramaOptions,
  ) {
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("no 2d context");
    this.ctx = ctx;
    this.map = getMap(opts.map ?? "meadow");
    this.rnd = mulberry32(opts.seed ?? 1312);
    this.populate();
    this.resize();
  }

  private populate() {
    const wantCritters = this.opts.critters ?? 8;
    const wantKeepers = this.opts.keepers ?? 3;
    const { x: cx, y: cy } = this.opts.center;
    const place = (kind: Walker["kind"], i: number) => {
      for (let tries = 0; tries < 400; tries++) {
        const x = cx + (this.rnd() - 0.5) * 22;
        const y = cy + (this.rnd() - 0.5) * 14;
        if (!canStand(this.map, x, y)) continue;
        this.walkers.push({
          kind,
          species: SPECIES[Math.floor(this.rnd() * SPECIES.length)].id,
          look: LOOKS[i % LOOKS.length],
          x,
          y,
          tx: x,
          ty: y,
          facing: "down",
          moving: false,
          speed: kind === "critter" ? 1.5 + this.rnd() : 2.4 + this.rnd(),
          nextThinkAt: this.rnd() * 3000,
          phase: this.rnd() * 1000,
        });
        return;
      }
    };
    for (let i = 0; i < wantCritters; i++) place("critter", i);
    for (let i = 0; i < wantKeepers; i++) place("keeper", i);
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.width = Math.floor(rect.width);
    this.height = Math.floor(rect.height);
    this.canvas.width = Math.floor(this.width * dpr);
    this.canvas.height = Math.floor(this.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.imageSmoothingEnabled = false;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const loop = (t: number) => {
      if (!this.running) return;
      this.frame(t);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  /** Draw a single frame without starting the loop (reduced motion). */
  still() {
    this.frame(performance.now());
  }

  private step(dt: number, now: number) {
    for (const w of this.walkers) {
      if (now >= w.nextThinkAt) {
        w.nextThinkAt = now + 1200 + this.rnd() * 4200;
        if (this.rnd() < 0.75) {
          const tx = w.x + (this.rnd() - 0.5) * 8;
          const ty = w.y + (this.rnd() - 0.5) * 6;
          if (canStand(this.map, tx, ty)) {
            w.tx = tx;
            w.ty = ty;
          }
        } else {
          w.tx = w.x;
          w.ty = w.y;
        }
      }
      const dx = w.tx - w.x;
      const dy = w.ty - w.y;
      const d = Math.hypot(dx, dy);
      if (d < 0.05) {
        w.moving = false;
        continue;
      }
      const step = Math.min(d, w.speed * dt);
      const nx = w.x + (dx / d) * step;
      const ny = w.y + (dy / d) * step;
      if (canStand(this.map, nx, ny)) {
        w.x = nx;
        w.y = ny;
        w.moving = true;
        w.facing = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up";
      } else {
        w.tx = w.x;
        w.ty = w.y;
        w.moving = false;
      }
    }

    const want = this.opts.pollen ?? 26;
    while (this.motes.length < want) {
      this.motes.push({
        x: this.rnd() * this.width,
        y: this.rnd() * this.height,
        vx: 4 + this.rnd() * 12,
        vy: -3 - this.rnd() * 8,
        life: 2 + this.rnd() * 6,
        size: this.rnd() < 0.75 ? 2 : 3,
      });
    }
    for (const m of this.motes) {
      m.x += m.vx * dt;
      m.y += (m.vy + Math.sin((m.x + m.y) * 0.02) * 6) * dt;
      m.life -= dt;
      if (m.life <= 0 || m.x > this.width + 8 || m.y < -8) {
        m.x = -8 + this.rnd() * 20;
        m.y = this.height * (0.3 + this.rnd() * 0.8);
        m.life = 3 + this.rnd() * 7;
      }
    }
  }

  private frame(t: number) {
    if (this.width === 0) this.resize();
    if (this.width === 0) return;
    const dt = Math.min(0.05, (t - this.last) / 1000);
    this.last = t;
    this.step(dt, t);

    const ctx = this.ctx;
    const s = this.opts.scale ?? 3;
    const ts = TILE * s;
    const drift = this.opts.drift ?? 0;
    const cx = this.opts.center.x + (drift ? Math.sin(t / 14000) * drift : 0);
    const cy = this.opts.center.y + (drift ? Math.cos(t / 21000) * drift * 0.35 : 0);

    const mapW = this.map.width * ts;
    const mapH = this.map.height * ts;
    let camX = cx * ts - this.width / 2;
    let camY = cy * ts - this.height / 2;
    camX = mapW <= this.width ? (mapW - this.width) / 2 : Math.max(0, Math.min(mapW - this.width, camX));
    camY = mapH <= this.height ? (mapH - this.height) / 2 : Math.max(0, Math.min(mapH - this.height, camY));
    camX = Math.round(camX);
    camY = Math.round(camY);

    ctx.fillStyle = "#1a2a17";
    ctx.fillRect(0, 0, this.width, this.height);

    const atlas = tileAtlas();
    const waterFrame = Math.floor(t / 350) % 4;
    const x0 = Math.max(0, Math.floor(camX / ts));
    const y0 = Math.max(0, Math.floor(camY / ts));
    const x1 = Math.min(this.map.width - 1, Math.ceil((camX + this.width) / ts));
    const y1 = Math.min(this.map.height - 1, Math.ceil((camY + this.height) / ts));
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const tile = this.map.tiles[y * this.map.width + x];
        const v = isAnimatedTile(tile) ? waterFrame : hashXY(x, y) % 4;
        ctx.drawImage(atlas, tile * TILE, v * TILE, TILE, TILE, Math.round(x * ts - camX), Math.round(y * ts - camY), ts, ts);
      }

    for (const w of [...this.walkers].sort((a, b) => a.y - b.y)) {
      const sx = Math.round(w.x * ts - camX);
      const sy = Math.round(w.y * ts - camY);
      if (sx < -3 * ts || sx > this.width + 3 * ts || sy < -3 * ts || sy > this.height + 3 * ts) continue;
      if (w.kind === "critter") {
        const bob = w.moving && Math.floor((t + w.phase) / 210) % 2 ? -s : 0;
        ctx.drawImage(critterSprite(w.species, w.facing), sx - 8 * s, sy - 14 * s + bob, 16 * s, 16 * s);
      } else {
        const leg = w.moving ? [0, 1, 0, 2][Math.floor((t + w.phase) / 130) % 4] : 0;
        ctx.drawImage(keeperSprite(w.look, w.facing, leg), sx - 8 * s, sy - KEEPER_H * s + 2 * s, 16 * s, KEEPER_H * s);
      }
    }

    // Pollen, over everything, warm and faint.
    ctx.fillStyle = "rgba(255, 246, 196, 0.75)";
    for (const m of this.motes) ctx.fillRect(Math.round(m.x), Math.round(m.y), m.size, m.size);

    if (this.opts.vignette !== false) {
      const g = ctx.createRadialGradient(
        this.width / 2,
        this.height / 2,
        Math.min(this.width, this.height) * 0.32,
        this.width / 2,
        this.height / 2,
        Math.max(this.width, this.height) * 0.78,
      );
      g.addColorStop(0, "rgba(20, 34, 18, 0)");
      g.addColorStop(1, "rgba(20, 34, 18, 0.55)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, this.width, this.height);
    }

    const dim = this.opts.dim ?? 0;
    if (dim > 0) {
      ctx.fillStyle = `rgba(16, 26, 14, ${dim})`;
      ctx.fillRect(0, 0, this.width, this.height);
    }
  }
}
