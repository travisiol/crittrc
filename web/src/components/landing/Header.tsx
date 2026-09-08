import Link from "next/link";
import { Wordmark, WORDMARK_DARK } from "@/components/Wordmark";
import { site } from "@/lib/site";
import { LiveCount } from "./LiveCount";

export function Header() {
  return (
    <header className="bar sticky top-0 z-40 border-b-4 border-ink text-paper">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-2">
        <Link href="/" className="flex items-center gap-3" aria-label={site.name}>
          <Wordmark text={site.name} scale={3} colors={WORDMARK_DARK} title={site.name} />
        </Link>
        <nav className="flex items-center gap-4 text-lg">
          <LiveCount />
          <Link href="/docs" className="pixel-link hidden sm:inline">
            How to play
          </Link>
          <Link href="/token" className="pixel-link hidden sm:inline">
            Token
          </Link>
          <Link href="/play" className="btn-secondary !px-4 !py-1.5 !text-base">
            Enter
          </Link>
        </nav>
      </div>
    </header>
  );
}
