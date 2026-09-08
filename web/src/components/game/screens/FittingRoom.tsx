"use client";

import { useEffect, useMemo, useState } from "react";
import { CritterSprite, KeeperSprite } from "@/components/Sprite";
import { api } from "@/lib/api";
import { LOOK_COUNTS, type Look } from "@/shared/protocol";
import { LOOK_LABELS } from "@/shared/pixel/sprites";
import { NICKNAME_RE, SPECIES, TYPE_LABEL, type Species } from "@/shared/species";
import type { Facing } from "@/shared/maps";

/**
 * Five pieces and a name, both permanent, over a meadow that is already
 * running. The landing page has its own mirror; this one is the real thing
 * and talks to the server.
 */

const PIECES: Array<keyof Look> = ["skin", "eyes", "outfit", "hair", "hat"];
const FACINGS: Facing[] = ["down", "left", "up", "right"];

function randomLook(): Look {
  const r = (n: number) => Math.floor(Math.random() * n);
  return {
    skin: r(LOOK_COUNTS.skin),
    eyes: r(LOOK_COUNTS.eyes),
    outfit: r(LOOK_COUNTS.outfit),
    hair: r(LOOK_COUNTS.hair),
    hat: r(LOOK_COUNTS.hat),
  };
}

const NAME_WORDS = ["moss", "fern", "pip", "reed", "ash", "wren", "clay", "sage", "dew", "bram", "kit", "loam"];
function randomName(): string {
  const a = NAME_WORDS[Math.floor(Math.random() * NAME_WORDS.length)];
  const b = NAME_WORDS[Math.floor(Math.random() * NAME_WORDS.length)];
  return (a + b).slice(0, 8);
}

export function FittingRoom({
  session,
  onDone,
  onBack,
}: {
  session: string;
  onDone: (keeper: { id: string; name: string; look: Look }) => void;
  onBack: () => void;
}) {
  const [look, setLook] = useState<Look>({ skin: 1, eyes: 0, outfit: 0, hair: 1, hat: 0 });
  const [name, setName] = useState("");
  const [starter, setStarter] = useState<number>(1);
  const [facing, setFacing] = useState<Facing>("down");
  const [gate, setGate] = useState<"open" | "eggs">("open");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Randomise after mount, from a callback, so the server-rendered mirror
  // and the first client paint agree; the default look shows for one tick.
  useEffect(() => {
    const id = setTimeout(() => {
      setLook(randomLook());
      setName(randomName());
    }, 0);
    api
      .health()
      .then((h) => setGate(h.gate))
      .catch(() => undefined);
    return () => clearTimeout(id);
  }, []);

  const step = (piece: keyof Look, dir: 1 | -1) =>
    setLook((l) => ({ ...l, [piece]: (l[piece] + dir + LOOK_COUNTS[piece]) % LOOK_COUNTS[piece] }));
  const turn = (dir: 1 | -1) => setFacing((f) => FACINGS[(FACINGS.indexOf(f) + dir + 4) % 4]);

  const nameOk = NICKNAME_RE.test(name);
  const chosen: Species | undefined = useMemo(() => SPECIES.find((s) => s.id === starter), [starter]);

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      const out = await api.createKeeper({ session, name, look, starter });
      onDone(out.keeper);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center overflow-y-auto bg-[rgba(12,20,10,0.78)] p-4">
      <div className="hud rise w-full max-w-3xl">
        <div className="bar flex items-center justify-between border-b-3 border-hud-border px-4 py-2 text-xl">
          <span>Fitting room</span>
          <span className="text-sm text-hud-dim">Step two of two</span>
        </div>

        <div className="grid gap-6 p-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <div>
            <div className="relative flex h-56 items-end justify-center overflow-hidden border-3 border-hud-border bg-black/25">
              <div className="absolute inset-x-0 bottom-0 h-16 bg-[#79c14f]" />
              <div className="absolute inset-x-0 bottom-16 h-1 bg-[#5ea63c]" />
              <div className="relative mb-8 flex items-end gap-6">
                <KeeperSprite look={look} facing={facing} scale={6} />
                {gate === "open" && chosen && <CritterSprite species={chosen.id} facing="down" scale={4} bob />}
              </div>
              <button type="button" className="btn-hud absolute left-2 top-1/2 -translate-y-1/2 !px-2" onClick={() => turn(-1)} aria-label="Turn left">
                ‹
              </button>
              <button type="button" className="btn-hud absolute right-2 top-1/2 -translate-y-1/2 !px-2" onClick={() => turn(1)} aria-label="Turn right">
                ›
              </button>
            </div>
            <div className="mt-3 flex items-center justify-between gap-3">
              <span className="text-sm uppercase tracking-wider text-hud-dim">In the mirror</span>
              <button
                type="button"
                className="btn-hud"
                onClick={() => {
                  setLook(randomLook());
                  setName(randomName());
                }}
              >
                Reroll
              </button>
            </div>
          </div>

          <div className="space-y-3">
            {PIECES.map((piece) => (
              <div key={piece} className="flex items-center gap-2">
                <span className="w-16 text-sm uppercase tracking-wider text-hud-dim">{piece}</span>
                <button type="button" className="btn-hud !px-2" onClick={() => step(piece, -1)} aria-label={`Previous ${piece}`}>
                  ‹
                </button>
                <span className="flex-1 text-center text-lg">{LOOK_LABELS[piece][look[piece]]}</span>
                <button type="button" className="btn-hud !px-2" onClick={() => step(piece, 1)} aria-label={`Next ${piece}`}>
                  ›
                </button>
              </div>
            ))}

            <div className="pt-2">
              <label className="block text-sm uppercase tracking-wider text-hud-dim" htmlFor="keeper-name">
                Name — three to eight characters, permanent
              </label>
              <input
                id="keeper-name"
                className="pixel-input mt-1 text-ink"
                value={name}
                maxLength={8}
                onChange={(e) => setName(e.target.value.replace(/[^A-Za-z0-9_]/g, ""))}
                autoComplete="off"
                spellCheck={false}
              />
            </div>

            {gate === "open" && (
              <div className="pt-2">
                <span className="block text-sm uppercase tracking-wider text-hud-dim">Your first critter</span>
                <div className="mt-2 grid grid-cols-6 gap-1">
                  {SPECIES.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setStarter(s.id)}
                      className={`flex flex-col items-center border-3 p-1 ${starter === s.id ? "border-sun bg-sun/15" : "border-hud-border bg-black/20"}`}
                      title={`${s.name} — ${TYPE_LABEL[s.type]}`}
                    >
                      <CritterSprite species={s.id} scale={2} />
                      <span className="mt-1 text-xs">{s.name}</span>
                    </button>
                  ))}
                </div>
                {chosen && <p className="mt-2 text-sm text-hud-dim">{chosen.blurb}</p>}
              </div>
            )}
            {gate === "eggs" && (
              <p className="text-sm text-hud-dim">
                Your critters are the hatched eggs in your wallet. Eggs still in the shell hatch at the hatchery.
              </p>
            )}

            <div className="pt-2">
              {error && <p className="mb-2 text-poppy-soft">{error}</p>}
              <div className="flex flex-wrap items-center gap-3">
                <button type="button" className="btn-primary" disabled={!nameOk || busy} onClick={submit}>
                  {busy ? "Signing you in…" : `Walk in as ${name || "…"}`}
                </button>
                <button type="button" className="pixel-link text-hud-dim hover:text-hud-text" onClick={onBack}>
                  Back
                </button>
              </div>
              <p className="mt-3 text-sm text-hud-dim">
                Both are permanent — there is no way to change either later. Said now so it surprises nobody later.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
