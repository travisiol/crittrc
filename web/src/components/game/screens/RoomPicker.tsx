"use client";

import type { RoomInfo, VerifyResponse } from "@/shared/protocol";
import { shortAddress } from "@/lib/format";

/**
 * A room is one copy of the meadow. Your keeper, your critters and your
 * gold follow you to any of them; the only difference is who else is there.
 */
export function RoomPicker({
  rooms,
  onPick,
  onBack,
  onSignOut,
  verify,
}: {
  rooms: RoomInfo[];
  onPick: (r: RoomInfo) => void;
  onBack: () => void;
  onSignOut: () => void;
  verify: VerifyResponse | null;
}) {
  const sorted = [...rooms].sort((a, b) => b.count - a.count);
  const busiest = sorted.find((r) => r.count < r.cap) ?? sorted[0];
  const rest = sorted.filter((r) => r !== busiest);

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-[rgba(12,20,10,0.86)] p-4">
      <div className="rise w-full max-w-lg">
        <p className="eyebrow text-hud-dim">Step one of two</p>
        <h1 className="mt-1 text-4xl text-hud-text">Where the meadow is busiest</h1>
        <p className="mt-2 text-hud-dim">
          The meadow runs on more than one copy so no single one gets crowded. People on different copies cannot see each
          other; everything you own follows you to any of them.
        </p>
        {verify && (
          <p className="mt-2 text-sm text-hud-dim">
            Signed in as {shortAddress(verify.address)}
            {verify.keeper ? ` · keeper ${verify.keeper.name}` : " · no keeper yet, the fitting room is next"}
          </p>
        )}
        <div className="mt-6 space-y-3">
          {busiest ? (
            <button type="button" className="btn-primary w-full" onClick={() => onPick(busiest)}>
              Put me in — {busiest.name}, {busiest.count} {busiest.count === 1 ? "person" : "people"}
            </button>
          ) : (
            <p className="text-hud-dim">No rooms answered. The server may be down; reload in a moment.</p>
          )}
          <ul className="space-y-1 pl-2">
            {rest.map((r) => (
              <li key={r.id} className="flex items-center gap-3">
                <button
                  type="button"
                  className="pixel-link text-sun disabled:text-hud-dim disabled:no-underline"
                  disabled={r.count >= r.cap}
                  onClick={() => onPick(r)}
                >
                  {r.name}
                </button>
                <span className="text-hud-dim">{r.count >= r.cap ? "full" : `${r.count} / ${r.cap}`}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="mt-8 flex items-center gap-5">
          <button type="button" className="pixel-link text-hud-dim hover:text-hud-text" onClick={onBack}>
            Back
          </button>
          <button type="button" className="pixel-link text-hud-dim hover:text-hud-text" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
