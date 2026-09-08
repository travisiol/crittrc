"use client";

import { useEffect, useRef } from "react";
import { dilate, matrixSize, textMatrix } from "@/shared/pixel/font";

/**
 * The name, stamped rather than typeset: a 5x7 alphabet grown into a two
 * pixel outline, filled with a top-lit bevel and dropped onto a hard
 * shadow. Same letters everywhere — header, hero, title screen, OG image.
 */

export interface WordmarkColors {
  outline: string;
  top: string;
  bottom: string;
  highlight: string;
  shadow: string;
}

export const WORDMARK_LIGHT: WordmarkColors = {
  outline: "#1e2a1c",
  top: "#f5c542",
  bottom: "#e08a1e",
  highlight: "#fff2b8",
  shadow: "#2f5f3a",
};

export const WORDMARK_DARK: WordmarkColors = {
  outline: "#12200f",
  top: "#fdf3d6",
  bottom: "#e8c66a",
  highlight: "#ffffff",
  shadow: "#0b1409",
};

export function Wordmark({
  text,
  scale = 6,
  tracking = 4,
  colors = WORDMARK_LIGHT,
  className = "",
  title,
}: {
  text: string;
  scale?: number;
  tracking?: number;
  colors?: WordmarkColors;
  className?: string;
  title?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const thin = textMatrix(text, tracking);
    const { w: tw, h } = matrixSize(thin);
    // Widen every stroke to two pixels before outlining. A one pixel stroke
    // with a one pixel keyline reads as a hollow letter on a dark slab; a
    // two pixel stroke reads as a solid letter with an edge.
    const w = tw + 1;
    const fill: boolean[][] = Array.from({ length: h }, (_, y) =>
      Array.from({ length: w }, (_, x) => !!thin[y][x] || (x > 0 && !!thin[y][x - 1])),
    );
    // The keyline is the grown shape minus everything the outside cannot
    // reach, so the counters of C, R and O stay open instead of filling in.
    const ring = dilate(fill);
    const H = h + 2;
    const W = w + 2;
    const isFill = (y: number, x: number) => y >= 1 && y <= h && x >= 1 && x <= w && fill[y - 1][x - 1];
    const outside = Array.from({ length: H }, () => new Array<boolean>(W).fill(false));
    const queue: Array<[number, number]> = [];
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++)
        if ((y === 0 || y === H - 1 || x === 0 || x === W - 1) && !isFill(y, x) && !outside[y][x]) {
          outside[y][x] = true;
          queue.push([y, x]);
        }
    for (let head = 0; head < queue.length; head++) {
      const [y, x] = queue[head];
      for (const [dy, dx] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const ny = y + dy;
        const nx = x + dx;
        if (ny < 0 || nx < 0 || ny >= H || nx >= W) continue;
        if (outside[ny][nx] || isFill(ny, nx)) continue;
        outside[ny][nx] = true;
        queue.push([ny, nx]);
      }
    }
    const keyline = Array.from({ length: H }, (_, y) =>
      Array.from({ length: W }, (_, x) => ring[y][x] && outside[y][x]),
    );
    const silhouette = Array.from({ length: H }, (_, y) =>
      Array.from({ length: W }, (_, x) => keyline[y][x] || isFill(y, x)),
    );

    // One art pixel, not three: the drop scales with `scale`, and a three
    // pixel drop at hero size is a slab the width of the letter.
    const shadowDrop = 1;
    const artW = w + 2 + shadowDrop;
    const artH = h + 2 + shadowDrop;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = artW * scale * dpr;
    canvas.height = artH * scale * dpr;
    // Width is the one thing set; height follows the intrinsic ratio, so a
    // narrow screen shrinks the word instead of squashing it.
    canvas.style.width = `${artW * scale}px`;
    canvas.style.maxWidth = "100%";
    canvas.style.height = "auto";
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, artW, artH);

    const paint = (m: boolean[][], ox: number, oy: number, color: string) => {
      ctx.fillStyle = color;
      for (let y = 0; y < m.length; y++)
        for (let x = 0; x < m[y].length; x++) if (m[y][x]) ctx.fillRect(x + ox, y + oy, 1, 1);
    };

    // Hard shadow under the silhouette, then the keyline over it.
    paint(silhouette, shadowDrop, shadowDrop, colors.shadow);
    paint(keyline, 0, 0, colors.outline);

    // Bevel: the top of the word catches the light, the rest is the base
    // colour. The highlight is kept to the first two rows so it reads as a
    // light source rather than whitening the start of every stroke.
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        if (!fill[y][x]) continue;
        const lit = y <= 1 && !(y > 0 && fill[y - 1][x]);
        ctx.fillStyle = lit ? colors.highlight : y < h * 0.5 ? colors.top : colors.bottom;
        ctx.fillRect(x + 1, y + 1, 1, 1);
      }
  }, [text, scale, tracking, colors]);

  return <canvas ref={ref} className={className} role="img" aria-label={title ?? text} />;
}
