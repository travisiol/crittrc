"use client";

import { useEffect, useRef } from "react";
import { Diorama, type DioramaOptions } from "@/shared/pixel/scene";

/**
 * Mounts a Diorama and keeps it honest: it stops when it scrolls out of
 * view or the tab is hidden, and it draws exactly one frame for anyone who
 * asked their machine for less motion.
 */
export function DioramaView({ className = "", ...opts }: DioramaOptions & { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const json = JSON.stringify(opts);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let scene: Diorama;
    try {
      scene = new Diorama(canvas, JSON.parse(json) as DioramaOptions);
    } catch {
      return;
    }
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let visible = true;

    const sync = () => {
      if (reduced) return scene.still();
      if (visible && !document.hidden) scene.start();
      else scene.stop();
    };

    const io = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting;
        sync();
      },
      { rootMargin: "120px" },
    );
    io.observe(canvas);

    const onResize = () => {
      scene.resize();
      if (reduced) scene.still();
    };
    window.addEventListener("resize", onResize);
    document.addEventListener("visibilitychange", sync);
    sync();

    return () => {
      io.disconnect();
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", sync);
      scene.stop();
    };
  }, [json]);

  return <canvas ref={ref} className={className} aria-hidden />;
}
