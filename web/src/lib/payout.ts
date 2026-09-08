import { parseAbi } from "viem";

/**
 * The only part of the Payout contract the game talks to. The full ABI is
 * generated into `lib/abi/Payout.ts` by the contracts package; this is the
 * claim entrypoint written out so the web app builds on its own, without
 * the contracts package having been compiled.
 */
export const payoutClaimAbi = parseAbi([
  "function claim(uint256 cumulative, uint256 deadline, bytes signature) returns (uint256 paid)",
  "function claimed(address account) view returns (uint256)",
  "function available() view returns (uint256)",
  "function paused() view returns (bool)",
]);

/** Amounts come off the wire as decimal strings in the token's smallest unit. */
export function formatUnitsString(value: string, decimals: number, maxFractionDigits = 4): string {
  let v: bigint;
  try {
    v = BigInt(value);
  } catch {
    return "0";
  }
  const negative = v < 0n;
  if (negative) v = -v;
  const base = 10n ** BigInt(decimals);
  const whole = v / base;
  const frac = v % base;
  let fracText = frac.toString().padStart(decimals, "0").slice(0, maxFractionDigits).replace(/0+$/, "");
  if (fracText === "") fracText = "0";
  const wholeText = whole.toLocaleString("en-US");
  const out = fracText === "0" ? wholeText : `${wholeText}.${fracText}`;
  return negative ? `-${out}` : out;
}

export function isPositive(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    return BigInt(value) > 0n;
  } catch {
    return false;
  }
}
