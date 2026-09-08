/**
 * The brand, in one place. Everything that spells the name, the ticker or
 * the domain reads from here, so a rename is a one-file change.
 *
 * "CRITTR" is a working name chosen while building; nothing below is
 * registered anywhere yet.
 */

const addr = (v: string | undefined): `0x${string}` | null =>
  v && /^0x[0-9a-fA-F]{40}$/.test(v) ? (v as `0x${string}`) : null;

export const site = {
  name: "CRITTR",
  domain: "crittr.farm",
  url: process.env.NEXT_PUBLIC_SITE_URL ?? "https://crittr.farm",
  ticker: "$CRITTR",
  tokenName: "Crittr",
  tagline: "Six critters, a meadow, and other people.",
  description:
    "A pixel meadow you share with other keepers. Your critters forage, fish and dig while you talk; what they bring back sells for gold, and gold decides your share of the pot.",
  keywords: ["CRITTR", "pixel game", "onchain game", "Robinhood Chain", "critters"],
  x: process.env.NEXT_PUBLIC_X_URL ?? "https://x.com/crittrfarm",
  chainName: "Robinhood Chain",
  /** Egg collection size, fixed in the contract. */
  supply: 1111,
  serverUrl: (process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:8787").replace(/\/$/, ""),
  addresses: {
    eggs: addr(process.env.NEXT_PUBLIC_EGGS_ADDRESS),
    token: addr(process.env.NEXT_PUBLIC_CRITTR_TOKEN),
    pot: addr(process.env.NEXT_PUBLIC_REWARD_POT),
    payout: addr(process.env.NEXT_PUBLIC_PAYOUT),
    hatchery: addr(process.env.NEXT_PUBLIC_HATCHERY),
  },
  /** Token economics as designed; the contract holds the real numbers. */
  tradeFeeBps: 300,
  hatchFee: "1,000",
  hatchBurnPct: 50,
} as const;

export function wsUrl(): string {
  return site.serverUrl.replace(/^http/, "ws") + "/ws";
}
