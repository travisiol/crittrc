"use client";

import { useEffect, useRef } from "react";
import { keeperSprite, KEEPER_H } from "@/shared/pixel/draw";
import type { Look } from "@/shared/protocol";
import type { Facing } from "@/shared/maps";

/**
 * A band of grass with a few keepers pacing along it. Used under the
 * wardrobe, where the looks you are not wearing go for a walk.
 */
export function WanderStrip({
  looks,
  height = 96,
  scale = 3,
  className = "",
}: {
  looks: Look[];
  height?: number;
  scale?: number;
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const key = JSON.stringify(looks);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const parsed = JSON.parse(key) as Look[];
    if (parsed.length === 0) return;

    let width = 0;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = Math.max(1, Math.floor(rect.width));
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.imageSmoothingEnabled = false;
    };
    resize();

    const walkers = parsed.map((look, i) => ({
      look,
      x: ((i + 0.5) / parsed.length) * 100,
      dir: i % 2 === 0 ? 1 : -1,
      speed: 12 + (i % 3) * 6,
      pauseUntil: 0,
      phase: i * 231,
    }));

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let last = performance.now();

    const frame = (t: number) => {
      const dt = Math.min(0.05, (t - last) / 1000);
      last = t;
      ctx.fillStyle = "#79c14f";
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = "#5ea63c";
      for (let x = 0; x < width; x += 7) ctx.fillRect(x, height - 10 - ((x / 7) % 3), 3, 2);
      ctx.fillStyle = "#9ad86a";
      for (let x = 3; x < width; x += 11) ctx.fillRect(x, 12 + ((x / 11) % 4) * 3, 2, 2);

      for (const w of walkers) {
        if (!reduced) {
          if (t > w.pauseUntil) {
            w.x += ((w.dir * w.speed) / width) * 100 * dt;
            if (w.x > 96) {
              w.x = 96;
              w.dir = -1;
              w.pauseUntil = t + 600 + Math.random() * 2200;
            }
            if (w.x < 4) {
              w.x = 4;
              w.dir = 1;
              w.pauseUntil = t + 600 + Math.random() * 2200;
            }
            if (Math.random() < 0.004) w.pauseUntil = t + 700 + Math.random() * 2500;
          }
        }
        const moving = !reduced && t > w.pauseUntil;
        const facing: Facing = w.dir > 0 ? "right" : "left";
        const leg = moving ? [0, 1, 0, 2][Math.floor((t + w.phase) / 130) % 4] : 0;
        const sx = Math.round((w.x / 100) * width - 8 * scale);
        const sy = height - 12 - KEEPER_H * scale;
        ctx.drawImage(keeperSprite(w.look, facing, leg), sx, sy, 16 * scale, KEEPER_H * scale);
      }
      if (!reduced) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    const onResize = () => resize();
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
  }, [key, height, scale]);

  return <canvas ref={ref} className={className} style={{ width: "100%", height }} aria-hidden />;
}
