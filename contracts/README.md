# CRITTR contracts

Solidity 0.8.28 · Hardhat 2 · OpenZeppelin 5 · Robinhood Chain (Arbitrum Orbit, chain id 4663).

```bash
npm install
npx hardhat test              # 48 tests
npm run deploy:local          # in-process Hardhat network, prints NEXT_PUBLIC_* lines
npm run deploy:robinhood      # needs .env — see .env.example
```

## Contracts

| Contract          | Role                                                                                                   |
| ----------------- | ------------------------------------------------------------------------------------------------------ |
| `CritterEggs.sol` | ERC721Enumerable, 1111 eggs. ETH sale (`price`, `maxPerWallet`, `saleOpen`), `ownerMint`, `withdraw`. Only `hatcher` can `hatch`; species 1..6 rolled from `prevrandao` + seed + id. `tokenURI` = `baseURI + "egg"` until hatched, then `baseURI + tokenId`. |
| `CrittrToken.sol` | ERC20 `CRITTR`, 1B fixed supply to the deployer, burnable. `feeBps` (default 3 %, max 5 %) taken on transfers that touch exactly one registered `isPair` address and no `feeExempt` address; the fee goes to `pot`. |
| `Payout.sol`      | **The everyday earning path.** Holds CRITTR and pays it to players against EIP-712 vouchers signed by the game server: `claim(cumulative, deadline, signature)`. `Ownable` + `EIP712` + `ReentrancyGuard`. |
| `RewardPot.sol`   | Optional batch tool, unchanged. Owner opens weekly Merkle windows (`openWindow(root, total, closesAt)`); holders `claim(windowId, amount, proof)`. Budgets are reserved against the balance; `closeWindow` releases what was not claimed. |
| `Hatchery.sol`    | `hatch(tokenId)`: pulls `hatchFee` CRITTR (default 1000), burns `burnBps` of it (default 50 %), sends the rest to the pot, then calls `eggs.hatch`. `hatchFee = 0` makes hatching free. |

`contracts/interfaces/ICritterEggs.sol` is the surface the Hatchery and the web app rely on.

## Fee / pot flow

```
buy or sell on the AMM ──3 %──▶ Payout ◀──50 % of hatch fee── Hatchery ──hatch()──▶ CritterEggs
                                  │                                    └──50 % burned
      server-signed voucher ──────┴──▶ player

RewardPot ── optional weekly Merkle windows, funded by hand
```

1. Every buy (`pair -> wallet`) and sell (`wallet -> pair`) of CRITTR sends `feeBps` to `token.pot()`, which
   `scripts/deploy.ts` points at the **Payout** — the contract the game actually pays out of.
2. Hatching an egg costs `hatchFee` CRITTR: half is burned, half lands in the Payout too.
3. Players earn gold in the game. The server keeps that ledger off chain and, on cash-out, signs a voucher (below).
4. The RewardPot stays deployed for one-off airdrops and weekly batches. It is **not** funded by the fee any
   more — transfer CRITTR to it before opening a window.

## Payout: the voucher flow

`cumulative` is the running total of CRITTR an account has ever been entitled to — **not** the size of this
cash-out. The contract pays `cumulative - claimed[account]` and stores the new total.

1. The player cashes gold out in the game. The server adds it to that account's running total.
2. The server signs the EIP-712 struct `Claim(address account,uint256 cumulative,uint256 deadline)` with the
   key whose address is `payout.signer()`. Domain: name `"CrittrPayout"`, version `"1"`, the chain id, and the
   Payout address. In ethers v6 that is `wallet.signTypedData(domain, types, value)`; `payout.hashClaim(account,
   cumulative, deadline)` returns the exact digest so the two sides can be diffed.
3. The player submits `claim(cumulative, deadline, signature)` themselves and receives the difference.
   `claimableFor(account, cumulative)` previews it (0, never a revert, for a voucher already spent).

Replay protection is the cumulative value alone — no nonce. Re-submitting a voucher reverts with
`"Payout: nothing to claim"`, an older one does too, so a lost or out-of-order voucher costs nothing: the next
one supersedes it. `deadline` only bounds how long a voucher stays live.

Other reverts: `"Payout: paused"`, `"Payout: voucher expired"`, `"Payout: bad signature"` (wrong key, or a
voucher issued to a different account — the digest binds `account`), `"Payout: pot is empty"`.

### Funding the Payout

There is no deposit function: **anyone can fund it by transferring CRITTR to its address.** A fresh Payout
holds nothing, so every claim reverts with `"Payout: pot is empty"` until it is seeded — the trade fee and the
hatch fee only trickle in afterwards.

```bash
PAYOUT_ADDRESS=0x… AMOUNT=1000000 npx hardhat run scripts/fund-payout.ts --network robinhood
```

`AMOUNT` is in whole CRITTR. `PAYOUT_ADDRESS` and `CRITTR_TOKEN_ADDRESS` fall back to
`deployments/<network>.json`. Check the balance any time with `payout.available()`.

### Trust points

* **The signer key can attest any amount.** Whoever holds it can sign a voucher for the entire balance, for any
  address. It is a hot key on the game server: rotate it with `setSigner` (old vouchers stop working
  immediately) and keep it off the deployer.
* **The owner can `rescue` the whole balance** to any address at any time, including tokens players are waiting
  to claim.
* **The owner can `setPaused(true)`** and freeze every claim.
* Nothing is reserved or escrowed per player: the contract pays out of whatever it holds, first come first
  served. If the balance runs low, the last claims revert until it is topped up.

## RewardPot windows (optional)

Each week the team computes rewards offchain, builds a Merkle tree of `(address, amount)` leaves with
`@openzeppelin/merkle-tree` (`StandardMerkleTree.of(values, ["address", "uint256"])`), and calls
`pot.openWindow(root, total, closesAt)`. `total` must fit in `pot.free()` (balance minus what open windows still
owe). Holders call `pot.claim(windowId, amount, proof)` before `closesAt`; one claim per address per window.
After `closesAt` anyone can `closeWindow(id)` (the owner can at any time); the unclaimed remainder stays in the
pot and becomes `free()` again for the next window.

Leaf format: `keccak256(bytes.concat(keccak256(abi.encode(account, amount))))`.

## Deploy

`scripts/deploy.ts` deploys Token → RewardPot(token) → Payout(token, signer, owner) → Eggs →
Hatchery(eggs, token, payout), then wires `eggs.setHatcher(hatchery)`, `token.setPot(payout)`,
`token.setFeeExempt(payout, true)`, `token.setFeeExempt(rewardPot, true)`, `token.setFeeExempt(hatchery, true)`.
The voucher signer comes from `PAYOUT_SIGNER_ADDRESS` and falls back to the deployer with a printed warning.
It writes `deployments/<network>.json`, re-exports the ABIs and prints:

```
NEXT_PUBLIC_EGGS_ADDRESS=0x…
NEXT_PUBLIC_CRITTR_TOKEN=0x…
NEXT_PUBLIC_REWARD_POT=0x…
NEXT_PUBLIC_PAYOUT=0x…
NEXT_PUBLIC_HATCHERY=0x…

PAYOUT_ADDRESS=0x…      # for server/.env
REWARD_TOKEN=0x…        # for server/.env
```

After deploy: fund the Payout (`scripts/fund-payout.ts`); create the liquidity pool and
`token.setPair(pool, true)`; `eggs.setSaleOpen(true)` to start the mint.

## ABI export

`hardhat compile` writes `CritterEggs.ts`, `CrittrToken.ts`, `RewardPot.ts`, `Payout.ts`, `Hatchery.ts` and an
`index.ts` barrel to `../web/src/lib/abi/` as `export const critterEggsAbi = [...] as const` (etc.). Disable with
`SKIP_ABI_EXPORT=true`, relocate with `WEB_ABI_DIR`. `npm run export-abi` regenerates without recompiling.

## Environment (`.env`, see `.env.example`)

| Variable                     | Purpose                                                            |
| ---------------------------- | ------------------------------------------------------------------ |
| `DEPLOYER_PRIVATE_KEY`       | Deploys and owns everything; holds the CRITTR supply.              |
| `PAYOUT_SIGNER_ADDRESS`      | Address of the game server's voucher key. Falls back to the deployer, with a warning. |
| `PAYOUT_ADDRESS`, `AMOUNT`   | Used by `scripts/fund-payout.ts` (`AMOUNT` in whole CRITTR).        |
| `CRITTR_TOKEN_ADDRESS`       | Optional override for `fund-payout.ts`; defaults to the recorded deployment. |
| `ROBINHOOD_RPC_URL`          | Defaults to `https://rpc.mainnet.chain.robinhood.com`.             |
| `ROBINHOOD_CHAIN_ID`         | Defaults to `4663`.                                                |
| `ROBINHOOD_EXPLORER_*`       | Explorer API/browser URLs + key for `hardhat verify` (optional).   |
| `EGG_PRICE_WEI`, `BASE_URI`, `CONTRACT_URI` | Optional egg settings applied at deploy.            |
| `SKIP_ABI_EXPORT`            | `true` to skip the ABI export on compile.                          |
| `WEB_ABI_DIR`                | Override the export folder (relative to this package).             |
| `SOLIDITY_EVM_VERSION`       | Defaults to `cancun` (OZ 5.6 `Strings` needs MCOPY). Set `paris` only for a chain without it. |
| `REPORT_GAS`                 | `true` for the gas report.                                         |
