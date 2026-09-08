"use client";

import Link from "next/link";
import { Wordmark, WORDMARK_DARK } from "@/components/Wordmark";
import { CritterSprite } from "@/components/Sprite";
import { site } from "@/lib/site";
import { SPECIES } from "@/shared/species";
import { DioramaView } from "./DioramaView";
import { LiveCount } from "./LiveCount";

/**
 * The meadow itself, running, with the name stamped over it. Everything
 * moving here is the game's own tileset and sprites — there is no artwork
 * on this page that is not also in the game.
 */
export function Hero() {
  return (
    <section className="relative isolate min-h-[86svh] overflow-hidden border-b-4 border-ink">
      <DioramaView
        className="absolute inset-0 h-full w-full"
        center={{ x: 27, y: 14 }}
        scale={3}
        critters={10}
        keepers={4}
        drift={2.2}
        pollen={30}
        seed={4242}
      />
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "linear-gradient(180deg, rgba(12,20,10,0.6) 0%, rgba(12,20,10,0.3) 28%, rgba(12,20,10,0.48) 64%, rgba(12,20,10,0.92) 100%)",
        }}
      />

      <div className="relative mx-auto flex min-h-[86svh] max-w-6xl flex-col justify-center gap-8 px-4 py-16">
        <div className="max-w-2xl">
          <div className="flex flex-wrap items-center gap-3">
            <span className="pixel-badge bg-sun">v0.1</span>
            <span className="pixel-badge bg-paper-warm">{site.chainName}</span>
            <LiveCount tone="panel" />
          </div>

          <div className="mt-6">
            <Wordmark text={site.name} scale={11} colors={WORDMARK_DARK} className="max-w-full" title={site.name} />
          </div>

          <p className="mt-6 max-w-xl text-2xl leading-tight text-paper drop-shadow-[3px_3px_0_rgba(12,20,10,0.9)] sm:text-3xl">
            Walk in with somebody.
          </p>
          <p className="mt-4 max-w-xl text-lg leading-snug text-paper/90 drop-shadow-[2px_2px_0_rgba(12,20,10,0.9)]">
            A meadow, a pond and a quarry, shared with whoever else is standing there. Your critters do the work while you
            talk. What they bring back sells for gold.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-4">
            <Link href="/play" className="btn-primary btn-enter">
              Enter the meadow
            </Link>
            <Link href="/docs" className="pixel-link text-lg text-paper drop-shadow-[2px_2px_0_rgba(12,20,10,0.9)]">
              How to play
            </Link>
          </div>
        </div>

        <div className="pixel-panel inline-flex max-w-fit flex-wrap items-center gap-4 px-4 py-3">
          <span className="eyebrow">Six to meet</span>
          <div className="flex items-end gap-2">
            {SPECIES.map((s, i) => (
              <div key={s.id} className="bob" style={{ animationDelay: `${i * 120}ms` }}>
                <CritterSprite species={s.id} scale={2} title={s.name} />
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
        <span className="nudge text-sm uppercase tracking-[0.2em] text-paper/70">scroll</span>
      </div>
    </section>
  );
}
