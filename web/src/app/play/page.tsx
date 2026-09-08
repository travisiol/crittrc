import type { Metadata } from "next";
import { Game } from "@/components/game/Game";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: `Play ${site.name}`,
  description: "The meadow, live. Keyboard and mouse; phones can watch and sign in but not walk yet.",
  robots: { index: false },
};

export default function PlayPage() {
  return <Game />;
}
