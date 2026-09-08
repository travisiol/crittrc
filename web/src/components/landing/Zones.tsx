"use client";

import { MapPreview } from "@/components/Sprite";
import { JOB_LABEL } from "@/shared/items";
import { getMap } from "@/shared/maps";
import { DioramaView } from "./DioramaView";

const LEGEND = [
  { color: "#e0533c", label: JOB_LABEL.forage.place, job: JOB_LABEL.forage.noun },
  { color: "#5fb3d9", label: JOB_LABEL.fish.place, job: JOB_LABEL.fish.noun },
  { color: "#c1c5cb", label: JOB_LABEL.dig.place, job: JOB_LABEL.dig.noun },
];

export function Zones() {
  const meadow = getMap("meadow");
  const den = getMap("den");
  const spots = meadow.spots.map((s) => ({
    x: s.x,
    y: s.y,
    color: s.job === "forage" ? "#e0533c" : s.job === "fish" ? "#5fb3d9" : "#c1c5cb",
  }));

  return (
    <section id="places" className="ground border-b-4 border-ink">
      <div className="mx-auto max-w-6xl px-4 py-16">
        <p className="eyebrow">Two places to stand in</p>
        <h2 className="mt-1 text-4xl sm:text-5xl">One you share. One nobody can follow you into.</h2>

        <div className="mt-10 grid gap-8 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
          <article className="pixel-panel overflow-hidden">
            <div className="flex items-center justify-between border-b-4 border-ink bg-ink px-4 py-1 text-lg uppercase tracking-widest text-paper">
              <span>The meadow</span>
              <span className="text-paper/60">46 × 36 tiles</span>
            </div>
            <MapPreview map={meadow} scale={1} markers={spots} className="block w-full" />
            <div className="border-t-4 border-ink p-5 text-lg leading-snug">
              <p>
                Everyone lands at the meeting stone. The trader and the hatcher keep the huts to the north, the angler keeps
                the pond, the warden keeps the west gate.
              </p>
              <ul className="mt-4 grid gap-2 sm:grid-cols-3">
                {LEGEND.map((l) => (
                  <li key={l.label} className="flex items-center gap-2 border-4 border-ink bg-paper-deep px-2 py-1 text-base">
                    <i className="inline-block h-4 w-4 border-2 border-ink" style={{ background: l.color }} />
                    <span>
                      {l.label} <span className="text-ink-soft">— {l.job.toLowerCase()}</span>
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-base text-ink-soft">
                Twelve spots, three critters each, from anybody. Wild critters wander the lawn; they are scenery.
              </p>
            </div>
          </article>

          <div className="space-y-8">
            <article className="pixel-panel overflow-hidden">
              <div className="border-b-4 border-ink bg-ink px-4 py-1 text-lg uppercase tracking-widest text-paper">Your den</div>
              <MapPreview map={den} scale={1} className="block w-full" />
              <div className="border-t-4 border-ink p-5 text-lg leading-snug">
                <p>Through the west gate: a house that is not open yet, a pond, and a row of nests.</p>
                <p className="mt-3 text-base text-ink-soft">
                  Every critter leaves one keepsake in its nest a day. The notice board collects the whole row at once.
                </p>
              </div>
            </article>

            <article className="pixel-panel overflow-hidden">
              <div className="border-b-4 border-ink bg-ink px-4 py-1 text-lg uppercase tracking-widest text-paper">
                At the pond, right now
              </div>
              <DioramaView
                className="block h-44 w-full"
                center={{ x: 35, y: 11 }}
                scale={3}
                critters={5}
                keepers={1}
                drift={1.4}
                pollen={14}
                seed={99}
              />
            </article>
          </div>
        </div>
      </div>
    </section>
  );
}
