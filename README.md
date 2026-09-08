# CRITTR

Six critters, a meadow, and other people.

A pixel meadow you share with other keepers. Your critters forage, fish and dig while you talk; what they bring back sells for gold, and gold decides your share of a pot the token fills itself. Original creatures, original art, no assets — every sprite and tile is a string grid or a few `fillRect` calls.

"CRITTR" is a working name. Nothing is registered, deployed or audited.

## Layout

Three independent packages, no workspaces on purpose (each deploys somewhere different):

| Folder       | What                                                                                   | Stack                                          |
| ------------ | -------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `web/`       | Landing, docs, token page, and the game client at `/play`                              | Next 16, Tailwind 4, wagmi 3, canvas 2D        |
| `server/`    | The world: rooms, movement, jobs, the trader, chat, sign-in. Authoritative for gold.   | Node 24, `ws`, `node:sqlite`, viem             |
| `contracts/` | Eggs (ERC-721), `$CRITTR` (ERC-20 with a pot fee), RewardPot (Merkle windows), Hatchery | Hardhat 2, OpenZeppelin 5, Solidity 0.8.28     |

Shared game data (species, items, loot tables, maps, protocol, pixel art) lives in `web/src/shared/` and is imported by the server through a relative path, so the two can never disagree on what a bush is worth.

## Run it

```bash
npm run install:all
```

Terminal 1 — the world server (fast jobs while developing):

```bash
cd server && JOB_SCALE=0.05 npm run dev
```

Terminal 2 — the site:

```bash
cd web && npm run dev
```

Open `http://localhost:3000`. The game is at `/play`; with `GATE=open` (the default) a browser wallet is enough to walk in, and every new keeper picks a starter critter.

Contracts:

```bash
cd contracts && npm test
```

## How the economy is meant to work

- **Jobs → items.** A critter at a spot works for a few minutes (2/3/4 for forage/fish/dig) and brings back one item. Most drops are junk. The right species at the right spot halves junk; a treat halves it again for one job.
- **Items → gold.** The trader pays fixed prices, up to 100 gold per keeper per day, and clears junk for nothing. Gold is off-chain and lives in the server database with a ledger.
- **Gold → `$CRITTR`.** The token pays a 3% fee on pool trades into `RewardPot`. Once a week the owner runs `server/src/snapshot.ts`, builds a Merkle tree from the shares, and calls `openWindow`. Each keeper claims once from their own wallet. There is no fixed rate, ever.
- **`$CRITTR` → critters.** Hatching an egg costs `$CRITTR` (half burned, half to the pot). Every hatched egg in a wallet is one critter in the game. That is the one thing holding more eggs changes.

Everything that is not live yet says so in the UI and in `/docs`.

## Environment

See `web/.env.example`, `server/.env.example`, `contracts/.env.example`. Empty contract addresses render as "Not deployed yet" — no placeholders are ever shown.

## Before anything real

- Deploy the four contracts (`contracts/scripts/deploy.ts`), then set `GATE=eggs` and `EGGS_ADDRESS` on the server.
- Put the server behind TLS with `ORIGIN` set to the site origin.
- Decide who holds the pot owner key (a multisig), and how often windows open.
- Audit. The contracts are tested, not audited.
- Replace the placeholder X handle and domain in `web/src/lib/site.ts`.

## The front page and the door

`/` is the front page: the meadow itself, running, with the name stamped over
it. Every moving thing on it — tiles, critters, keepers, the pond — comes from
the same `web/src/shared/pixel` modules the game uses, so there is no artwork
on the marketing pages that is not also in the game.

- `shared/pixel/font.ts` — a 5x7 alphabet used by `components/Wordmark.tsx`,
  which bolds each stroke, traces a keyline from the outside in (so the
  counters of C and R stay open) and drops a one pixel shadow.
- `shared/pixel/scene.ts` — `Diorama`, a slice of a real map with critters and
  keepers wandering in it. `components/landing/DioramaView.tsx` stops it when
  it scrolls out of view or the tab is hidden, and draws a single frame for
  anyone who asked for reduced motion.

`/play` opens on a title screen, not on the game: the live meadow with the
wordmark over it, the real number of keepers in it, and two ways in — connect a
wallet, or just look around. The wallet door, the room list and the fitting
room follow in that order.

## Earning the token

Connecting a wallet gets you through the door. Earning happens in two steps,
and the game is explicit about which is which — press `B` anywhere in the
meadow to open the bank.

1. **Cash gold out.** `POST /earn/cashout` spends gold and raises a cumulative
   entitlement held in the server database. Nothing is signed, nothing leaves
   the wallet, no transaction is sent.
2. **Claim.** `POST /earn/voucher` returns an EIP-712 note signed by the game:
   `Claim(address account, uint256 cumulative, uint256 deadline)`. The player's
   own wallet sends it to `Payout.claim(...)`, which pays
   `cumulative - claimed[account]`. The total is cumulative, so a replayed note
   pays nothing and there is no nonce to keep in step.

The server never sends a transaction and never holds a player's key. It does
hold the **signing key**, which is the trust point: whoever has it can vouch
for any amount, up to what the contract holds. The owner can additionally
pause claims, rotate the signer and withdraw. Both are stated on `/token`
rather than buried.

`Payout` is funded by the token itself: `CrittrToken.setPot(payout)` sends the
trade fee straight into it, and the hatchery's non-burned half goes the same
way. A fresh deployment holds nothing, so
`contracts/scripts/fund-payout.ts` seeds it.

Set `PAYOUT_ADDRESS`, `REWARD_TOKEN` and `PAYOUT_SIGNER_KEY` on the server and
`NEXT_PUBLIC_PAYOUT` on the web app. With any of them missing the bank panel
says exactly which, and the cash-out button stays off — gold is never
converted into a promise nobody can honour.

`server/scripts/earn-e2e.mjs` proves the whole path against a local Hardhat
node: sign in, cash out, voucher, claim from the player's wallet, tokens move,
replay refused.

## The game's own keepers

`BOT_COUNT` (34 by default) keepers are run by the server itself. They are
not a number on a counter: each one walks the paths with a breadth-first
route, sends a critter to a bush or a rock, stands at the trader and says
something now and then. They are what stops the first person through the
door from arriving somewhere empty.

They hold no wallet, own no gold and can never cash out or claim. They also
give way: a bot takes at most one of the three places at a working spot, and
only real keepers count against a room's capacity. Their names are reserved
so nobody can register one. `BOT_COUNT=0` empties the world.

The counts on the site ("34 keepers in the meadow") are the number of
keepers standing in the world, the game's own included — not a count of
people.

## Trying the whole thing on a local chain

```bash
cd contracts && npx hardhat node
```

```bash
cd contracts && PAYOUT_SIGNER_ADDRESS=0x70997970C51812dc3A010C7d01b50e0d17dc79C8 npx hardhat run scripts/deploy.ts --network localhost
```

```bash
cd contracts && PAYOUT_ADDRESS=<printed> AMOUNT=1000000 npx hardhat run scripts/fund-payout.ts --network localhost
```

Then start the server with the printed addresses and the signer key whose
address is `payout.signer()` (Hardhat account #1 for the address above), and
put the same addresses in `web/.env.local` with
`NEXT_PUBLIC_ROBINHOOD_CHAIN_ID=31337`. `node server/scripts/earn-e2e.mjs`
then walks the whole path and checks the wallet balance actually moved.

## Catching a critter

Wild critters wander the meadow and are not scenery. Walk up to one
holding a treat, press space, and its trust bar fills a little; three or
four treats and it comes home with you. Trust lives on the critter, not on
the keeper, so two people feeding the same one are racing.

A keeper holds at most `MAX_CRITTERS` (six) critters, hatched and tamed
together, because the nests pay per critter per day. A tamed critter is not
an egg: it works and fills a nest, but it is not on chain.

## What keeps the money honest

Three interlocks, all in the server rather than in a document:

- **The door and earning cannot both be open.** `assertConfig` refuses to
  start when earning is configured with `GATE=open`, because any wallet
  could then make a keeper and cash out, and nobody makes one wallet.
  `ALLOW_OPEN_GATE_EARNING=true` overrides it for a local chain.
- **The server never promises more than the contract holds.** Before a
  cash-out it reads the balance and subtracts everything already owed to
  everybody, keeping `SOLVENCY_BUFFER_PCT` back. Over that line the
  cash-out is refused with the number, and the gold stays gold.
  `server/scripts/solvency-e2e.ts` drains the contract and proves it.
- **The ledger is backed up.** `VACUUM INTO` every `BACKUP_MINUTES`,
  keeping `BACKUP_KEEP` copies beside the database. Restoring is a file
  move.

Rate limits sit in front of the HTTP routes and the socket
(`server/src/limits.ts`). They are a floor, not a substitute for a proxy.

## Checks

```bash
cd contracts && npx hardhat test     # 48
cd server && npm test && npm run typecheck
cd web && npm run lint && npm run typecheck && npm run build
```

End to end, against a running server:

```bash
node server/scripts/e2e.mjs           # the loop: job, loot, trader, chat
npx tsx server/scripts/tame-e2e.ts    # catching a wild critter
node server/scripts/earn-e2e.mjs      # cash out, voucher, claim on chain
npx tsx server/scripts/solvency-e2e.ts
```
