"use client";

import Link from "next/link";
import { formatGold } from "@/shared/items";
import type { GameMap } from "@/shared/maps";
import type { RoomInfo, SelfState } from "@/shared/protocol";
import { shortAddress } from "@/lib/format";
import type { Net, NetStatus } from "../engine/net";
import { serverNow, type ClientWorld } from "../engine/state";
import type { Modal, Toast } from "../Game";
import { ChatPanel, type ChatLine } from "./ChatPanel";
import { PartyPanel } from "./PartyPanel";
import { BagModal, BoardModal, MapModal, SignModal, TraderModal } from "./Modals";
import { BankModal } from "./BankModal";
import { TouchControls } from "./TouchControls";
import type { Input } from "../engine/input";

export interface Prompt {
  key: string;
  text: string;
  hint?: string;
  dim?: boolean;
}

/**
 * Everything drawn over the canvas: the corner panels, the prompt, the
 * toasts, and whichever modal is open.
 */
export function Hud(props: {
  self: SelfState | null;
  map: GameMap;
  room: RoomInfo | null;
  rooms: RoomInfo[];
  spectating: boolean;
  netStatus: NetStatus;
  prompt: Prompt | null;
  modal: Modal;
  setModal: (m: Modal) => void;
  signText: string;
  toasts: Toast[];
  chat: ChatLine[];
  chatOpen: boolean;
  setChatOpen: (v: boolean) => void;
  sendChat: (channel: "town" | "world", text: string) => void;
  net: Net | null;
  world: ClientWorld;
  session: string | null;
  onToast: (text: string, kind: "info" | "warn" | "good") => void;
  input: Input | null;
  address: string | null;
  onGetKeeper: () => void;
  onSignOut: () => void;
  tick: number;
}) {
  const { self, map, room, spectating, netStatus, prompt, modal, setModal, toasts } = props;
  const now = serverNow(props.world);
  const bagCount = self?.bag.reduce((s, b) => s + b.qty, 0) ?? 0;
  const nearby = props.world.players.size + (self ? 1 : 0);

  return (
    <>
      {/* Top left: where you are. */}
      <div className="hud absolute left-3 top-3 px-3 py-1 text-sm">
        <span className="text-sun">{room?.name ?? "…"}</span>
        <span className="text-hud-dim"> · {map.name} · </span>
        <span>{nearby} nearby</span>
      </div>

      {/* Top right: who you are. */}
      <div className="absolute right-3 top-3 flex items-center gap-2">
        {props.address ? (
          <div className="hud px-3 py-1 text-sm">
            <span className="text-hud-dim">{shortAddress(props.address)}</span>
            {self && <span> · {self.name}</span>}
            <button type="button" className="pixel-link ml-2 text-hud-dim hover:text-hud-text" onClick={props.onSignOut}>
              sign out
            </button>
          </div>
        ) : (
          <button type="button" className="btn-hud" onClick={props.onGetKeeper}>
            Connect wallet
          </button>
        )}
      </div>

      {netStatus === "reconnecting" && (
        <div className="absolute left-1/2 top-14 -translate-x-1/2 border-3 border-poppy bg-poppy/80 px-3 py-1 text-sm text-white">
          reconnecting…
        </div>
      )}

      {/* Toasts. */}
      <div className="pointer-events-none absolute left-1/2 top-16 flex w-full max-w-md -translate-x-1/2 flex-col items-center gap-1 px-3">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`toast-in hud px-3 py-1 text-center text-sm ${t.kind === "good" ? "text-sun" : t.kind === "warn" ? "text-poppy-soft" : ""}`}
          >
            {t.text}
          </div>
        ))}
      </div>

      {/* Prompt. */}
      {prompt && self && modal === "none" && (
        <div className={`pointer-events-none absolute left-1/2 top-[38%] -translate-x-1/2 text-center ${prompt.dim ? "opacity-70" : ""}`}>
          <div className="hud inline-flex items-center gap-2 px-3 py-1">
            {prompt.key && <span className="bg-hud-text px-1.5 text-sm text-ink">{prompt.key}</span>}
            <span className="text-lg">{prompt.text}</span>
          </div>
          {prompt.hint && <div className="mt-1 text-xs text-hud-dim drop-shadow">{prompt.hint}</div>}
        </div>
      )}

      {/* Party. */}
      {self && <PartyPanel self={self} net={props.net} serverNow={now} />}

      {/* Bottom centre: gold and the bag. */}
      {self && (
        <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-2">
          <div className="hud px-3 py-1">
            <span className="text-sun">{formatGold(self.gold)}</span> <span className="text-hud-dim">gold</span>
          </div>
          <button type="button" className="btn-hud" onClick={() => setModal("bag")}>
            <span className="bg-hud-text px-1 text-xs text-ink">I</span> Bag {bagCount}/{self.bagCapacity}
          </button>
          <button type="button" className="btn-hud" onClick={() => setModal("map")}>
            <span className="bg-hud-text px-1 text-xs text-ink">M</span> Map
          </button>
          <button type="button" className="btn-hud" onClick={() => setModal("bank")}>
            <span className="bg-hud-text px-1 text-xs text-ink">B</span> Bank
          </button>
        </div>
      )}

      {/* Phones and tablets. Renders nothing where a keyboard exists. */}
      {self && modal === "none" && !props.chatOpen && <TouchControls input={props.input} />}

      {/* Chat. */}
      <ChatPanel lines={props.chat} open={props.chatOpen} setOpen={props.setChatOpen} canTalk={!!self} onSend={props.sendChat} />

      {/* Watching. */}
      {spectating && (
        <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-3 bg-poppy px-4 py-2 text-white">
          <span>You&apos;re watching. The meadow is live — you are not in it yet. Arrow keys move the camera.</span>
          <button type="button" className="btn-secondary !py-1.5 !text-base" onClick={props.onGetKeeper}>
            Get a keeper
          </button>
        </div>
      )}

      <div className="pointer-events-none absolute bottom-3 right-3 hidden text-xs text-hud-dim md:block">
        <Link href="/docs" className="pointer-events-auto pixel-link">
          How to play
        </Link>
      </div>

      {/* Modals. */}
      {modal === "bag" && self && <BagModal self={self} onClose={() => setModal("none")} />}
      {modal === "trader" && self && <TraderModal self={self} net={props.net} onClose={() => setModal("none")} />}
      {modal === "map" && <MapModal map={map} world={props.world} onClose={() => setModal("none")} />}
      {modal === "board" && self && <BoardModal self={self} net={props.net} serverNow={now} onClose={() => setModal("none")} />}
      {modal === "sign" && <SignModal text={props.signText} onClose={() => setModal("none")} />}
      {modal === "bank" && self && (
        <BankModal self={self} session={props.session} onClose={() => setModal("none")} onToast={props.onToast} />
      )}
    </>
  );
}
