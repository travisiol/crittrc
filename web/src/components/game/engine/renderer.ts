import type { Facing, GameMap, Interactable, Spot } from "@/shared/maps";
import { tileAt } from "@/shared/maps";
import type { Look } from "@/shared/protocol";
import {
  KEEPER_H,
  TILE,
  critterSprite,
  hashXY,
  isAnimatedTile,
  keeperSprite,
  rodSprite,
  tileAtlas,
} from "@/shared/pixel/draw";
import type { ClientWorld } from "./state";
import { serverNow } from "./state";

/**
 * Draws one frame of the world into a canvas. All positions are in tiles;
 * the renderer turns them into screen pixels at an integer scale so the
 * art stays crisp. Nothing here changes state.
 */

export const NPC_LOOKS: Record<string, Look> = {
  trader: { skin: 1, eyes: 0, outfit: 3, hair: 1, hat: 2 },
  hatcher: { skin: 2, eyes: 1, outfit: 4, hair: 4, hat: 3 },
  warden: { skin: 0, eyes: 0, outfit: 0, hair: 0, hat: 1 },
  angler: { skin: 3, eyes: 2, outfit: 1, hair: 3, hat: 0 },
};

interface Drawable {
  y: number;
  draw: () => void;
}

export interface RenderOptions {
  nearSpot: Spot | null;
  target: Interactable | null;
  /** The wild critter the keeper could offer a treat to, if any. */
  nearWild: string | null;
  spectating: boolean;
}

const INK = "#1e2a1c";
const CREAM = "#f6f1e4";
const SUN = "#f5c542";

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  scale = 3;
  private font = "sans-serif";
  private width = 0;
  private height = 0;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("no 2d context");
    this.ctx = ctx;
    this.font = getComputedStyle(document.body).fontFamily || "sans-serif";
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.scale = rect.width < 720 ? 2 : 3;
    this.width = Math.floor(rect.width);
    this.height = Math.floor(rect.height);
    this.canvas.width = Math.floor(this.width * dpr);
    this.canvas.height = Math.floor(this.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.imageSmoothingEnabled = false;
  }

  /** Screen-space rectangle of the world, for hit tests from React. */
  viewport() {
    return { width: this.width, height: this.height, scale: this.scale };
  }

  render(w: ClientWorld, map: GameMap, opts: RenderOptions) {
    const ctx = this.ctx;
    const s = this.scale;
    const ts = TILE * s;
    const now = performance.now();
    const W = this.width;
    const H = this.height;

    // Camera: follow the keeper, or the free camera while watching. Clamp to
    // the map when the map is bigger than the screen; centre it otherwise.
    const focus = w.self ? { x: w.self.x, y: w.self.y } : w.camera;
    const mapW = map.width * ts;
    const mapH = map.height * ts;
    let camX = focus.x * ts - W / 2;
    let camY = focus.y * ts - H / 2;
    if (mapW <= W) camX = (mapW - W) / 2;
    else camX = Math.max(0, Math.min(mapW - W, camX));
    if (mapH <= H) camY = (mapH - H) / 2;
    else camY = Math.max(0, Math.min(mapH - H, camY));
    camX = Math.round(camX);
    camY = Math.round(camY);

    const toScreen = (x: number, y: number): [number, number] => [Math.round(x * ts - camX), Math.round(y * ts - camY)];

    ctx.fillStyle = "#1a2a17";
    ctx.fillRect(0, 0, W, H);

    // Ground.
    const atlas = tileAtlas();
    const waterFrame = Math.floor(now / 350) % 4;
    const x0 = Math.max(0, Math.floor(camX / ts));
    const y0 = Math.max(0, Math.floor(camY / ts));
    const x1 = Math.min(map.width - 1, Math.ceil((camX + W) / ts));
    const y1 = Math.min(map.height - 1, Math.ceil((camY + H) / ts));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const t = tileAt(map, x, y);
        const v = isAnimatedTile(t) ? waterFrame : hashXY(x, y) % 4;
        const [sx, sy] = toScreen(x, y);
        ctx.drawImage(atlas, t * TILE, v * TILE, TILE, TILE, sx, sy, ts, ts);
      }
    }

    // Spot markers within reach, and the one you could use right now.
    if (w.self) {
      for (const spot of map.spots) {
        const d = Math.hypot(spot.x + 0.5 - w.self.x, spot.y + 0.5 - w.self.y);
        if (d > 5) continue;
        const [sx, sy] = toScreen(spot.x, spot.y);
        const bob = Math.floor(now / 400) % 2 ? -s : 0;
        const load = w.spotLoad[spot.id] ?? 0;
        const near = opts.nearSpot?.id === spot.id;
        this.diamond(sx + ts / 2, sy - 3 * s + bob, s, near ? SUN : CREAM);
        if (load > 0) this.tag(`${load}/${spot.capacity}`, sx + ts / 2, sy - 8 * s + bob, 4 * s, CREAM);
        if (near) {
          ctx.strokeStyle = SUN;
          ctx.lineWidth = s;
          ctx.strokeRect(sx + s / 2, sy + s / 2, ts - s, ts - s);
        }
      }
      if (opts.target) {
        const [sx, sy] = toScreen(opts.target.x, opts.target.y);
        ctx.strokeStyle = SUN;
        ctx.lineWidth = s;
        ctx.strokeRect(sx + s / 2, sy + s / 2, ts - s, ts - s);
      }
    }

    // Entities, painter's order by feet position.
    const items: Drawable[] = [];

    for (const npc of map.npcs) {
      const look = NPC_LOOKS[npc.key];
      items.push({
        y: npc.y + 0.99,
        draw: () => {
          const [sx, sy] = toScreen(npc.x + 0.5, npc.y + 1);
          this.keeper(look, npc.facing, 0, sx, sy);
          if (npc.key === "angler") ctx.drawImage(rodSprite(), sx + 4 * s, sy - 14 * s, 8 * s, 8 * s);
          this.tag(`[NPC] ${npc.name}`, sx, sy - KEEPER_H * s - 3 * s, 5 * s, CREAM);
        },
      });
    }

    for (const p of w.players.values()) {
      items.push({
        y: p.dy,
        draw: () => {
          const [sx, sy] = toScreen(p.dx, p.dy);
          this.keeper(p.look, p.facing, p.moving ? this.walkFrame(now) : 0, sx, sy);
          this.tag(p.name, sx, sy - KEEPER_H * s - 3 * s, 5 * s, CREAM);
          if (p.bubble && p.bubble.until > Date.now()) this.bubble(p.bubble.text, sx, sy - KEEPER_H * s - 9 * s);
        },
      });
    }

    if (w.self) {
      const me = w.self;
      items.push({
        y: me.y,
        draw: () => {
          const [sx, sy] = toScreen(me.x, me.y);
          this.keeper(me.look, me.facing, me.moving ? this.walkFrame(now) : 0, sx, sy);
          this.tag(me.name, sx, sy - KEEPER_H * s - 3 * s, 5 * s, SUN);
          if (me.bubble && me.bubble.until > Date.now()) this.bubble(me.bubble.text, sx, sy - KEEPER_H * s - 9 * s);
        },
      });
    }

    const sNow = serverNow(w);
    for (const c of w.critters.values()) {
      items.push({
        y: c.dy - 0.01,
        draw: () => {
          const [sx, sy] = toScreen(c.dx, c.dy);
          const working = c.state === "work";
          const bob = c.moving || working ? (Math.floor(now / (working ? 160 : 220)) % 2 ? -s : 0) : 0;
          ctx.drawImage(critterSprite(c.species, c.facing), sx - 8 * s, sy - 14 * s + bob, 16 * s, 16 * s);
          const mine = w.self && c.owner === w.self.id;
          this.tag(c.name, sx, sy - 16 * s, 4 * s, mine ? SUN : CREAM);
          if (working && c.job) {
            const p = Math.max(0, Math.min(1, (sNow - c.job.startedAt) / (c.job.endsAt - c.job.startedAt)));
            this.bar(sx - 8 * s, sy + s, 16 * s, 2 * s, p);
          }
        },
      });
    }

    for (const c of w.wild.values()) {
      items.push({
        y: c.dy - 0.02,
        draw: () => {
          const [sx, sy] = toScreen(c.dx, c.dy);
          const bob = c.moving ? (Math.floor(now / 220) % 2 ? -s : 0) : 0;
          const courted = opts.nearWild === c.id;
          ctx.globalAlpha = courted ? 1 : 0.92;
          ctx.drawImage(critterSprite(c.species, c.facing), sx - 8 * s, sy - 14 * s + bob, 16 * s, 16 * s);
          ctx.globalAlpha = 1;
          // Trust only shows once somebody has started, so the meadow is
          // not covered in empty bars.
          if (c.trust > 0) this.bar(sx - 8 * s, sy + s, 16 * s, 2 * s, c.trust / 100);
          if (courted) {
            const wobble = Math.floor(now / 340) % 2 ? -s : 0;
            this.diamond(sx, sy - 18 * s + wobble, s, SUN);
          }
        },
      });
    }

    items.sort((a, b) => a.y - b.y);
    for (const it of items) it.draw();

    // Floating pickups.
    const nowMs = Date.now();
    for (const f of w.floaters) {
      const age = (nowMs - f.bornAt) / 1600;
      const [sx, sy] = toScreen(f.x, f.y);
      ctx.globalAlpha = 1 - age;
      this.tag(f.text, sx, sy - KEEPER_H * s - 12 * s - age * 14 * s, 5 * s, f.color);
      ctx.globalAlpha = 1;
    }

    if (opts.spectating) {
      ctx.fillStyle = "rgba(26, 42, 23, 0.18)";
      ctx.fillRect(0, 0, W, H);
    }
  }

  private walkFrame(now: number): number {
    return [0, 1, 0, 2][Math.floor(now / 120) % 4];
  }

  private keeper(look: Look, facing: Facing, legFrame: number, sx: number, sy: number) {
    const s = this.scale;
    const sprite = keeperSprite(look, facing, legFrame);
    // Feet at (sx, sy); the sprite is 16 wide and 24 tall.
    this.ctx.drawImage(sprite, sx - 8 * s, sy - KEEPER_H * s + 2 * s, 16 * s, KEEPER_H * s);
  }

  private tag(text: string, cx: number, cy: number, size: number, color: string) {
    const ctx = this.ctx;
    ctx.font = `${size}px ${this.font}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = INK;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [1, 1],
      [-1, -1],
    ]) {
      ctx.fillText(text, cx + dx, cy + dy);
    }
    ctx.fillStyle = color;
    ctx.fillText(text, cx, cy);
  }

  private bubble(text: string, cx: number, bottom: number) {
    const ctx = this.ctx;
    const s = this.scale;
    const size = 5 * s;
    ctx.font = `${size}px ${this.font}`;
    const w = Math.min(70 * s, ctx.measureText(text).width + 4 * s);
    const h = size + 3 * s;
    const x = Math.round(cx - w / 2);
    const y = Math.round(bottom - h);
    ctx.fillStyle = INK;
    ctx.fillRect(x - s, y - s, w + 2 * s, h + 2 * s);
    ctx.fillStyle = CREAM;
    ctx.fillRect(x, y, w, h);
    ctx.fillRect(cx - s, y + h, 2 * s, s);
    ctx.fillStyle = INK;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.fillText(text, cx, y + size);
    ctx.restore();
  }

  private bar(x: number, y: number, w: number, h: number, p: number) {
    const ctx = this.ctx;
    ctx.fillStyle = INK;
    ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
    ctx.fillStyle = "#3a4a36";
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = SUN;
    ctx.fillRect(x, y, Math.round(w * p), h);
  }

  private diamond(cx: number, cy: number, s: number, color: string) {
    const ctx = this.ctx;
    ctx.fillStyle = INK;
    ctx.fillRect(cx - 2 * s, cy - s, 4 * s, 2 * s);
    ctx.fillRect(cx - s, cy - 2 * s, 2 * s, 4 * s);
    ctx.fillStyle = color;
    ctx.fillRect(cx - s, cy - s, 2 * s, 2 * s);
  }
}
