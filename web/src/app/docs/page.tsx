import type { Metadata } from "next";
import Link from "next/link";
import { Header } from "@/components/landing/Header";
import { Footer } from "@/components/landing/Footer";
import { site } from "@/lib/site";
import { BAG_CAPACITY, ITEMS, JOB_LABEL, JOB_SECONDS, SHOP, TRADER_DAILY_CAP, formatGold } from "@/shared/items";
import { MAX_CRITTERS, PARTY_SIZE, SPECIES, TYPE_LABEL, type JobKind } from "@/shared/species";

export const metadata: Metadata = {
  title: `How to play ${site.name}`,
  description: "Everything the game does today, in the order you will meet it — and honest about the parts that are not finished.",
};

const SECTIONS = [
  ["first-ten", "Your first ten minutes"],
  ["getting-in", "Getting in"],
  ["keeper", "Your keeper"],
  ["critters", "Your critters"],
  ["controls", "Controls"],
  ["working", "Sending a critter to work"],
  ["taming", "Catching a wild critter"],
  ["den", "Your den"],
  ["trader", "The trader"],
  ["worth", "What everything is worth"],
  ["eggs", "Eggs and the hatchery"],
  ["earning", "Earning $CRITTR"],
  ["talking", "Talking to people"],
  ["wrong", "When something goes wrong"],
] as const;

const rarity: Record<string, string> = { junk: "Junk", common: "Common", uncommon: "Uncommon", rare: "Rare", very_rare: "Very rare" };

function H2({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="mt-14 scroll-mt-20 border-b-4 border-ink pb-1 text-3xl first:mt-0">
      {children}
    </h2>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return <div className="my-4 border-l-4 border-poppy bg-poppy-soft/40 px-4 py-3">{children}</div>;
}

function LootTable({ job }: { job: JobKind }) {
  const rows = Object.values(ITEMS).filter((i) => i.from === job);
  return (
    <table className="my-3 w-full text-left">
      <thead>
        <tr className="border-b-4 border-ink text-sm uppercase tracking-wider text-ink-soft">
          <th className="py-1">Brought back</th>
          <th>How often</th>
          <th className="text-right">He pays</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((i) => (
          <tr key={i.key} className="border-b-2 border-ink/20">
            <td className="py-1">{i.name}</td>
            <td className="text-ink-soft">{rarity[i.rarity]}</td>
            <td className={`text-right ${i.price ? "" : "text-ink-soft"}`}>{i.price ? `${formatGold(i.price)} gold` : "nothing"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const mins = (s: number) => `about ${Math.round(s / 60)} minute${s >= 90 ? "s" : ""}`;

export default function DocsPage() {
  return (
    <>
      <Header />
      <main className="mx-auto flex max-w-6xl flex-1 gap-10 px-4 py-10">
        <aside className="hidden w-56 shrink-0 md:block">
          <div className="sticky top-20 border-4 border-ink bg-leaf-deep p-4 text-paper">
            <div className="text-lg">{site.name}</div>
            <div className="mb-3 text-sm text-paper/70">How to play</div>
            <ol className="space-y-1 text-base">
              {SECTIONS.map(([id, label], i) => (
                <li key={id}>
                  <a href={`#${id}`} className="pixel-link">
                    {i + 1}. {label}
                  </a>
                </li>
              ))}
            </ol>
          </div>
        </aside>

        <article className="reading min-w-0 max-w-3xl flex-1 text-ink [&_h2]:font-sans [&_h3]:font-sans">
          <h1 className="font-sans text-5xl">How to play</h1>
          <p className="mt-3 text-lg">
            A pixel meadow you share with other people. This page is everything the game does today, in the order you will meet
            it — and it is honest about the parts that are not finished.
          </p>

          <H2 id="first-ten">Your first ten minutes</H2>
          <p>If you read nothing else, read this. It is the whole loop, in the order that works.</p>
          <ol className="my-3 list-decimal space-y-2 pl-6">
            <li>
              Open the game and connect a wallet. You will be asked to sign one sentence. It costs nothing. If you would rather
              look around first, choose <em>Just look around</em> — but everything from step four on needs a wallet.
            </li>
            <li>Pick a room. A room is one copy of the same meadow. Your keeper and everything you own follow you to any of them.</li>
            <li>
              Settle your keeper, your name, and your first critter. The keeper and the name are permanent once you walk in, so
              spend the extra ten seconds on them.
            </li>
            <li>You arrive at the meeting stone. Walk with WASD or the arrow keys. Your critter follows a step behind.</li>
            <li>
              Walk to the thicket on the west side, the pond in the north-east, or the quarry in the south-east. A small marker
              floats over each working spot when you are near.
            </li>
            <li>
              Stand next to a spot and press <kbd>space</kbd>. Your critter walks up and starts. The prompt over your head says
              who is going and what they will do.
            </li>
            <li>
              Wait, or don&apos;t. The critter works on its own for a few minutes. You can walk anywhere in the meadow, talk, or
              send another critter somewhere else. Leaving the meadow or reloading the page brings it back empty-handed.
            </li>
            <li>
              Expect junk. Most jobs bring back a boot, a twig, some gravel. Junk sells for nothing, but sell it anyway — it is
              the only way it leaves your bag.
            </li>
            <li>
              Sell to the trader. He stands in front of the left hut on the north side, with <em>[NPC] TRADER</em> over his head.
              Press <kbd>E</kbd>. He pays gold, up to a limit each day.
            </li>
            <li>
              Buy a treat while you are there, feed it to a critter, and send it out again. A fed critter brings back half as
              much junk. That is the whole game as it stands: send, wait, sell, repeat.
            </li>
          </ol>

          <H2 id="getting-in">Getting in</H2>
          <h3 className="mt-6 text-2xl">Watching, without a wallet</h3>
          <p>
            Choose <em>Just look around</em> at the door and you get the meadow with everybody moving around in it. The arrow keys
            move the camera. You cannot send anything, buy or sell, leave the meadow, or talk, and nobody can see you.
          </p>
          <h3 className="mt-6 text-2xl">Connecting</h3>
          <p>
            Press the connect button, choose an account in your wallet, and sign the sentence it shows you. It says in plain words
            that it costs nothing. You are in, with a keeper, chat, and the run of the meadow and your own den.
          </p>
          <p>
            Use an ordinary browser wallet that holds its own key. Smart-contract wallets cannot sign the way this door needs and
            are turned away with a generic error. On a phone, open the game inside your wallet&apos;s own browser.
          </p>
          <Note>
            <strong>You do not need to hold anything today.</strong> A wallet is enough. When the egg collection exists, one egg
            will be what the door asks for, and your critters will be the eggs you have hatched. See{" "}
            <a href="#eggs" className="pixel-link">
              Eggs and the hatchery
            </a>
            .
          </Note>
          <p>Closing the tab signs you out; opening it again means signing once more. Your keeper, your critters, your gold and your bag are kept.</p>

          <H2 id="keeper">Your keeper</H2>
          <p>
            A keeper is five pieces — skin, eyes, outfit, hair and headgear — and a name of three to eight characters (letters,
            numbers, underscores). Names are first come, first served; there is no list of what is taken, you find out by trying.
            Both are permanent. There is no rename and no changing your face later.
          </p>
          <p>
            One name an hour is the limit per connection, so a typo costs you an hour. The room list comes before the fitting
            room on purpose: you name yourself standing in a meadow that is already running.
          </p>

          <H2 id="critters">Your critters</H2>
          <p>
            Every critter is one of six species, and every species is good at one job. Up to {PARTY_SIZE} follow you at a time and
            can work at once; any beyond that rest in your den and still leave keepsakes there. One keeper holds at most{" "}
            {MAX_CRITTERS} of them.
          </p>
          <p>
            There are two ways to get one. Catch a wild one in the meadow with treats, or hatch an egg once the hatchery opens.
            A hatched critter is on chain and can be sold with its egg; a tamed one is yours and stays in the den.
          </p>
          <table className="my-3 w-full text-left">
            <thead>
              <tr className="border-b-4 border-ink text-sm uppercase tracking-wider text-ink-soft">
                <th className="py-1">Critter</th>
                <th>Type</th>
                <th>Best at</th>
                <th>Nest keepsake</th>
              </tr>
            </thead>
            <tbody>
              {SPECIES.map((s) => (
                <tr key={s.id} className="border-b-2 border-ink/20">
                  <td className="py-1">{s.name}</td>
                  <td className="text-ink-soft">{TYPE_LABEL[s.type]}</td>
                  <td>{JOB_LABEL[s.affinity].noun}</td>
                  <td className="text-ink-soft">{ITEMS[s.keepsake].name}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p>
            A critter sent to the job it is good at brings back half as much junk. A critter sent anywhere else still works; it
            just finds more boots. Feeding a critter a treat halves the junk again for its next job only.
          </p>

          <H2 id="controls">Controls</H2>
          <table className="my-3 w-full text-left">
            <tbody>
              {[
                ["WASD or arrows", "Walk"],
                ["space", "Offer a treat to the critter in front of you; send an idle critter to the spot; or use what is there"],
                ["1 2 3", "Send that particular critter instead"],
                ["E", "Go through a gate; read a sign or the board; talk to whoever you are standing at"],
                ["I", "Open your bag"],
                ["M", "Open the map"],
                ["B", "Open the bank — cash gold out, claim to your wallet"],
                ["enter", "Say something — press it again to send"],
                ["esc", "Close whatever is open"],
              ].map(([k, v]) => (
                <tr key={k} className="border-b-2 border-ink/20">
                  <td className="w-40 py-1 font-sans text-lg">{k}</td>
                  <td>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p>
            Watch the prompt over your head, not the buttons. When you are close enough to do something the game writes it out —{" "}
            <em>SPACE Send Mossit to forage</em>, <em>E Talk to the trader</em>. No prompt means you are too far away.
          </p>
          <p>
            On a phone or a tablet a thumb pad appears at the bottom left and two buttons at the bottom right, so the meadow
            plays without a keyboard. The bar along the bottom still opens your bag, the map and the bank.
          </p>

          <H2 id="working">Sending a critter to work</H2>
          <p>
            There are twelve spots: four bushes on the rim of the thicket, four places on the pond&apos;s bank, four rocks in the
            quarry. Each takes three critters at once, from anyone. A count over the marker shows how full it is.
          </p>
          <ol className="my-3 list-decimal space-y-1 pl-6">
            <li>Walk up to a spot. The marker over it turns yellow and the tile is outlined.</li>
            <li>
              Press <kbd>space</kbd>. The first critter following you goes. Press <kbd>1</kbd>, <kbd>2</kbd> or <kbd>3</kbd> to choose
              a different one.
            </li>
            <li>The critter walks to the spot and a bar under it fills up. The panel on the right shows the time left.</li>
            <li>Walk away, talk, send the others. Everything within the meadow is allowed.</li>
            <li>When the bar is full the critter comes back to you and what it found goes into your bag.</li>
          </ol>
          <p>
            Foraging takes {mins(JOB_SECONDS.forage)}, fishing {mins(JOB_SECONDS.fish)}, digging {mins(JOB_SECONDS.dig)}. Recall
            from the panel on the right brings a critter back early with nothing. Going through the den gate, or reloading the
            page, does the same to every critter you have out.
          </p>
          <p>
            Your bag holds {BAG_CAPACITY} things. A critter cannot be sent out when it is full, and a critter that comes back to a
            full bag drops what it found. Sell before it gets there.
          </p>

          <H2 id="taming">Catching a wild critter</H2>
          <p>
            Critters wander the meadow on their own. They are not scenery: walk up to one holding a treat and it will stay for
            it.
          </p>
          <ol className="my-3 list-decimal space-y-1 pl-6">
            <li>Buy treats from the trader. They cost {formatGold(SHOP.treat)} gold each.</li>
            <li>
              Walk right up to a wild critter. The prompt reads <em>SPACE Offer a treat</em>, and a marker appears over its head.
            </li>
            <li>
              Press <kbd>space</kbd>. It takes the treat and a bar under it fills a little. Three or four treats usually does
              it.
            </li>
            <li>When the bar fills, it comes home with you and joins your critters.</li>
          </ol>
          <p>
            Trust is on the critter, not on you. If somebody else has been feeding the same one, you are both filling the same
            bar, and it goes home with whoever hands over the treat that fills it. Nothing is refunded to the other person, so
            it is worth saying something in chat first.
          </p>
          <p>
            One keeper holds at most {MAX_CRITTERS} critters, hatched and tamed together, because the nests pay per critter per
            day. When you are full, the game says so rather than taking the treat.
          </p>
          <p>A caught critter is not an egg. It works, it fills a nest, and it stays in your den; it is not on chain and cannot be sold.</p>

          <H2 id="den">Your den</H2>
          <p>
            Through the west gate is a place nobody else can walk into: a house that is not open yet, a small pond, and a row of
            nests. Every critter you keep leaves one keepsake in its nest a day. Press <kbd>E</kbd> at the notice board beside the
            house to collect the whole row at once.
          </p>
          <p>
            A nest fills and then stops. Come back the next day and it is full again; leave it a week and it is still just full.
            Once a day is worth as much as ten times a day.
          </p>

          <H2 id="trader">The trader</H2>
          <p>
            One shop, one man, in front of the left hut on the north side. He buys what your critters bring back and what your
            nests leave; he sells treats.
          </p>
          <p>
            He takes junk for nothing — and that is the point: it leaves your bag. He buys {formatGold(TRADER_DAILY_CAP)} gold worth
            a day from each keeper and then says so. He never turns you away: he pays for what he can and leaves the rest on your
            shelf. Nothing you hold goes off.
          </p>
          <p>
            A treat costs {formatGold(SHOP.treat)} gold. Feed it to a critter from the panel on the right and its next job brings
            back half as much junk. It is the only thing gold buys today.
          </p>

          <H2 id="worth">What everything is worth</H2>
          <p>
            Every price here is the one the trader pays. The words in the middle column are the order, not the odds — how often
            each turns up is not written down anywhere.
          </p>
          <h3 className="mt-6 font-sans text-2xl">The thicket — foraging</h3>
          <LootTable job="forage" />
          <h3 className="mt-6 font-sans text-2xl">The pond — fishing</h3>
          <LootTable job="fish" />
          <h3 className="mt-6 font-sans text-2xl">The quarry — digging</h3>
          <LootTable job="dig" />
          <h3 className="mt-6 font-sans text-2xl">The nests — keepsakes, once a day</h3>
          <table className="my-3 w-full text-left">
            <tbody>
              {Object.values(ITEMS)
                .filter((i) => i.from === "nest")
                .map((i) => (
                  <tr key={i.key} className="border-b-2 border-ink/20">
                    <td className="py-1">{i.name}</td>
                    <td className="text-ink-soft">{SPECIES.find((s) => s.keepsake === i.key)?.name}</td>
                    <td className="text-right">{formatGold(i.price)} gold</td>
                  </tr>
                ))}
            </tbody>
          </table>

          <H2 id="eggs">Eggs and the hatchery</H2>
          <Note>
            <strong>Not open yet.</strong> The egg collection is not deployed and the hatchery has nothing to sell. Today every new
            keeper picks one starter critter, and nobody has more than one.
          </Note>
          <p>
            When the collection exists there will be {site.supply} eggs on {site.chainName}. One egg is what gets you through the
            door — one is enough, and one is all it asks about. There is no tier and no rank.
          </p>
          <p>
            An egg becomes a critter at the hatchery, for a fee in {site.ticker}. Which of the six it becomes is decided on chain
            when it hatches, not before. Every hatched egg in your wallet is one critter in the game, so holding three eggs means
            three critters working at once — that is the one thing holding more changes, and deliberately nothing else. Your gold,
            your bag and your den belong to the wallet, not to any egg.
          </p>

          <H2 id="earning">Earning {site.ticker}</H2>
          <p>
            Gold itself never leaves the game. What leaves is {site.ticker}, out of a contract the token fills on its own:
            every trade through a pool pays a {site.tradeFeeBps / 100}% fee straight into it. Press <kbd>B</kbd> anywhere in the
            meadow to open the bank.
          </p>
          <p>Two steps, and the game is clear about which is which.</p>
          <ol className="my-3 list-decimal space-y-2 pl-6">
            <li>
              <strong>Cash gold out.</strong> Spends the gold and adds the matching amount to what the contract owes you. The
              rate is written on the panel. Nothing is signed and nothing leaves your wallet at this step.
            </li>
            <li>
              <strong>Claim to your wallet.</strong> The game signs a short note saying what you have earned in total, and your
              wallet sends that note to the contract, which pays the difference. You pay the gas; the game never sends a
              transaction for you and never holds your key.
            </li>
          </ol>
          <p>
            The note carries a running total rather than one payment, so sending an old one again pays nothing and there is
            nothing to keep in step. Claim whenever you like — there is no queue, no window to be awake for, and nobody to
            walk up to.
          </p>
          <Note>
            <strong>Not open until the contract is.</strong> Until the payout contract is deployed, the bank panel says so and
            the cash-out button stays off. Your gold is kept either way. Nothing on this page has happened yet.
          </Note>
          <p>
            The rate can change, and the panel always shows the one in force. What you have already cashed out is not affected
            when it does.
          </p>
          <p>
            <strong>The game will not promise what the contract cannot pay.</strong> Before it takes your gold it checks the
            contract balance against everything already owed to everybody. If your gold is worth more than is left, the
            cash-out is refused and the panel says how much room there is. You keep the gold. It is better to be told now than
            to hold a claim nobody can honour.
          </p>
          <p>
            Nothing about this happens in a private message. Nobody running this will ever ask for your seed phrase, ask you to
            send tokens anywhere first, or quote you a rate outside the game.
          </p>

          <H2 id="talking">Talking to people</H2>
          <p>
            Press <kbd>enter</kbd>, type, and press <kbd>enter</kbd> again to send. What you say also appears over your keeper&apos;s
            head. <em>Town</em> is the copy of the meadow you are standing in; <em>World</em> is everybody on the server. Lines are
            short on purpose. <kbd>esc</kbd> leaves the box without sending.
          </p>

          <H2 id="wrong">When something goes wrong</H2>
          <dl className="my-3 space-y-3">
            {[
              ["No wallet found in this browser.", "Install a browser wallet, or on a phone open the game inside your wallet's own browser."],
              ["Your wallet declined. Nothing was signed and nothing has changed.", "You pressed reject, or the wallet timed out. No harm done. Try again."],
              ["Could not sign in.", "By far the most common cause is a smart-contract wallet. Try an ordinary browser wallet instead."],
              ["Your sign-in has expired. Connect your wallet again.", "You were signed in long enough for it to lapse. Connect again; nothing is lost."],
              ["The game server is not answering right now.", "The meadow still loads, but nobody else is in it and nothing you do is recorded. Wait, and come back."],
              ["world full", "That copy of the meadow holds as many people as it can. Pick another room."],
              ["No room at this spot.", "Three critters are already there. Try the next spot along — there are four in each place."],
              ["Your bag is full.", "Walk to the trader, press E, and sell. Junk clears for nothing."],
              ["You've sold me all I can take today.", "Keep what is left — it does not go off — and come back tomorrow."],
              ["My critter came back with nothing.", "You went through a gate, reloaded, or pressed Recall. Send it again."],
              [
                "The payout contract can only cover N more.",
                "Everything already promised, plus what your gold is worth, would pass what the contract holds. Your gold is kept. Cash out less, or come back once it is topped up.",
              ],
              [
                "You already keep six critters.",
                "That is the ceiling for one den. A wild critter will not take your treat until you have room.",
              ],
              ["You signed in from somewhere else.", "The same keeper opened the game in another tab. The newer one wins."],
            ].map(([q, a]) => (
              <div key={q}>
                <dt className="font-sans text-xl">{q}</dt>
                <dd className="text-ink-soft">{a}</dd>
              </div>
            ))}
          </dl>

          <div className="mt-12 flex flex-wrap items-center gap-4">
            <Link href="/play" className="btn-primary">
              Play
            </Link>
            <span className="text-ink-soft">This page describes the build that is live now. Where the game changes, this page changes with it.</span>
          </div>
        </article>
      </main>
      <Footer />
    </>
  );
}
