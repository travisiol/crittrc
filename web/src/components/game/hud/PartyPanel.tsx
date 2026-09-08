"use client";

import { CritterSprite } from "@/components/Sprite";
import { countdown } from "@/lib/format";
import { JOB_LABEL } from "@/shared/items";
import type { SelfState } from "@/shared/protocol";
import { TYPE_LABEL, speciesById } from "@/shared/species";
import type { Net } from "../engine/net";

/**
 * Your critters: who is following, who is working and for how long, who
 * has eaten. Feeding and recalling happen here; sending happens in the world.
 */
export function PartyPanel({ self, net, serverNow }: { self: SelfState; net: Net | null; serverNow: number }) {
  const treats = self.bag.find((b) => b.item === "treat")?.qty ?? 0;

  return (
    <div className="hud absolute right-3 top-14 w-60 max-w-[calc(100vw-1.5rem)]">
      <div className="flex items-center justify-between border-b-3 border-hud-border px-3 py-1 text-sm uppercase tracking-wider text-hud-dim">
        <span>Critters</span>
        <span>{treats} treat{treats === 1 ? "" : "s"}</span>
      </div>
      {self.critters.length === 0 && (
        <p className="px-3 py-3 text-sm text-hud-dim">No critter yet. Hatch an egg at the hatchery when it opens.</p>
      )}
      <ul className="divide-y-3 divide-hud-border">
        {self.critters.map((c, i) => {
          const sp = speciesById(c.species);
          const working = c.state === "work" && c.job;
          const left = working ? c.job!.endsAt - serverNow : 0;
          return (
            <li key={c.id} className="flex items-start gap-2 px-2 py-2">
              <div className="relative shrink-0">
                <CritterSprite species={c.species} scale={2} bob={!!working} />
                <span className="absolute -left-1 -top-1 bg-ink px-1 text-[10px] text-hud-dim">{i + 1}</span>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate">{c.name}</span>
                  <span className="text-[10px] uppercase tracking-wider" style={{ color: sp.color }}>
                    {TYPE_LABEL[sp.type]}
                  </span>
                  {c.fed && <span className="text-[10px] uppercase tracking-wider text-sun">fed</span>}
                </div>
                <div className="text-sm text-hud-dim">
                  {working
                    ? `${JOB_LABEL[c.job!.kind].noun} · ${countdown(left)}`
                    : c.state === "rest"
                      ? "Resting in the den"
                      : "Following you"}
                </div>
                <div className="mt-1 flex gap-2">
                  {working && (
                    <button type="button" className="pixel-link text-xs text-hud-dim hover:text-hud-text" onClick={() => net?.send({ t: "job:cancel", critterId: c.id })}>
                      Recall
                    </button>
                  )}
                  {!working && c.state === "follow" && !c.fed && treats > 0 && (
                    <button type="button" className="pixel-link text-xs text-sun" onClick={() => net?.send({ t: "feed", critterId: c.id })}>
                      Feed a treat
                    </button>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
