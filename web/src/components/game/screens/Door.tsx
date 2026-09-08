"use client";

import { useState } from "react";
import { useAccount, useConnect, useSignMessage } from "wagmi";
import { api } from "@/lib/api";
import type { VerifyResponse } from "@/shared/protocol";
import { site } from "@/lib/site";

/**
 * The door. A wallet signs one sentence; nothing is spent. Without a wallet
 * you can still watch the meadow with everybody in it.
 */
export function Door({
  onSignedIn,
  onLookAround,
  onBack,
  fatal,
  hasSession,
}: {
  onSignedIn: (v: VerifyResponse) => void;
  onLookAround: () => void;
  onBack: () => void;
  fatal: string | null;
  hasSession: boolean;
}) {
  const { address, isConnected } = useAccount();
  const { connectAsync, connectors } = useConnect();
  const { signMessageAsync } = useSignMessage();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refused, setRefused] = useState<string | null>(null);

  const injected = connectors[0];
  const hasWallet = typeof window !== "undefined" && !!(window as unknown as { ethereum?: unknown }).ethereum;

  async function signIn() {
    setError(null);
    setRefused(null);
    setBusy(true);
    try {
      let addr = address;
      if (!isConnected || !addr) {
        if (!injected) throw new Error("No wallet found in this browser.");
        const r = await connectAsync({ connector: injected });
        addr = r.accounts[0];
      }
      if (!addr) throw new Error("No wallet found in this browser.");
      const { message, nonce } = await api.nonce(addr);
      const signature = await signMessageAsync({ message });
      const v = await api.verify(addr, nonce, message, signature);
      if (!v.admitted) {
        setRefused(v.reason ?? "This wallet cannot enter.");
        return;
      }
      onSignedIn(v);
    } catch (e) {
      const text = e instanceof Error ? e.message : String(e);
      if (/rejected|denied|declined|cancel/i.test(text)) setError("Your wallet declined. Nothing was signed and nothing has changed.");
      else if (/No wallet/i.test(text)) setError("No wallet found in this browser. On a phone, open the game inside your wallet's browser.");
      else if (/Failed to fetch|NetworkError|network/i.test(text)) setError("The game server is not answering right now. Try again in a moment.");
      else setError(text.split("\n")[0]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-[rgba(12,20,10,0.72)] p-4">
      <div className="hud rise w-full max-w-md">
        <div className="bar flex items-center justify-between border-b-3 border-hud-border px-4 py-2 text-xl">
          <span>Connect a wallet</span>
          <button type="button" className="text-sm text-hud-dim hover:text-hud-text" onClick={onBack}>
            back
          </button>
        </div>
        <div className="space-y-4 px-5 py-5 text-[1.05rem] leading-snug">
          <p>
            Your wallet signs one sentence to prove it is yours. It costs nothing and moves nothing. Without one you can watch
            the meadow everybody lands in — no keeper, no name, no chat.
          </p>
          {fatal && <p className="border-3 border-poppy bg-poppy/15 px-3 py-2 text-poppy-soft">{fatal}</p>}
          {!hasWallet && (
            <p className="text-hud-dim">No wallet found in this browser. On a phone, open the game inside your wallet&apos;s browser.</p>
          )}
          {error && <p className="text-poppy-soft">{error}</p>}
          {refused && (
            <p className="border-3 border-sun/60 bg-sun/10 px-3 py-2">
              {refused} The collection is {site.supply} eggs on {site.chainName}.
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <button type="button" className="btn-primary" disabled={busy || !hasWallet} onClick={signIn}>
              {busy ? "Waiting for your wallet…" : hasSession ? "Sign in again" : "Connect wallet"}
            </button>
            <button type="button" className="pixel-link text-hud-dim hover:text-hud-text" onClick={onLookAround}>
              Just look around
            </button>
          </div>
          <p className="text-sm text-hud-dim">
            Ordinary browser wallets only. Smart-contract wallets cannot sign the way this door needs.
          </p>
        </div>
      </div>
    </div>
  );
}
