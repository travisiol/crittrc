"use client";

import { useCallback, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAccount, usePublicClient, useSwitchChain, useWriteContract } from "wagmi";
import { ItemIcon } from "@/components/Sprite";
import { api } from "@/lib/api";
import { explorer } from "@/lib/chain";
import { formatUnitsString, isPositive, payoutClaimAbi } from "@/lib/payout";
import { formatGold } from "@/shared/items";
import type { EarnState, SelfState } from "@/shared/protocol";

/**
 * The bank. Two steps, and the game is honest about which is which:
 *
 *  1. Cash out — spend gold, raise a cumulative entitlement on the server.
 *  2. Claim — the server signs "this wallet has earned N in total" and the
 *     wallet sends that voucher to the Payout contract itself.
 *
 * The server never sends a transaction and never holds anyone's key. When
 * the contract is not deployed the panel says exactly that and the cash-out
 * button stays off, rather than banking a promise nobody can honour.
 */
export function BankModal({
  self,
  session,
  onClose,
  onToast,
}: {
  self: SelfState;
  session: string | null;
  onClose: () => void;
  onToast: (text: string, kind: "info" | "warn" | "good") => void;
}) {
  const { address, isConnected, chainId } = useAccount();
  const { switchChain, isPending: switching } = useSwitchChain();
  const { writeContractAsync, isPending: signing } = useWriteContract();
  const publicClient = usePublicClient();

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"cashout" | "claim" | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null);

  // The panel reads the chain through the server, so it is a query rather
  // than an effect: it refetches on its own and after every action.
  const query = useQuery({
    queryKey: ["earn", session],
    queryFn: () => api.earn(session as string),
    enabled: !!session,
    refetchInterval: 20_000,
  });
  const state: EarnState | null = query.data ?? null;
  const load = useCallback(async () => {
    await query.refetch();
  }, [query]);

  // `/earn` is read fresh from the database; the socket's copy can lag a
  // moment behind a cash-out, so the bank trusts the query.
  const gold = state?.gold ?? self.gold;
  const decimals = state?.decimals ?? 18;
  const symbol = state?.symbol ?? "CRITTR";
  const wrongChain = !!state && isConnected && chainId !== state.chainId;

  async function cashOut(all: boolean) {
    if (!session || !state) return;
    setError(null);
    setBusy("cashout");
    try {
      const out = await api.cashout(session, all ? "all" : state.minCashoutGold);
      await load();
      onToast(`Cashed out ${formatGold(out.cashedOut)} gold for ${formatUnitsString(out.tokens, decimals)} ${symbol}.`, "good");
    } catch (e) {
      const text = e instanceof Error ? e.message : String(e);
      setError(text);
      onToast(text, "warn");
    } finally {
      setBusy(null);
    }
  }

  async function claim() {
    if (!session || !state?.payout) return;
    setError(null);
    setBusy("claim");
    try {
      const { voucher } = await api.voucher(session);
      if (address && voucher.account.toLowerCase() !== address.toLowerCase()) {
        throw new Error("This voucher is for the wallet you signed in with. Switch back to it.");
      }
      const hash = await writeContractAsync({
        address: voucher.payout as `0x${string}`,
        abi: payoutClaimAbi,
        functionName: "claim",
        args: [BigInt(voucher.cumulative), BigInt(voucher.deadline), voucher.signature as `0x${string}`],
      });
      setTxHash(hash);
      onToast("Claim sent. Waiting for the chain.", "info");
      // Wait here rather than in an effect: the panel owns the whole step,
      // from the wallet prompt to the receipt to the refreshed numbers.
      setWaiting(true);
      await publicClient?.waitForTransactionReceipt({ hash });
      onToast("Claimed. The tokens are in your wallet.", "good");
      await load();
    } catch (e) {
      const text = e instanceof Error ? e.message : String(e);
      const short = /rejected|denied|User rejected/i.test(text)
        ? "Your wallet declined. Nothing was claimed."
        : text.split("\n")[0];
      setError(short);
      onToast(short, "warn");
    } finally {
      setBusy(null);
      setWaiting(false);
    }
  }

  const claimable = state?.claimable ?? null;
  const canClaim = !!state?.enabled && isConnected && !wrongChain && isPositive(claimable) && !state.potPaused;
  // The server refuses to promise past the contract's balance, so the panel
  // says how much room is left before it does.
  const headroom = state?.headroom ?? null;
  const worth = state?.goldWorth ?? "0";
  const tight = headroom !== null && isPositive(worth) && BigInt(worth) > BigInt(headroom);

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/45 p-3" onClick={onClose}>
      <div className="hud flex max-h-[90dvh] w-full max-w-xl flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="bar flex items-center justify-between border-b-3 border-hud-border px-4 py-2 text-xl">
          <span>Bank</span>
          <button type="button" className="text-sm text-hud-dim hover:text-hud-text" onClick={onClose}>
            esc
          </button>
        </div>

        <div className="scroll-thin space-y-4 overflow-y-auto p-4">
          {/* What you have */}
          <div className="grid grid-cols-2 gap-3">
            <div className="border-3 border-hud-border bg-black/20 p-3">
              <div className="text-sm uppercase tracking-wider text-hud-dim">Gold in hand</div>
              <div className="mt-1 flex items-center gap-2 text-2xl text-sun">
                <ItemIcon glyph="gold" scale={3} />
                {formatGold(gold)}
              </div>
              {state && (
                <div className="mt-1 text-sm text-hud-dim">
                  worth {formatUnitsString(state.goldWorth, decimals)} {symbol} at {state.rate} per gold
                </div>
              )}
            </div>
            <div className="border-3 border-hud-border bg-black/20 p-3">
              <div className="text-sm uppercase tracking-wider text-hud-dim">Waiting in the contract</div>
              <div className="mt-1 text-2xl text-sun">
                {claimable === null ? "—" : `${formatUnitsString(claimable, decimals)} ${symbol}`}
              </div>
              {state?.claimedOnChain && (
                <div className="mt-1 text-sm text-hud-dim">
                  {formatUnitsString(state.claimedOnChain, decimals)} already claimed
                </div>
              )}
            </div>
          </div>

          {/* Not open yet */}
          {state && !state.enabled && (
            <div className="border-3 border-sun/60 bg-sun/10 p-3">
              <div className="text-lg">Cashing out is not open yet.</div>
              <p className="mt-1 text-sm text-hud-dim">
                {state.reason} Keep playing — your gold is kept, and it is what decides your share when it opens.
              </p>
            </div>
          )}

          {/* Health of the payout, said plainly */}
          {state?.enabled && state.signerMatches === false && (
            <p className="border-3 border-poppy bg-poppy/15 p-3 text-poppy-soft">
              The contract does not recognise this server&apos;s signing key. Claims will be refused until an operator fixes
              it. Nothing you have earned is lost.
            </p>
          )}
          {state?.enabled && state.potPaused && (
            <p className="border-3 border-poppy bg-poppy/15 p-3 text-poppy-soft">Claiming is paused by the operator.</p>
          )}
          {state?.enabled && tight && (
            <p className="border-3 border-sun/60 bg-sun/10 p-3">
              The contract can only cover {formatUnitsString(headroom ?? "0", decimals)} {symbol} more right now, less than
              your gold is worth. Cash out part of it, or come back once it is topped up. Nothing you hold is lost.
            </p>
          )}

          {/* Step one */}
          <div className="border-3 border-hud-border p-3">
            <div className="flex items-center gap-2">
              <span className="bg-hud-text px-1.5 text-sm text-ink">1</span>
              <span className="text-lg">Cash gold out</span>
            </div>
            <p className="mt-1 text-sm text-hud-dim">
              Spends gold and adds to what the contract owes you. Nothing leaves your wallet and nothing is signed here.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                type="button"
                className="btn-primary !py-2 !text-base"
                disabled={!state?.enabled || busy !== null || gold < (state?.minCashoutGold ?? 100)}
                onClick={() => cashOut(true)}
              >
                {busy === "cashout" ? "Cashing out…" : `Cash out all ${formatGold(gold)} gold`}
              </button>
              {state && gold < state.minCashoutGold && (
                <span className="text-sm text-hud-dim">
                  The smallest cash-out is {formatGold(state.minCashoutGold)} gold.
                </span>
              )}
            </div>
          </div>

          {/* Step two */}
          <div className="border-3 border-hud-border p-3">
            <div className="flex items-center gap-2">
              <span className="bg-hud-text px-1.5 text-sm text-ink">2</span>
              <span className="text-lg">Claim to your wallet</span>
            </div>
            <p className="mt-1 text-sm text-hud-dim">
              The game signs a note saying what you have earned in total. Your wallet sends it to the contract, which pays the
              difference. Re-sending an old note pays nothing.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              {wrongChain ? (
                <button
                  type="button"
                  className="btn-primary !py-2 !text-base"
                  disabled={switching}
                  onClick={() => state && switchChain({ chainId: state.chainId })}
                >
                  {switching ? "Switching…" : "Switch network first"}
                </button>
              ) : (
                <button
                  type="button"
                  className="btn-primary !py-2 !text-base"
                  disabled={!canClaim || busy !== null || signing || waiting}
                  onClick={claim}
                >
                  {waiting
                    ? "Waiting for the chain…"
                    : busy === "claim" || signing
                      ? "Check your wallet…"
                      : `Claim ${claimable ? formatUnitsString(claimable, decimals) : "0"} ${symbol}`}
                </button>
              )}
              {!isConnected && <span className="text-sm text-hud-dim">Connect a wallet to claim.</span>}
              {txHash && state?.payout && (
                <a href={explorer.tx(txHash)} target="_blank" rel="noreferrer" className="pixel-link text-sm text-sun">
                  View the transaction
                </a>
              )}
            </div>
          </div>

          {error && <p className="text-poppy-soft">{error}</p>}

          {state?.payout && (
            <p className="text-sm text-hud-dim">
              Payout contract{" "}
              <a href={explorer.address(state.payout)} target="_blank" rel="noreferrer" className="pixel-link">
                {state.payout.slice(0, 10)}…{state.payout.slice(-6)}
              </a>
              . The rate is set by the operator and can change; what you have already cashed out does not.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
