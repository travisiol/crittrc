import type { Metadata } from "next";
import { Header } from "@/components/landing/Header";
import { Footer } from "@/components/landing/Footer";
import { EggSprite } from "@/components/Sprite";
import { explorer } from "@/lib/chain";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: `${site.ticker} — ${site.name}`,
  description: `The token, the eggs, the pot and the hatchery: what exists, what does not, and the addresses once they do.`,
};

function AddressRow({ label, value }: { label: string; value: `0x${string}` | null }) {
  return (
    <tr className="border-b-2 border-ink/20">
      <td className="py-2 pr-4 align-top">{label}</td>
      <td className="py-2 font-mono text-sm">
        {value ? (
          <a href={explorer.address(value)} className="pixel-link break-all" target="_blank" rel="noreferrer">
            {value}
          </a>
        ) : (
          <span className="pixel-badge bg-paper-deep">Not deployed yet</span>
        )}
      </td>
    </tr>
  );
}

export default function TokenPage() {
  const a = site.addresses;
  const anyDeployed = !!(a.eggs || a.token || a.pot || a.hatchery);
  return (
    <>
      <Header />
      <main className="mx-auto max-w-4xl flex-1 px-4 py-10">
        <div className="flex items-center gap-4">
          <EggSprite scale={5} />
          <div>
            <h1 className="text-5xl">{site.ticker}</h1>
            <p className="text-lg text-ink-soft">
              {site.tokenName} on {site.chainName}. {anyDeployed ? "Partly deployed." : "Nothing is deployed yet, and this page says so rather than showing a placeholder."}
            </p>
          </div>
        </div>

        <section className="pixel-panel mt-8 p-5">
          <h2 className="text-2xl">Addresses</h2>
          <table className="mt-2 w-full text-left text-lg">
            <tbody>
              <AddressRow label="Egg collection (ERC-721)" value={a.eggs} />
              <AddressRow label={`${site.ticker} (ERC-20)`} value={a.token} />
              <AddressRow label="Payout — what the game pays out of" value={a.payout} />
              <AddressRow label="Reward pot — optional batch windows" value={a.pot} />
              <AddressRow label="Hatchery" value={a.hatchery} />
            </tbody>
          </table>
          <p className="mt-3 text-sm text-ink-soft">
            When these exist they will be pinned here and on the X account. An address anywhere else is not ours.
          </p>
        </section>

        <section className="mt-10 grid gap-6 md:grid-cols-2">
          <div className="pixel-panel p-5">
            <h2 className="text-2xl">The five contracts</h2>
            <ul className="mt-3 space-y-3 text-lg leading-snug">
              <li>
                <strong>Eggs.</strong> {site.supply} of them, minted for ETH. An egg is unhatched until the hatchery hatches it;
                the species is drawn on chain at that moment.
              </li>
              <li>
                <strong>{site.ticker}.</strong> A fixed supply. Every buy and sell through a pool pays {site.tradeFeeBps / 100}%
                into the payout contract, capped at 5% in the contract. Transfers between wallets pay nothing.
              </li>
              <li>
                <strong>Payout.</strong> What the game pays out of. The server signs a note saying what a wallet has earned in
                total; the wallet sends that note here and the contract pays the difference. The total is cumulative, so an old
                note pays nothing.
              </li>
              <li>
                <strong>Reward pot.</strong> An optional batch tool: Merkle windows for a one-off distribution. Not wired into
                the game loop.
              </li>
              <li>
                <strong>Hatchery.</strong> Takes {site.hatchFee} {site.ticker} to hatch an egg: {site.hatchBurnPct}% burned, the
                rest back into the payout contract.
              </li>
            </ul>
          </div>
          <div className="pixel-panel p-5">
            <h2 className="text-2xl">What is honest to say</h2>
            <ul className="mt-3 space-y-3 text-lg leading-snug text-ink-soft">
              <li>The contracts are written and tested locally. They are not deployed and not audited.</li>
              <li>Gold, bags and jobs live on a game server, not on chain. Only the claim is on chain.</li>
              <li>
                <strong>The signing key is a trust point.</strong> Whoever holds it can vouch for any amount, up to what the
                contract is holding. It is named here rather than buried.
              </li>
              <li>The owner can pause claims, rotate the signer, and withdraw what the contract holds. Also a trust point.</li>
              <li>
                A claim can only pay what the contract holds. If trading is thin, the contract is thin. No rate is promised and
                the one in force can change.
              </li>
              <li>Nothing on this site is financial advice and the token has no claim on anything but that contract.</li>
            </ul>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
