import { ImageResponse } from "next/og";
import { CRITTER_SPRITES } from "@/shared/pixel/sprites";

export const size = { width: 64, height: 64 };
export const contentType = "image/png";

/** The favicon is Mossit, drawn from the same grid as the game sprite. */
export default function Icon() {
  const { grid, palette } = CRITTER_SPRITES[0];
  const cell = 4;
  return new ImageResponse(
    (
      <div style={{ width: 64, height: 64, background: "#2f5f3a", display: "flex", flexWrap: "wrap", position: "relative" }}>
        {grid.flatMap((row, y) =>
          [...row].map((ch, x) =>
            ch === "." || !palette[ch] ? null : (
              <div
                key={`${x}-${y}`}
                style={{ position: "absolute", left: x * cell, top: y * cell, width: cell, height: cell, background: palette[ch] }}
              />
            ),
          ),
        )}
      </div>
    ),
    size,
  );
}
