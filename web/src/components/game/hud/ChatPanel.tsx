"use client";

import { useEffect, useRef, useState } from "react";
import { CHAT_MAX } from "@/shared/protocol";

export interface ChatLine {
  channel: "town" | "world";
  from: string;
  fromId: string;
  text: string;
  at: number;
}

/**
 * Two channels. Town is the copy of the map you are standing in; World is
 * everybody on the server. Lines are short on purpose.
 */
export function ChatPanel({
  lines,
  open,
  setOpen,
  canTalk,
  onSend,
}: {
  lines: ChatLine[];
  open: boolean;
  setOpen: (v: boolean) => void;
  canTalk: boolean;
  onSend: (channel: "town" | "world", text: string) => void;
}) {
  const [channel, setChannel] = useState<"town" | "world">("town");
  const [text, setText] = useState("");
  const [folded, setFolded] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
    else inputRef.current?.blur();
  }, [open]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [lines.length, channel]);

  const visible = lines.filter((l) => l.channel === channel).slice(-40);

  const submit = () => {
    const t = text.trim();
    if (t) onSend(channel, t.slice(0, CHAT_MAX));
    setText("");
    setOpen(false);
  };

  if (folded) {
    return (
      <button type="button" className="hud absolute bottom-3 left-3 px-3 py-1 text-sm" onClick={() => setFolded(false)}>
        Chat ›
      </button>
    );
  }

  return (
    <div className="hud absolute bottom-3 left-3 flex w-72 max-w-[calc(100vw-1.5rem)] flex-col">
      <div className="flex items-center gap-1 border-b-3 border-hud-border px-1 py-1">
        {(["town", "world"] as const).map((c) => (
          <button
            key={c}
            type="button"
            className={`px-2 py-0.5 text-sm uppercase tracking-wider ${channel === c ? "bg-hud-text text-ink" : "text-hud-dim"}`}
            onClick={() => setChannel(c)}
          >
            {c}
          </button>
        ))}
        <span className="flex-1" />
        <button type="button" className="px-2 text-sm text-hud-dim" onClick={() => setFolded(true)} aria-label="Fold chat">
          ‹
        </button>
      </div>
      <div ref={listRef} className="scroll-thin h-28 space-y-0.5 overflow-y-auto px-2 py-1 text-sm">
        {visible.length === 0 && <p className="text-hud-dim">Nobody has said anything here yet.</p>}
        {visible.map((l, i) => (
          <p key={`${l.at}-${i}`}>
            <span className="text-sun">{l.from}</span> <span className="text-hud-text">{l.text}</span>
          </p>
        ))}
      </div>
      <form
        className="border-t-3 border-hud-border"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <input
          ref={inputRef}
          className="w-full bg-transparent px-2 py-1 text-sm text-hud-text outline-none placeholder:text-hud-dim"
          placeholder={canTalk ? (open ? "Say something — Enter sends, Esc closes" : "Press Enter to talk") : "Connect a wallet to talk"}
          value={text}
          disabled={!canTalk}
          maxLength={CHAT_MAX}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setText("");
              inputRef.current?.blur();
            }
          }}
        />
      </form>
    </div>
  );
}
