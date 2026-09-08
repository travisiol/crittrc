"use client";

import { useEffect, useRef, useState } from "react";
import type { Input } from "../engine/input";

/**
 * A thumb pad and two buttons, for the screens that have no keyboard.
 *
 * The pad reports a direction rather than a joystick angle, because the
 * world is a tile grid and a player aiming at a bush wants the bush, not
 * a fraction of a degree. Shown only where the pointer is coarse.
 */
export function TouchControls({ input }: { input: Input | null }) {
  const [touch, setTouch] = useState(false);
  const padRef = useRef<HTMLDivElement>(null);
  const pointerId = useRef<number | null>(null);
  const [knob, setKnob] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const mq = window.matchMedia("(pointer: coarse)");
    const sync = () => setTouch(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    // A pad left mid-press must not walk the keeper into the pond.
    return () => input?.setTouch(0, 0);
  }, [input]);

  if (!touch) return null;

  const aim = (e: React.PointerEvent) => {
    const el = padRef.current;
    if (!el || !input) return;
    const r = el.getBoundingClientRect();
    const dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
    const dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
    const len = Math.hypot(dx, dy);
    if (len < 0.22) {
      input.setTouch(0, 0);
      setKnob({ x: 0, y: 0 });
      return;
    }
    const clamped = Math.min(1, len);
    const x = (dx / len) * clamped;
    const y = (dy / len) * clamped;
    input.setTouch(x, y);
    setKnob({ x, y });
  };

  const end = () => {
    pointerId.current = null;
    input?.setTouch(0, 0);
    setKnob(null);
  };

  return (
    <div className="pointer-events-none absolute inset-0 z-10 select-none">
      <div
        ref={padRef}
        className="pointer-events-auto absolute bottom-24 left-4 h-36 w-36 touch-none rounded-full border-3 border-hud-border bg-black/35"
        onPointerDown={(e) => {
          pointerId.current = e.pointerId;
          try {
            // Capture keeps the thumb working past the edge of the pad.
            // Some browsers refuse it for a pointer they did not issue;
            // aiming still has to happen either way.
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
          } catch {
            // No capture, no problem: the pad just stops at its own edge.
          }
          aim(e);
        }}
        onPointerMove={(e) => {
          if (pointerId.current === e.pointerId) aim(e);
        }}
        onPointerUp={end}
        onPointerCancel={end}
        aria-label="Move"
      >
        <div
          className="absolute h-12 w-12 rounded-full border-3 border-hud-border bg-hud-text/80"
          style={{
            left: `calc(50% - 1.5rem + ${(knob?.x ?? 0) * 2.4}rem)`,
            top: `calc(50% - 1.5rem + ${(knob?.y ?? 0) * 2.4}rem)`,
          }}
        />
      </div>

      <div className="pointer-events-auto absolute bottom-24 right-4 flex flex-col items-end gap-3">
        <button
          type="button"
          className="btn-hud h-16 w-16 !rounded-full !p-0 !text-lg"
          onPointerDown={(e) => {
            e.preventDefault();
            input?.fire("interact");
          }}
        >
          E
        </button>
        <button
          type="button"
          className="btn-hud h-20 w-20 !rounded-full !p-0 !text-base"
          onPointerDown={(e) => {
            e.preventDefault();
            input?.fire("use");
          }}
        >
          USE
        </button>
      </div>
    </div>
  );
}
