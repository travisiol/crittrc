"use client";

import { useEffect, useRef } from "react";
import type { Facing, GameMap } from "@/shared/maps";
import { T, tileAt } from "@/shared/maps";
import type { Look } from "@/shared/protocol";
import {
  TILE,
  critterSprite,
  eggSprite,
  hashXY,
  isAnimatedTile,
  itemGlyph,
  keeperSprite,
  tileAtlas,
} from "@/shared/pixel/draw";

/**
 * React wrappers around the rasteriser: a critter, a keeper, an item glyph,
 * an egg, or a whole map, drawn into a canvas at an integer scale.
 */

function useCanvasDraw(
  ref: React.RefObject<HTMLCanvasElement | null>,
  w: number,
  h: number,
  scale: number,
  draw: (ctx: CanvasRenderingContext2D) => void,
  deps: unknown[],
) {
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    c.width = w * scale;
    c.height = h * scale;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.save();
    ctx.scale(scale, scale);
    draw(ctx);
    ctx.restore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

export function CritterSprite({
  species,
  facing = "down",
  scale = 4,
  className = "",
  bob = false,
  title,
}: {
  species: number;
  facing?: Facing;
  scale?: number;
  className?: string;
  bob?: boolean;
  title?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useCanvasDraw(ref, 16, 16, scale, (ctx) => ctx.drawImage(critterSprite(species, facing), 0, 0), [species, facing, scale]);
  return (
    <canvas
      ref={ref}
      className={`${bob ? "bob " : ""}${className}`}
      style={{ width: 16 * scale, height: 16 * scale }}
      role="img"
      aria-label={title}
    />
  );
}

export function KeeperSprite({
  look,
  facing = "down",
  scale = 4,
  legFrame = 0,
  className = "",
}: {
  look: Look;
  facing?: Facing;
  scale?: number;
  legFrame?: number;
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useCanvasDraw(
    ref,
    16,
    24,
    scale,
    (ctx) => ctx.drawImage(keeperSprite(look, facing, legFrame), 0, 0),
    [look.skin, look.eyes, look.outfit, look.hair, look.hat, facing, legFrame, scale],
  );
  return <canvas ref={ref} className={className} style={{ width: 16 * scale, height: 24 * scale }} role="img" aria-label="Keeper" />;
}

export function EggSprite({ scale = 4, className = "" }: { scale?: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useCanvasDraw(ref, 16, 16, scale, (ctx) => ctx.drawImage(eggSprite(), 0, 0), [scale]);
  return <canvas ref={ref} className={className} style={{ width: 16 * scale, height: 16 * scale }} role="img" aria-label="Egg" />;
}

export function ItemIcon({ glyph, scale = 3, className = "" }: { glyph: string; scale?: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useCanvasDraw(ref, 8, 8, scale, (ctx) => ctx.drawImage(itemGlyph(glyph), 0, 0), [glyph, scale]);
  return <canvas ref={ref} className={className} style={{ width: 8 * scale, height: 8 * scale }} aria-hidden />;
}

/** Paint a whole map once. Used by the landing page and the in-game map. */
export function drawMap(ctx: CanvasRenderingContext2D, map: GameMap, frame = 0) {
  const atlas = tileAtlas();
  for (let y = 0; y < map.height; y++)
    for (let x = 0; x < map.width; x++) {
      const t = tileAt(map, x, y);
      const v = isAnimatedTile(t) ? frame % 4 : hashXY(x, y) % 4;
      ctx.drawImage(atlas, t * TILE, v * TILE, TILE, TILE, x * TILE, y * TILE, TILE, TILE);
    }
}

export function MapPreview({
  map,
  scale = 2,
  className = "",
  markers = [],
}: {
  map: GameMap;
  scale?: number;
  className?: string;
  markers?: Array<{ x: number; y: number; color: string }>;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useCanvasDraw(
    ref,
    map.width * TILE,
    map.height * TILE,
    scale,
    (ctx) => {
      drawMap(ctx, map);
      for (const m of markers) {
        ctx.fillStyle = m.color;
        ctx.fillRect(m.x * TILE + 4, m.y * TILE + 4, 8, 8);
        ctx.strokeStyle = "#1e2a1c";
        ctx.lineWidth = 1;
        ctx.strokeRect(m.x * TILE + 3.5, m.y * TILE + 3.5, 9, 9);
      }
    },
    [map.id, scale, markers.length],
  );
  return (
    <canvas
      ref={ref}
      className={className}
      style={{ width: "100%", height: "auto", aspectRatio: `${map.width} / ${map.height}` }}
      role="img"
      aria-label={map.name}
    />
  );
}

export const TILE_NAMES: Record<number, string> = {
  [T.GRASS]: "grass",
  [T.WATER]: "water",
};
