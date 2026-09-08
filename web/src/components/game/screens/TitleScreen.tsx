"use client";

import Link from "next/link";
import { CritterSprite } from "@/components/Sprite";
import { Wordmark, WORDMARK_DARK } from "@/components/Wordmark";
import { site } from "@/lib/site";
import type { RoomInfo } from "@/shared/protocol";
import { SPECIES } from "@/shared/species";

/**
 * The screen before the game. The meadow is already running behind it —
 * the same canvas the world is drawn on — so the first thing anybody sees
 * is the place itself, with whoever happens to be standing in it.
 */
export function TitleScreen({
  rooms,
  keeperName,
  onEnter,
  onLookAround,
  offline,
}: {
  rooms: RoomInfo[];
  keeperName: string | null;
  onEnter: () => void;
  onLookAround: () => void;
  offline: boolean;
}) {
  const online = rooms.reduce((s, r) => s + r.count, 0);

  return (
    <div className="absolute inset-0 z-30 flex flex-col">
      {/* The world shows through; these two bands keep the type readable. */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "linear-gradient(180deg, rgba(12,20,10,0.85) 0%, rgba(12,20,10,0.5) 30%, rgba(12,20,10,0.6) 70%, rgba(12,20,10,0.9) 100%)",
        }}
      />
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(ellipse 46% 42% at 50% 46%, rgba(12,20,10,0.62) 0%, rgba(12,20,10,0) 100%)" }}
      />

      <div className="relative flex flex-1 flex-col items-center justify-center px-4 text-center">
        <div className="rise flex flex-col items-center">
          <Wordmark text={site.name} scale={9} colors={WORDMARK_DARK} className="max-w-[92vw]" title={site.name} />
          <p className="mt-5 max-w-lg text-xl leading-snug text-hud-text sm:text-2xl">{site.tagline}</p>

          <div className="mt-6 flex items-end gap-3 sm:gap-5">
            {SPECIES.map((s, i) => (
              <div key={s.id} style={{ animationDelay: `${i * 110}ms` }} className="bob">
                <CritterSprite species={s.id} scale={3} title={s.name} />
              </div>
            ))}
          </div>

          <div className="mt-8 flex flex-col items-center gap-3">
            <button type="button" className="btn-primary btn-enter" onClick={onEnter}>
              {keeperName ? `Walk in as ${keeperName}` : "Enter the meadow"}
            </button>
            <button type="button" className="pixel-link text-lg text-hud-dim hover:text-hud-text" onClick={onLookAround}>
              Just look around
            </button>
          </div>

          <p className="mt-6 text-hud-dim">
            {offline
              ? "The world server is not answering. The meadow still loads, but you will be alone in it."
              : online === 0
                ? "Nobody is in the meadow right now. Somebody has to be first."
                : `${online} ${online === 1 ? "keeper" : "keepers"} in the meadow right now`}
          </p>
        </div>
      </div>

      <div className="relative flex flex-wrap items-center justify-center gap-x-6 gap-y-1 px-4 pb-5 text-sm text-hud-dim">
        <span>One signature. Nothing spent.</span>
        <span className="hidden sm:inline">·</span>
        <span>Keyboard and mouse</span>
        <span className="hidden sm:inline">·</span>
        <Link href="/docs" className="pixel-link hover:text-hud-text">
          How to play
        </Link>
        <span className="hidden sm:inline">·</span>
        <Link href="/" className="pixel-link hover:text-hud-text">
          Back to the front page
        </Link>
      </div>
    </div>
  );
}
