"use client";

import { useState } from "react";
import { CritterSprite, ItemIcon } from "@/components/Sprite";
import { ITEMS, JOB_LABEL } from "@/shared/items";
import { SPECIES, TYPE_LABEL, type Species } from "@/shared/species";
import type { Facing } from "@/shared/maps";

function DexCard({ s }: { s: Species }) {
  const [facing, setFacing] = useState<Facing>("down");
  const keepsake = ITEMS[s.keepsake];

  return (
    <article
      className="relative flex flex-col border-4 border-ink bg-paper-warm transition-transform duration-100 hover:-translate-x-0.5 hover:-translate-y-0.5"
      style={{ boxShadow: `6px 6px 0 0 var(--ink), 12px 12px 0 0 ${s.color}` }}
      onMouseEnter={() => setFacing("left")}
      onMouseLeave={() => setFacing("down")}
    >
      <div className="flex items-center justify-between border-b-4 border-ink px-3 py-1" style={{ background: s.color }}>
        <span className="text-lg text-ink">No. {String(s.id).padStart(3, "0")}</span>
        <span className="text-sm uppercase tracking-[0.16em] text-ink">{TYPE_LABEL[s.type]}</span>
      </div>

      <div className="relative flex h-36 items-center justify-center overflow-hidden border-b-4 border-ink bg-[#79c14f]">
        <div className="absolute inset-x-0 bottom-0 h-10" style={{ background: "#5ea63c" }} />
        <div className="absolute inset-0 opacity-30" style={{ background: `radial-gradient(circle at 50% 60%, ${s.color} 0%, transparent 62%)` }} />
        <div className="relative bob">
          <CritterSprite species={s.id} facing={facing} scale={6} title={s.name} />
        </div>
      </div>

      <div className="flex flex-1 flex-col p-4">
        <h3 className="text-3xl leading-none">{s.name}</h3>
        <p className="mt-2 flex-1 text-lg leading-snug text-ink-soft">{s.blurb}</p>
        <dl className="mt-4 grid grid-cols-2 gap-3 border-t-4 border-ink pt-3">
          <div>
            <dt className="text-sm uppercase tracking-wider text-ink-soft">Best at</dt>
            <dd className="text-lg">{JOB_LABEL[s.affinity].noun}</dd>
          </div>
          <div>
            <dt className="text-sm uppercase tracking-wider text-ink-soft">Leaves in its nest</dt>
            <dd className="flex items-center gap-2 text-lg">
              <ItemIcon glyph={keepsake.glyph} scale={2} />
              {keepsake.name}
            </dd>
          </div>
        </dl>
      </div>
    </article>
  );
}

export function Dex() {
  return (
    <section id="critters" className="border-b-4 border-ink bg-paper">
      <div className="mx-auto max-w-6xl px-4 py-16">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="eyebrow">The six</p>
            <h2 className="mt-1 text-4xl sm:text-5xl">Every critter is good at one thing.</h2>
          </div>
          <p className="max-w-md text-lg leading-snug text-ink-soft">
            Send one to the job it likes and it brings back half as much junk. Send it anywhere else and it still works — it
            just finds more boots.
          </p>
        </div>

        <div className="mt-12 grid gap-8 pr-3 sm:grid-cols-2 lg:grid-cols-3">
          {SPECIES.map((s) => (
            <DexCard key={s.id} s={s} />
          ))}
        </div>
      </div>
    </section>
  );
}
