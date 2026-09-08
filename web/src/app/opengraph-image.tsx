import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { site } from "@/lib/site";
import { CRITTER_SPRITES } from "@/shared/pixel/sprites";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = `${site.name} — ${site.tagline}`;

function Sprite({ index, cell }: { index: number; cell: number }) {
  const { grid, palette } = CRITTER_SPRITES[index];
  return (
    <div style={{ position: "relative", width: 16 * cell, height: 16 * cell, display: "flex" }}>
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
  );
}

export default async function OpenGraphImage() {
  const font = await readFile(join(process.cwd(), "src/app/fonts/Jersey15-Regular.ttf"));
  return new ImageResponse(
    (
      <div
        style={{
          width: 1200,
          height: 630,
          display: "flex",
          flexDirection: "column",
          background: "#79c14f",
          fontFamily: "Jersey",
          color: "#1e2a1c",
        }}
      >
        <div style={{ display: "flex", flex: 1, alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 24 }}>
          <div style={{ display: "flex", gap: 36, alignItems: "flex-end" }}>
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <Sprite key={i} index={i} cell={8} />
            ))}
          </div>
          <div style={{ fontSize: 160, lineHeight: 1, letterSpacing: 4 }}>{site.name}</div>
          <div style={{ fontSize: 48, color: "#2f5f3a" }}>{site.tagline}</div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", padding: "0 48px 32px", fontSize: 32, color: "#2f5f3a" }}>
          <span>{site.domain}</span>
          <span>{site.chainName}</span>
        </div>
      </div>
    ),
    { ...size, fonts: [{ name: "Jersey", data: font, style: "normal", weight: 400 }] },
  );
}
