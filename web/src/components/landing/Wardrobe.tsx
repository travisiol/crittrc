"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { KeeperSprite } from "@/components/Sprite";
import { LOOK_COUNTS, type Look } from "@/shared/protocol";
import { LOOK_LABELS } from "@/shared/pixel/sprites";
import type { Facing } from "@/shared/maps";
import { WanderStrip } from "./WanderStrip";

/**
 * The wardrobe: six keepers on the board, five pieces you can change, and
 * the plain statement that both the look and the name are permanent. The
 * looks you are not wearing go for a walk in the strip below.
 */

interface Preset {
  name: string;
  look: Look;
}

const PRESETS: Preset[] = [
  { name: "Beekeeper", look: { skin: 0, eyes: 1, outfit: 3, hair: 2, hat: 2 } },
  { name: "Ranger", look: { skin: 2, eyes: 0, outfit: 0, hair: 0, hat: 1 } },
  { name: "Orchardist", look: { skin: 1, eyes: 2, outfit: 2, hair: 3, hat: 2 } },
  { name: "Miller", look: { skin: 3, eyes: 0, outfit: 5, hair: 4, hat: 0 } },
  { name: "Fisher", look: { skin: 1, eyes: 1, outfit: 1, hair: 1, hat: 3 } },
  { name: "Drover", look: { skin: 2, eyes: 2, outfit: 4, hair: 5, hat: 1 } },
];

const PIECES: Array<keyof Look> = ["skin", "eyes", "outfit", "hair", "hat"];
const FACINGS: Facing[] = ["down", "left", "up", "right"];

const combinations = Object.values(LOOK_COUNTS).reduce((a, b) => a * b, 1);

export function Wardrobe() {
  const [chosen, setChosen] = useState(0);
  const [look, setLook] = useState<Look>(PRESETS[0].look);
  const [facing, setFacing] = useState<Facing>("down");

  const others = useMemo(() => PRESETS.filter((_, i) => i !== chosen).map((p) => p.look), [chosen]);

  const step = (piece: keyof Look, dir: 1 | -1) =>
    setLook((l) => ({ ...l, [piece]: (l[piece] + dir + LOOK_COUNTS[piece]) % LOOK_COUNTS[piece] }));
  const turn = (dir: 1 | -1) => setFacing((f) => FACINGS[(FACINGS.indexOf(f) + dir + 4) % 4]);

  return (
    <section id="wardrobe" className="checker border-b-4 border-ink">
      <div className="mx-auto max-w-6xl px-4 py-16">
        <p className="eyebrow">The wardrobe</p>
        <h2 className="mt-1 text-4xl sm:text-5xl">Five pieces and a name.</h2>
        <p className="mt-3 max-w-2xl text-xl leading-snug text-ink-soft">
          Both are permanent. There is no rename and no changing your face later, so the fitting room is the one screen worth
          slowing down on. Said here rather than after.
        </p>

        <div className="mt-10 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
          {/* Mirror */}
          <div className="pixel-panel overflow-hidden">
            <div className="flex items-center justify-between border-b-4 border-ink bg-ink px-4 py-1 text-lg uppercase tracking-widest text-paper">
              <span>In the mirror</span>
              <span className="text-paper/60">{PRESETS[chosen].name}</span>
            </div>
            <div
              className="relative m-4 flex h-64 items-end justify-center overflow-hidden border-4 border-ink"
              style={{ background: "linear-gradient(180deg, #a9d8f2 0%, #d8eeff 70%)" }}
            >
              <div className="absolute inset-x-0 bottom-0 h-20 bg-[#79c14f]" />
              <div className="absolute inset-x-0 bottom-20 h-1 bg-[#5ea63c]" />
              <div className="relative mb-10">
                <KeeperSprite look={look} facing={facing} scale={7} />
              </div>
              <button
                type="button"
                className="btn-secondary absolute left-3 top-1/2 -translate-y-1/2 !px-3 !py-2"
                onClick={() => turn(-1)}
                aria-label="Turn left"
              >
                ‹
              </button>
              <button
                type="button"
                className="btn-secondary absolute right-3 top-1/2 -translate-y-1/2 !px-3 !py-2"
                onClick={() => turn(1)}
                aria-label="Turn right"
              >
                ›
              </button>
            </div>
            <p className="px-4 pb-4 text-base text-ink-soft">
              {combinations.toLocaleString("en-US")} combinations. It is unlikely you will meet your twin.
            </p>
          </div>

          {/* Board and pieces */}
          <div className="space-y-6">
            <div className="pixel-panel p-5">
              <p className="eyebrow">Start from one of the keepers on the board</p>
              <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6">
                {PRESETS.map((p, i) => (
                  <button
                    key={p.name}
                    type="button"
                    onClick={() => {
                      setChosen(i);
                      setLook(p.look);
                    }}
                    className={`flex flex-col items-center gap-1 border-4 px-1 pt-2 ${
                      chosen === i ? "border-ink bg-sun" : "border-ink/20 bg-paper-deep hover:border-ink/60"
                    }`}
                  >
                    <KeeperSprite look={p.look} facing="down" scale={2} />
                    <span className="pb-1 text-sm">{p.name}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="pixel-panel p-5">
              <p className="eyebrow">Then change any layer</p>
              <div className="mt-3 space-y-2">
                {PIECES.map((piece) => (
                  <div key={piece} className="flex items-center gap-3">
                    <span className="w-16 text-sm uppercase tracking-wider text-ink-soft">{piece}</span>
                    <button type="button" className="btn-secondary !px-3 !py-1 !text-base" onClick={() => step(piece, -1)} aria-label={`Previous ${piece}`}>
                      ‹
                    </button>
                    <span className="flex-1 text-center text-xl">{LOOK_LABELS[piece][look[piece]]}</span>
                    <button type="button" className="btn-secondary !px-3 !py-1 !text-base" onClick={() => step(piece, 1)} aria-label={`Next ${piece}`}>
                      ›
                    </button>
                  </div>
                ))}
              </div>
              <div className="mt-5 flex flex-wrap items-center gap-3 border-t-4 border-ink pt-4">
                <Link href="/play" className="btn-primary">
                  Take it through the door
                </Link>
                <span className="text-base text-ink-soft">This mirror saves nothing.</span>
              </div>
            </div>
          </div>
        </div>

        <div className="pixel-panel mt-6 overflow-hidden">
          <div className="border-b-4 border-ink bg-ink px-4 py-1 text-lg uppercase tracking-widest text-paper">
            The other five
          </div>
          <WanderStrip looks={others} height={104} scale={3} />
          <p className="px-4 py-3 text-base text-ink-soft">They are out for a walk. They stop when they feel like it.</p>
        </div>
      </div>
    </section>
  );
}
