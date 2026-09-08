import Link from "next/link";
import { site } from "@/lib/site";

const STEPS = [
  {
    n: "01",
    title: "Play, and the trader pays gold",
    body: "Your critters forage, fish and dig; you sell what they bring back. Gold is the score, and it is kept whether or not you ever touch a contract.",
  },
  {
    n: "02",
    title: "Cash gold out at the bank",
    body: `Press B anywhere in the meadow. Gold is spent and the same amount is added to what the payout contract owes you, at the rate written on the panel.`,
  },
  {
    n: "03",
    title: "Claim it to your own wallet",
    body: "The game signs a note saying what you have earned in total; your wallet sends it to the contract. No queue, no window to be awake for, and the game never sends a transaction for you.",
  },
  {
    n: "04",
    title: "The contract fills itself",
    body: `Every ${site.ticker} trade through a pool pays ${site.tradeFeeBps / 100}% into it, and hatching an egg sends ${100 - site.hatchBurnPct}% of its fee back. The people trading fund the people playing.`,
  },
];

export function TokenSection() {
  const deployed = !!site.addresses.token && !!site.addresses.payout;
  return (
    <section id="token" className="bar dither-dark border-b-4 border-ink text-paper">
      <div className="mx-auto max-w-6xl px-4 py-16">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
          <div>
            <p className="eyebrow text-paper/60">The token</p>
            <h2 className="mt-1 text-4xl sm:text-5xl">Turning gold into {site.ticker}</h2>
            <p className="mt-4 text-xl leading-snug text-paper/85">
              Gold never leaves the game. What leaves is {site.ticker}, out of a contract the token fills on its own. You cash
              gold out at the bank and claim it from your own wallet, whenever suits you.
            </p>

            <div className="mt-6 border-4 border-paper/50 p-4 text-lg leading-snug">
              {deployed ? (
                <p>
                  {site.ticker} is live.{" "}
                  <Link href="/token" className="pixel-link">
                    The addresses are here
                  </Link>
                  .
                </p>
              ) : (
                <>
                  <span className="pixel-badge bg-sun text-ink">Not open yet</span>
                  <p className="mt-3">
                    Nothing below has happened once. It is written down so the gold in your bag has a reason, and so the first
                    window is not the first you hear of it.
                  </p>
                </>
              )}
            </div>

            <Link href="/token" className="mt-6 inline-block pixel-link text-lg">
              What exists and what does not
            </Link>
          </div>

          <ol className="grid gap-4 sm:grid-cols-2">
            {STEPS.map((s) => (
              <li key={s.n} className="border-4 border-paper/50 bg-black/20 p-4">
                <span className="text-3xl text-sun">{s.n}</span>
                <h3 className="mt-1 text-2xl leading-none">{s.title}</h3>
                <p className="mt-2 text-base leading-snug text-paper/80">{s.body}</p>
              </li>
            ))}
          </ol>
        </div>

        <p className="mt-10 border-l-4 border-sun pl-4 text-lg text-paper/75">
          The rate is set by whoever runs the game and can change; the panel always shows the one in force, and what you have
          already cashed out is not affected when it moves. A claim can only pay what the contract is holding. Nobody running
          this will ever ask for your seed phrase or quote you a rate in a private message.
        </p>
      </div>
    </section>
  );
}
