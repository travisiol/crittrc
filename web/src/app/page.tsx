import Link from "next/link";
import { Header } from "@/components/landing/Header";
import { Hero } from "@/components/landing/Hero";
import { Marquee } from "@/components/landing/Marquee";
import { Wardrobe } from "@/components/landing/Wardrobe";
import { Dex } from "@/components/landing/Dex";
import { Zones } from "@/components/landing/Zones";
import { LoopDemo } from "@/components/landing/LoopDemo";
import { TokenSection } from "@/components/landing/TokenSection";
import { ClosingCta } from "@/components/landing/ClosingCta";
import { Footer } from "@/components/landing/Footer";
import { site } from "@/lib/site";

export default function Home() {
  return (
    <>
      <Header />
      <main className="flex-1">
        <Hero />
        <Marquee items={["Six critters", "A meadow", "And other people", "Forage · fish · dig"]} />
        <Wardrobe />
        <Dex />
        <Zones />
        <LoopDemo />
        <TokenSection />

        <section className="border-b-4 border-ink bg-paper-deep">
          <div className="mx-auto grid max-w-6xl gap-6 px-4 py-16 md:grid-cols-2">
            <div className="pixel-panel p-6">
              <h2 className="text-3xl leading-none">One sentence signed. Nothing moves.</h2>
              <p className="mt-4 text-lg leading-snug text-ink-soft">
                The door is a wallet signature, not a transaction. Nothing is spent and nothing leaves the wallet. Close the
                tab and you are signed out; your keeper, your critters and your bag are kept.
              </p>
            </div>
            <div className="pixel-panel p-6">
              <h2 className="text-3xl leading-none">{site.supply} eggs, later.</h2>
              <p className="mt-4 text-lg leading-snug text-ink-soft">
                When the collection exists, one egg is the whole of what the door asks, and every hatched egg is one critter
                that follows you. Today a wallet is enough and every new keeper picks a starter. Said now so it surprises
                nobody later.
              </p>
              <Link href="/docs" className="mt-4 inline-block pixel-link text-lg">
                Everything the game does today
              </Link>
            </div>
          </div>
        </section>

        <ClosingCta />
      </main>
      <Footer />
    </>
  );
}
