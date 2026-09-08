import { parseAbi, parseUnits, formatUnits, getAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { config, earningConfigured, earningReason } from "./config";
import { publicClient, chain } from "./chain";
import { totalEarned } from "./db";
import type { EarnState, Voucher } from "../../web/src/shared/protocol";

/**
 * Turning gold into the token.
 *
 * The server never sends a transaction. It signs a voucher that says
 * "this wallet has earned N in total, valid until T", and the player
 * submits it to the Payout contract themselves. The amount is cumulative,
 * so an old voucher pays nothing and there is no nonce to keep in step.
 */

const payoutAbi = parseAbi([
  "function claimed(address) view returns (uint256)",
  "function available() view returns (uint256)",
  "function totalClaimed() view returns (uint256)",
  "function paused() view returns (bool)",
  "function signer() view returns (address)",
]);

const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
]);

const account = /^0x[0-9a-fA-F]{64}$/.test(config.payoutSignerKey)
  ? privateKeyToAccount(config.payoutSignerKey as `0x${string}`)
  : null;

export const signerAddress = account?.address ?? null;

const decimals = config.rewardTokenDecimals;

/** Token units paid for one whole gold, as a bigint in the token's decimals. */
export function weiPerGold(): bigint {
  try {
    return parseUnits(config.tokensPerGold, decimals);
  } catch {
    return 0n;
  }
}

/**
 * What `gold` hundredths are worth right now. Division truncates, so the
 * pot never pays out more than the rate says — the remainder stays gold.
 */
export function tokensForGold(goldHundredths: number): bigint {
  if (!Number.isInteger(goldHundredths) || goldHundredths <= 0) return 0n;
  return (BigInt(goldHundredths) * weiPerGold()) / 100n;
}

export function formatTokens(v: bigint): string {
  return formatUnits(v, decimals);
}

export interface ChainView {
  /** Cumulative tokens this wallet has already pulled out of the contract. */
  claimed: bigint;
  /** What the contract is holding. */
  available: bigint;
  paused: boolean;
  /** True when the contract's signer matches the key this server holds. */
  signerMatches: boolean;
}

/** One round trip to the chain for everything the bank panel shows. */
export async function readChain(address: string): Promise<ChainView | null> {
  if (!earningConfigured()) return null;
  const payout = getAddress(config.payoutAddress) as `0x${string}`;
  const token = getAddress(config.rewardToken) as `0x${string}`;
  try {
    const [claimed, available, paused, onChainSigner] = await Promise.all([
      publicClient.readContract({ address: payout, abi: payoutAbi, functionName: "claimed", args: [getAddress(address)] }),
      publicClient.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [payout] }),
      publicClient.readContract({ address: payout, abi: payoutAbi, functionName: "paused" }),
      publicClient.readContract({ address: payout, abi: payoutAbi, functionName: "signer" }),
    ]);
    return {
      claimed: claimed as bigint,
      available: available as bigint,
      paused: paused as boolean,
      signerMatches: !!signerAddress && (onChainSigner as string).toLowerCase() === signerAddress.toLowerCase(),
    };
  } catch {
    return null;
  }
}

/** Sign "this wallet has earned `cumulative` in total". */
export async function signVoucher(address: string, cumulative: bigint): Promise<Voucher> {
  if (!account) throw new Error("The game has no signing key yet.");
  const payout = getAddress(config.payoutAddress);
  const deadline = Math.floor(Date.now() / 1000) + config.voucherMinutes * 60;
  const signature = await account.signTypedData({
    domain: { name: "CrittrPayout", version: "1", chainId: chain.id, verifyingContract: payout as `0x${string}` },
    types: {
      Claim: [
        { name: "account", type: "address" },
        { name: "cumulative", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    },
    primaryType: "Claim",
    message: { account: getAddress(address), cumulative, deadline: BigInt(deadline) },
  });
  return {
    account: getAddress(address),
    cumulative: cumulative.toString(),
    deadline,
    signature,
    payout,
    chainId: chain.id,
  };
}

export interface Solvency {
  /** What the contract is holding. */
  holds: bigint;
  /** Promised and not yet pulled out. */
  owed: bigint;
  /** What may still be promised, after the buffer. */
  headroom: bigint;
}

/**
 * The server will not promise more than the contract can pay.
 *
 * Everything it has ever vouched for, minus everything the contract has
 * ever paid out, is what it still owes. A cash-out is refused when that
 * debt plus the new amount would pass the balance, less a buffer. It turns
 * "we hope the fee stream keeps up" into something mechanical.
 */
export async function solvency(): Promise<Solvency | null> {
  if (!earningConfigured()) return null;
  const payout = getAddress(config.payoutAddress) as `0x${string}`;
  const token = getAddress(config.rewardToken) as `0x${string}`;
  try {
    const [holds, paid] = await Promise.all([
      publicClient.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [payout] }),
      publicClient.readContract({ address: payout, abi: payoutAbi, functionName: "totalClaimed" }),
    ]);
    const owed = totalEarned() - (paid as bigint);
    const buffer = ((holds as bigint) * BigInt(config.solvencyBufferPct)) / 100n;
    const spendable = (holds as bigint) - buffer;
    const headroom = spendable > owed ? spendable - owed : 0n;
    return { holds: holds as bigint, owed: owed < 0n ? 0n : owed, headroom };
  } catch {
    return null;
  }
}

export async function earnState(address: string, gold: number, earned: bigint): Promise<EarnState> {
  const [view, books] = await Promise.all([readChain(address), solvency()]);
  const claimable = view ? (earned > view.claimed ? earned - view.claimed : 0n) : null;
  return {
    owed: books ? books.owed.toString() : null,
    headroom: books ? books.headroom.toString() : null,
    enabled: earningConfigured(),
    reason: earningReason(),
    symbol: config.rewardTokenSymbol,
    decimals,
    rate: config.tokensPerGold,
    minCashoutGold: config.minCashoutGold,
    payout: earningConfigured() ? getAddress(config.payoutAddress) : null,
    token: /^0x[0-9a-fA-F]{40}$/.test(config.rewardToken) ? getAddress(config.rewardToken) : null,
    chainId: chain.id,
    gold,
    goldWorth: tokensForGold(gold).toString(),
    earned: earned.toString(),
    claimedOnChain: view ? view.claimed.toString() : null,
    claimable: claimable === null ? null : claimable.toString(),
    potHolds: view ? view.available.toString() : null,
    potPaused: view ? view.paused : false,
    signerMatches: view ? view.signerMatches : null,
  };
}
