import Link from "next/link";
import { Wordmark, WORDMARK_DARK } from "@/components/Wordmark";
import { site } from "@/lib/site";
import { DioramaView } from "./DioramaView";

export function ClosingCta() {
  return (
    <section className="relative isolate overflow-hidden border-b-4 border-ink">
      <DioramaView
        className="absolute inset-0 h-full w-full"
        center={{ x: 22, y: 18 }}
        scale={3}
        critters={7}
        keepers={4}
        drift={1.6}
        dim={0.5}
        pollen={18}
        seed={7}
      />
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(ellipse at 50% 50%, rgba(12,20,10,0.55) 0%, rgba(12,20,10,0.15) 70%)" }}
      />
      <div className="relative flex flex-col items-center gap-6 px-4 py-24 text-center">
        <Wordmark text={site.name} scale={7} colors={WORDMARK_DARK} title={site.name} />
        <p className="max-w-xl text-xl leading-snug text-paper drop-shadow-[2px_2px_0_rgba(12,20,10,0.9)]">
          The door is a signature, not a transaction. Nothing is spent and nothing leaves the wallet. Sign, pick your pieces,
          walk in.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-4">
          <Link href="/play" className="btn-primary btn-enter">
            Enter the meadow
          </Link>
          <Link href="/docs" className="pixel-link text-lg text-paper drop-shadow-[2px_2px_0_rgba(12,20,10,0.9)]">
            Read how it works first
          </Link>
        </div>
      </div>
    </section>
  );
}
