import Link from "next/link";
import { Wordmark } from "@/components/Wordmark";
import { site } from "@/lib/site";

export function Footer() {
  return (
    <footer className="bg-paper-deep">
      <div className="mx-auto max-w-6xl px-4 py-12">
        <div className="flex flex-wrap items-start justify-between gap-8">
          <div className="max-w-md">
            <Wordmark text={site.name} scale={4} title={site.name} />
            <p className="mt-4 text-base text-ink-soft">
              A working name. Nothing is registered, deployed or audited yet, and the pages say so wherever it matters. Not
              affiliated with any other game, chain or brand.
            </p>
          </div>
          <nav className="grid gap-x-12 gap-y-1 text-lg sm:grid-cols-2">
            <Link href="/play" className="pixel-link">
              Enter the meadow
            </Link>
            <Link href="/docs" className="pixel-link">
              How to play
            </Link>
            <Link href="/token" className="pixel-link">
              Token
            </Link>
            <a href={site.x} className="pixel-link" target="_blank" rel="noreferrer">
              X
            </a>
          </nav>
        </div>
        <div className="pixel-hr mt-10" />
        <p className="mt-4 text-sm text-ink-soft">
          {site.domain} · {site.chainName} · Keyboard and mouse; a phone can watch and sign in but not walk yet.
        </p>
      </div>
    </footer>
  );
}
