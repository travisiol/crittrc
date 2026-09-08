"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { CritterSprite, ItemIcon } from "@/components/Sprite";
import { ITEMS, JOB_LABEL, formatGold, lootTable, rollLoot } from "@/shared/items";
import { SPECIES, speciesById, type JobKind } from "@/shared/species";

/**
 * The loop, in miniature and in the browser only: pick a critter, send it
 * somewhere, wait six seconds, sell what comes back. Nothing here is saved
 * and the clock is not the real one; the server owns both.
 */

const DEMO_SECONDS = 6;
const BAG = 8;

interface DemoJob {
  kind: JobKind;
  startedAt: number;
}

export function LoopDemo() {
  const [species, setSpecies] = useState(1);
  const [job, setJob] = useState<DemoJob | null>(null);
  const [bag, setBag] = useState<string[]>([]);
  const [gold, setGold] = useState(0);
  const [progress, setProgress] = useState(0);
  const raf = useRef(0);
  const sp = useMemo(() => speciesById(species), [species]);

  useEffect(() => {
    if (!job) return;
    const tick = () => {
      const p = Math.min(1, (Date.now() - job.startedAt) / (DEMO_SECONDS * 1000));
      setProgress(p);
      if (p >= 1) {
        const item = rollLoot(lootTable(job.kind, { affinity: sp.affinity === job.kind, fed: false }), Math.random);
        setBag((b) => [...b, item]);
        setJob(null);
        return;
      }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [job, sp.affinity]);

  const sell = () => {
    setGold((g) => g + bag.reduce((s, k) => s + (ITEMS[k]?.price ?? 0), 0));
    setBag([]);
  };

  const worth = bag.reduce((s, k) => s + (ITEMS[k]?.price ?? 0), 0);
  const full = bag.length >= BAG;

  return (
    <section id="loop" className="border-b-4 border-ink bg-paper">
      <div className="mx-auto max-w-6xl px-4 py-16">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
          <div>
            <p className="eyebrow">The loop</p>
            <h2 className="mt-1 text-4xl sm:text-5xl">Send, wait, sell.</h2>
            <p className="mt-4 text-xl leading-snug text-ink-soft">
              This is the part that is finished, and you can try it right here with the clock sped up. In the meadow a forage
              takes about two minutes — a thing you start, then go and talk to somebody.
            </p>
            <ol className="mt-6 space-y-3 text-lg leading-snug">
              <li className="flex gap-3">
                <span className="pixel-badge shrink-0 bg-sun">1</span>
                <span>Pick a critter and send it to a spot. It walks there and works on its own.</span>
              </li>
              <li className="flex gap-3">
                <span className="pixel-badge shrink-0 bg-sun">2</span>
                <span>Most of what comes back is junk. That is normal, and the right critter at the right spot halves it.</span>
              </li>
              <li className="flex gap-3">
                <span className="pixel-badge shrink-0 bg-sun">3</span>
                <span>Sell to the trader. He pays gold up to a daily limit and takes the junk for nothing, which is the point.</span>
              </li>
            </ol>
          </div>

          <div className="pixel-panel p-5">
            <p className="eyebrow">Pick one</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {SPECIES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  disabled={!!job}
                  onClick={() => setSpecies(s.id)}
                  className={`flex items-center gap-1 border-4 px-2 py-1 disabled:opacity-60 ${
                    species === s.id ? "border-ink bg-sun" : "border-ink/25 bg-paper-deep hover:border-ink/60"
                  }`}
                >
                  <CritterSprite species={s.id} scale={2} />
                  <span className="text-base">{s.name}</span>
                </button>
              ))}
            </div>

            <div className="pixel-inset mt-4 flex items-center gap-4 p-4">
              <div className={job ? "bob" : ""}>
                <CritterSprite species={species} scale={5} />
              </div>
              <div className="flex-1">
                <div className="text-2xl leading-none">{sp.name}</div>
                <div className="mt-1 text-base text-ink-soft">
                  {job ? `${JOB_LABEL[job.kind].noun} at ${JOB_LABEL[job.kind].place}` : `Best at ${JOB_LABEL[sp.affinity].noun.toLowerCase()} · waiting`}
                </div>
                <div className="mt-2 h-4 border-4 border-ink bg-paper">
                  <div className="h-full bg-sun transition-none" style={{ width: `${Math.round(progress * 100)}%` }} />
                </div>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-2">
              {(["forage", "fish", "dig"] as JobKind[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  disabled={!!job || full}
                  className={`${sp.affinity === k ? "btn-primary" : "btn-secondary"} !px-2 !text-base`}
                  onClick={() => {
                    setProgress(0);
                    setJob({ kind: k, startedAt: Date.now() });
                  }}
                >
                  {JOB_LABEL[k].verb}
                  {sp.affinity === k ? " ★" : ""}
                </button>
              ))}
            </div>
            {full && <p className="mt-2 text-base text-poppy-deep">Bag full. Sell before sending anyone out.</p>}

            <div className="mt-5 border-t-4 border-ink pt-4">
              <div className="flex items-center justify-between text-lg">
                <span>
                  Bag <span className="text-ink-soft">{bag.length} / {BAG}</span>
                </span>
                <span>
                  <span className="text-sun-deep">{formatGold(gold)}</span> <span className="text-ink-soft">gold</span>
                </span>
              </div>
              <ul className="mt-2 flex min-h-11 flex-wrap gap-2">
                {bag.length === 0 && <li className="text-ink-soft">Nothing brought back yet.</li>}
                {bag.map((k, i) => (
                  <li
                    key={`${k}-${i}`}
                    className={`flex items-center gap-1 border-4 border-ink px-1.5 py-0.5 text-sm ${
                      ITEMS[k].price ? "bg-paper-warm" : "bg-paper-deep text-ink-soft"
                    }`}
                  >
                    <ItemIcon glyph={ITEMS[k].glyph} scale={2} />
                    {ITEMS[k].name}
                    <span className={ITEMS[k].price ? "text-sun-deep" : ""}>{ITEMS[k].price ? formatGold(ITEMS[k].price) : "junk"}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex flex-wrap items-center gap-4">
                <button type="button" className="btn-secondary !text-base" disabled={bag.length === 0} onClick={sell}>
                  Sell to the trader · {formatGold(worth)}
                </button>
                <Link href="/play" className="pixel-link">
                  Do it for real
                </Link>
              </div>
            </div>
            <p className="mt-3 text-sm text-ink-soft">Nothing here is saved. The real bag, gold and clock are server-side.</p>
          </div>
        </div>
      </div>
    </section>
  );
}
