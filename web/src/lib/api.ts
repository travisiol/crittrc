import { site } from "@/lib/site";
import type {
  CreateKeeperRequest,
  EarnState,
  Look,
  NonceResponse,
  PayoutRow,
  RoomInfo,
  VerifyResponse,
  Voucher,
} from "@/shared/protocol";

/**
 * The JSON side of the world server. The session token lives in
 * sessionStorage on purpose: closing the tab signs you out, opening it
 * again means signing once more. Nothing else is stored in the browser.
 */

const SESSION_KEY = "crittr.session";

export function getSession(): string | null {
  try {
    return sessionStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

export function setSession(token: string | null) {
  try {
    if (token) sessionStorage.setItem(SESSION_KEY, token);
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // Private mode or storage disabled: the session only lives in memory.
  }
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${site.serverUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${site.serverUrl}${path}`, { cache: "no-store" });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data;
}

export const api = {
  nonce: (address: string) => post<NonceResponse>("/auth/nonce", { address }),
  verify: (address: string, nonce: string, message: string, signature: string) =>
    post<VerifyResponse>("/auth/verify", { address, nonce, message, signature }),
  createKeeper: (req: CreateKeeperRequest) =>
    post<{ keeper: { id: string; name: string; look: Look }; critters: Array<{ id: string; species: number; name: string }> }>(
      "/keeper",
      req,
    ),
  me: (session: string) =>
    get<{ address: string; keeper: { id: string; name: string; look: Look } | null; admitted: boolean }>(
      `/me?session=${encodeURIComponent(session)}`,
    ),
  rooms: () => get<{ rooms: RoomInfo[] }>("/rooms"),
  earn: (session: string) => get<EarnState>(`/earn?session=${encodeURIComponent(session)}`),
  cashout: (session: string, gold: number | "all") =>
    post<{ cashedOut: number; tokens: string; state: EarnState }>("/earn/cashout", { session, gold }),
  voucher: (session: string) => post<{ voucher: Voucher; history: PayoutRow[] }>("/earn/voucher", { session }),
  health: () =>
    get<{ ok: boolean; gate: "open" | "eggs"; rooms: RoomInfo[]; keepers: number; critters: number; gold: number }>(
      "/health",
    ),
};
