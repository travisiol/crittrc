"use client";

import { useState, type ReactNode } from "react";
import { ItemIcon, MapPreview } from "@/components/Sprite";
import { countdown } from "@/lib/format";
import { BAG_CAPACITY, ITEMS, JOB_LABEL, SHOP, formatGold } from "@/shared/items";
import type { GameMap } from "@/shared/maps";
import type { SelfState } from "@/shared/protocol";
import type { JobKind } from "@/shared/species";
import type { Net } from "../engine/net";
import type { ClientWorld } from "../engine/state";

function Frame({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/45 p-3" onClick={onClose}>
      <div className={`hud flex max-h-[90dvh] w-full flex-col ${wide ? "max-w-2xl" : "max-w-md"}`} onClick={(e) => e.stopPropagation()}>
        <div className="bar flex items-center justify-between border-b-3 border-hud-border px-4 py-2 text-xl">
          <span>{title}</span>
          <button type="button" className="text-sm text-hud-dim hover:text-hud-text" onClick={onClose}>
            esc
          </button>
        </div>
        <div className="scroll-thin overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  );
}

const rarityLabel: Record<string, string> = {
  junk: "junk",
  common: "common",
  uncommon: "uncommon",
  rare: "rare",
  very_rare: "very rare",
};

export function BagModal({ self, onClose }: { self: SelfState; onClose: () => void }) {
  const count = self.bag.reduce((s, b) => s + b.qty, 0);
  return (
    <Frame title={`Bag · ${count} / ${BAG_CAPACITY}`} onClose={onClose}>
      {self.bag.length === 0 && <p className="text-hud-dim">Empty. Send a critter out and come back.</p>}
      <ul className="space-y-1">
        {self.bag.map((b) => {
          const it = ITEMS[b.item];
          return (
            <li key={b.item} className="flex items-center gap-3">
              <ItemIcon glyph={it?.glyph ?? "gravel"} scale={3} />
              <span className="flex-1">{it?.name ?? b.item}</span>
              <span className="text-hud-dim">×{b.qty}</span>
              <span className={`w-16 text-right ${it && it.price > 0 ? "text-sun" : "text-hud-dim"}`}>
                {it?.from === "shop" ? "—" : it && it.price > 0 ? formatGold(it.price) : "junk"}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="mt-4 text-sm text-hud-dim">Nothing rots and nothing is lost when you leave. The trader in the meadow buys everything with a price.</p>
    </Frame>
  );
}

export function TraderModal({ self, net, onClose }: { self: SelfState; net: Net | null; onClose: () => void }) {
  const [tab, setTab] = useState<"sell" | "buy" | "prices">("sell");
  const [qty, setQty] = useState(1);
  const sellable = self.bag.filter((b) => ITEMS[b.item]?.from !== "shop");
  const worth = sellable.reduce((s, b) => s + (ITEMS[b.item]?.price ?? 0) * b.qty, 0);
  const room = Math.max(0, self.traderCap - self.soldToday);

  return (
    <Frame title="Trader" onClose={onClose} wide>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {(["sell", "buy", "prices"] as const).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} className={`px-3 py-1 text-sm uppercase tracking-wider ${tab === t ? "bg-hud-text text-ink" : "border-3 border-hud-border text-hud-dim"}`} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
        <span className="flex-1" />
        <span className="text-sm text-hud-dim">
          Bought today {formatGold(self.soldToday)} / {formatGold(self.traderCap)}
        </span>
      </div>

      {tab === "sell" && (
        <div>
          {sellable.length === 0 && <p className="text-hud-dim">&quot;Nothing in that bag I buy. Send a critter out.&quot;</p>}
          <ul className="space-y-1">
            {sellable.map((b) => {
              const it = ITEMS[b.item];
              const junk = !it || it.price === 0;
              return (
                <li key={b.item} className="flex items-center gap-3">
                  <ItemIcon glyph={it?.glyph ?? "gravel"} scale={3} />
                  <span className="flex-1">
                    {it?.name ?? b.item} <span className="text-hud-dim">×{b.qty}</span>
                  </span>
                  <span className={`w-20 text-right ${junk ? "text-hud-dim" : "text-sun"}`}>{junk ? "nothing" : formatGold(it.price * b.qty)}</span>
                  <button type="button" className="btn-hud !px-2 !py-1 !text-sm" onClick={() => net?.send({ t: "trade:sell", items: [b.item] })}>
                    {junk ? "Clear" : "Sell"}
                  </button>
                </li>
              );
            })}
          </ul>
          {sellable.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button type="button" className="btn-primary" onClick={() => net?.send({ t: "trade:sell", items: "all" })}>
                Sell everything · {formatGold(Math.min(worth, room))} gold
              </button>
              {worth > room && <span className="text-sm text-hud-dim">He only takes {formatGold(room)} more today.</span>}
            </div>
          )}
        </div>
      )}

      {tab === "buy" && (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <ItemIcon glyph="treat" scale={4} />
            <div className="flex-1">
              <div>Treat · {formatGold(SHOP.treat)} gold</div>
              <div className="text-sm text-hud-dim">A fed critter brings back half as much junk on its next job.</div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="btn-hud !px-2" onClick={() => setQty((q) => Math.max(1, q - 1))}>
              −
            </button>
            <span className="w-8 text-center">{qty}</span>
            <button type="button" className="btn-hud !px-2" onClick={() => setQty((q) => Math.min(10, q + 1))}>
              +
            </button>
            <button type="button" className="btn-primary" disabled={self.gold < SHOP.treat * qty} onClick={() => net?.send({ t: "trade:buy", item: "treat", qty })}>
              Buy {qty} for {formatGold(SHOP.treat * qty)}
            </button>
            <span className="text-sm text-hud-dim">You have {formatGold(self.gold)} gold.</span>
          </div>
        </div>
      )}

      {tab === "prices" && (
        <div className="space-y-4 text-sm">
          {(["forage", "fish", "dig"] as JobKind[]).map((job) => (
            <div key={job}>
              <div className="mb-1 uppercase tracking-wider text-hud-dim">
                {JOB_LABEL[job].noun} — {JOB_LABEL[job].place}
              </div>
              <table className="w-full">
                <tbody>
                  {Object.values(ITEMS)
                    .filter((i) => i.from === job)
                    .map((i) => (
                      <tr key={i.key} className="border-t-2 border-hud-border/50">
                        <td className="py-0.5">
                          <span className="inline-flex items-center gap-2">
                            <ItemIcon glyph={i.glyph} scale={2} /> {i.name}
                          </span>
                        </td>
                        <td className="text-hud-dim">{rarityLabel[i.rarity]}</td>
                        <td className={`text-right ${i.price ? "text-sun" : "text-hud-dim"}`}>{i.price ? formatGold(i.price) : "nothing"}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          ))}
          <div>
            <div className="mb-1 uppercase tracking-wider text-hud-dim">Keepsakes — from the nests</div>
            <table className="w-full">
              <tbody>
                {Object.values(ITEMS)
                  .filter((i) => i.from === "nest")
                  .map((i) => (
                    <tr key={i.key} className="border-t-2 border-hud-border/50">
                      <td className="py-0.5">
                        <span className="inline-flex items-center gap-2">
                          <ItemIcon glyph={i.glyph} scale={2} /> {i.name}
                        </span>
                      </td>
                      <td className="text-hud-dim">daily</td>
                      <td className="text-right text-sun">{formatGold(i.price)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <p className="text-hud-dim">Odds are not written down anywhere. Common, uncommon, rare, very rare is the order, not the numbers.</p>
          <p className="text-hud-dim">
            &quot;Gold buys treats from me. What else it is worth is the bank&apos;s business — press B.&quot;
          </p>
        </div>
      )}
    </Frame>
  );
}

const JOB_COLOR: Record<JobKind, string> = { forage: "#e0533c", fish: "#5fb3d9", dig: "#c1c5cb" };

export function MapModal({ map, world, onClose }: { map: GameMap; world: ClientWorld; onClose: () => void }) {
  const markers = [
    ...map.spots.map((s) => ({ x: s.x, y: s.y, color: JOB_COLOR[s.job] })),
    ...map.npcs.map((n) => ({ x: n.x, y: n.y, color: "#f6f1e4" })),
    ...map.interactables.filter((i) => i.kind === "gate").map((i) => ({ x: i.x, y: i.y, color: "#9ad86a" })),
    ...(world.self ? [{ x: Math.floor(world.self.x), y: Math.floor(world.self.y), color: "#f5c542" }] : []),
  ];
  return (
    <Frame title={map.name} onClose={onClose} wide>
      <MapPreview map={map} scale={1} markers={markers} />
      <div className="mt-3 flex flex-wrap gap-4 text-sm text-hud-dim">
        <span><i className="inline-block h-3 w-3 bg-[#f5c542]" /> you</span>
        <span><i className="inline-block h-3 w-3 bg-[#e0533c]" /> thicket</span>
        <span><i className="inline-block h-3 w-3 bg-[#5fb3d9]" /> pond</span>
        <span><i className="inline-block h-3 w-3 bg-[#c1c5cb]" /> quarry</span>
        <span><i className="inline-block h-3 w-3 bg-[#f6f1e4]" /> people to talk to</span>
        <span><i className="inline-block h-3 w-3 bg-[#9ad86a]" /> gate</span>
      </div>
    </Frame>
  );
}

export function BoardModal({ self, net, serverNow, onClose }: { self: SelfState; net: Net | null; serverNow: number; onClose: () => void }) {
  const ready = self.nest.length > 0;
  return (
    <Frame title="Notice board" onClose={onClose}>
      <p className="text-hud-dim">Every critter you keep leaves one keepsake in its nest a day. The board collects the whole row at once.</p>
      <ul className="mt-3 space-y-1">
        {self.critters.map((c) => (
          <li key={c.id} className="flex items-center gap-2">
            <span className="flex-1">{c.name}</span>
            <span className="text-hud-dim">{ready ? "something on the shelf" : "nothing yet"}</span>
          </li>
        ))}
        {self.critters.length === 0 && <li className="text-hud-dim">No nests are in use.</li>}
      </ul>
      {ready ? (
        <div className="mt-4">
          <ul className="mb-3 space-y-1">
            {self.nest.map((n) => (
              <li key={n.item} className="flex items-center gap-2">
                <ItemIcon glyph={ITEMS[n.item]?.glyph ?? "tuft"} scale={3} />
                <span className="flex-1">{ITEMS[n.item]?.name ?? n.item}</span>
                <span className="text-hud-dim">×{n.qty}</span>
              </li>
            ))}
          </ul>
          <button type="button" className="btn-primary" onClick={() => net?.send({ t: "board:collect" })}>
            Collect everything
          </button>
        </div>
      ) : (
        <p className="mt-4 text-sm text-hud-dim">
          {self.critters.length ? `Shelves fill again in ${countdown(self.nestReadyAt - serverNow)}.` : ""}
        </p>
      )}
    </Frame>
  );
}

export function SignModal({ text, onClose }: { text: string; onClose: () => void }) {
  return (
    <Frame title="Read" onClose={onClose}>
      <p className="text-lg leading-snug">{text}</p>
    </Frame>
  );
}
