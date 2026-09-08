"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

/**
 * "N keepers online", read from the world server. Renders nothing at all
 * when the server is down — a wrong number is worse than no number.
 */
export function LiveCount({ tone = "bar" }: { tone?: "bar" | "panel" }) {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .rooms()
        .then(({ rooms }) => alive && setCount(rooms.reduce((s, r) => s + r.count, 0)))
        .catch(() => alive && setCount(null));
    load();
    const id = setInterval(load, 15_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  if (count === null) return null;

  if (tone === "panel") {
    return (
      <span className="pixel-badge bg-paper-warm">
        <i className="inline-block h-2 w-2 bg-leaf blink" />
        {count} {count === 1 ? "keeper" : "keepers"} in the meadow
      </span>
    );
  }

  return (
    <span className="hidden items-center gap-2 text-paper/80 sm:inline-flex">
      <i className="inline-block h-2 w-2 bg-leaf-light blink" />
      {count} online
    </span>
  );
}
