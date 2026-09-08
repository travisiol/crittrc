import type { IncomingMessage, ServerResponse } from "node:http";
import { config, earningConfigured, earningReason } from "./config";
import { issueNonce, resolveSession, verifySignature } from "./auth";
import { eggsOf } from "./chain";
import { earnState, formatTokens, signVoucher, solvency, tokensForGold } from "./payout";
import { limits } from "./limits";
import {
  cashOut,
  counts,
  createKeeper,
  critterForToken,
  getKeeper,
  insertCritter,
  lastNameAttempt,
  listCritters,
  listPayouts,
  nameTaken,
  recordNameAttempt,
} from "./db";
import { newCritterId, type World } from "./world";
import { LOOK_COUNTS, type CreateKeeperRequest, type Look, type VerifyResponse } from "../../web/src/shared/protocol";
import { NICKNAME_RE, SPECIES, speciesById } from "../../web/src/shared/species";

/**
 * The handful of JSON routes that happen before a WebSocket exists:
 * sign-in, the fitting room, and the numbers the landing page shows.
 */

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": config.origin,
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 16_384) throw new Error("Body too large.");
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return {};
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
}

export function clientIp(req: IncomingMessage): string {
  const fwd = req.headers["x-forwarded-for"];
  const first = Array.isArray(fwd) ? fwd[0] : fwd?.split(",")[0];
  return (first ?? req.socket.remoteAddress ?? "unknown").trim();
}

function validLook(raw: unknown): Look | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const look: Partial<Look> = {};
  for (const key of Object.keys(LOOK_COUNTS) as Array<keyof Look>) {
    const v = Number(r[key]);
    if (!Number.isInteger(v) || v < 0 || v >= LOOK_COUNTS[key]) return null;
    look[key] = v;
  }
  return look as Look;
}

/**
 * With GATE=eggs, every hatched egg the wallet holds becomes a critter the
 * first time the server sees it. Eggs still in the shell are not critters
 * yet; that is what the hatchery is for.
 */
async function syncEggs(address: string): Promise<number[]> {
  if (config.gate !== "eggs") return [];
  const eggs = await eggsOf(address);
  const keeper = getKeeper(address);
  if (keeper) {
    for (const egg of eggs) {
      if (egg.species === 0) continue;
      if (critterForToken(egg.tokenId)) continue;
      const species = speciesById(egg.species);
      insertCritter({
        id: newCritterId(),
        keeper: keeper.id,
        species: species.id,
        name: `${species.name} #${egg.tokenId}`,
        token_id: egg.tokenId,
      });
    }
  }
  return eggs.map((e) => e.tokenId);
}

export async function handleHttp(req: IncomingMessage, res: ServerResponse, world: World) {
  const url = new URL(req.url ?? "/", "http://local");
  const path = url.pathname.replace(/\/+$/, "") || "/";

  if (req.method === "OPTIONS") return json(res, 204, {});

  // Buckets before anything else, so a script cannot spend the server's
  // time or its chain reads. Health and the room list stay cheap on
  // purpose: the landing page polls them.
  const ip = clientIp(req);
  const tooFast = (limiter: { take: (k: string) => boolean; retryAfter: (k: string) => number }) => {
    if (limiter.take(ip)) return null;
    return json(res, 429, { error: `Too many requests. Try again in ${limiter.retryAfter(ip)}s.` });
  };
  if (tooFast(limits.http)) return;
  if (path.startsWith("/auth") && tooFast(limits.auth)) return;
  if (path === "/keeper" && req.method === "POST" && tooFast(limits.keeper)) return;
  if (path.startsWith("/earn") && req.method === "POST" && tooFast(limits.earn)) return;

  try {
    if (req.method === "GET" && (path === "/" || path === "/health")) {
      return json(res, 200, { ok: true, gate: config.gate, rooms: world.roomsInfo(), ...counts() });
    }

    if (req.method === "GET" && path === "/rooms") {
      return json(res, 200, { rooms: world.roomsInfo() });
    }

    if (req.method === "POST" && path === "/auth/nonce") {
      const body = await readJson(req);
      const out = issueNonce(String(body.address ?? ""));
      return json(res, 200, out);
    }

    if (req.method === "POST" && path === "/auth/verify") {
      const body = await readJson(req);
      const address = String(body.address ?? "");
      const session = await verifySignature(
        address,
        String(body.nonce ?? ""),
        String(body.message ?? ""),
        String(body.signature ?? ""),
      );
      const lower = address.toLowerCase();
      const eggs = await syncEggs(lower);
      const keeper = getKeeper(lower);
      const admitted = config.gate === "open" || eggs.length > 0;
      const out: VerifyResponse = {
        session,
        address: lower,
        keeper: keeper ? { id: keeper.id, name: keeper.name, look: keeper.look } : null,
        admitted,
        reason: admitted ? undefined : "This wallet holds no egg. One egg is the whole of what the door asks.",
        eggs,
      };
      return json(res, 200, out);
    }

    if (req.method === "POST" && path === "/keeper") {
      const body = (await readJson(req)) as Partial<CreateKeeperRequest>;
      const address = resolveSession(String(body.session ?? ""));
      if (!address) return json(res, 401, { error: "Your sign-in has expired. Connect your wallet again." });
      if (getKeeper(address)) return json(res, 409, { error: "This wallet already has a keeper." });
      const name = String(body.name ?? "").trim();
      if (!NICKNAME_RE.test(name)) return json(res, 400, { error: "A name is three to eight characters: letters, numbers and underscores." });
      if (nameTaken(name) || world.botNames.has(name.toLowerCase())) {
        return json(res, 409, { error: "That name is taken. Try another." });
      }
      const look = validLook(body.look);
      if (!look) return json(res, 400, { error: "That look does not exist." });
      const ip = clientIp(req);
      const since = Date.now() - lastNameAttempt(ip);
      if (since < config.nameCooldownSeconds * 1000) {
        return json(res, 429, { error: "Too many attempts from your connection. One name an hour is the limit. Try later." });
      }
      if (config.gate === "eggs") {
        const eggs = await eggsOf(address);
        if (eggs.length === 0) return json(res, 403, { error: "This wallet holds no egg." });
      }
      const starter = Number(body.starter);
      if (config.gate === "open" && !SPECIES.some((s) => s.id === starter)) {
        return json(res, 400, { error: "Pick a starter critter." });
      }
      const keeper = createKeeper(address, name, look);
      if (config.gate === "open") {
        const species = speciesById(starter);
        insertCritter({ id: newCritterId(), keeper: keeper.id, species: species.id, name: species.name, token_id: null });
      } else {
        await syncEggs(address);
      }
      recordNameAttempt(ip);
      return json(res, 200, {
        keeper: { id: keeper.id, name: keeper.name, look: keeper.look },
        critters: listCritters(keeper.id).map((c) => ({ id: c.id, species: c.species, name: c.name })),
      });
    }

    // ── Earning the token ─────────────────────────────────────────
    //
    // Three routes: what the bank looks like, spend gold to raise the
    // entitlement, and get a signed voucher for the wallet to submit.

    if (req.method === "GET" && path === "/earn") {
      const address = resolveSession(url.searchParams.get("session"));
      if (!address) return json(res, 401, { error: "Your sign-in has expired. Connect your wallet again." });
      const keeper = getKeeper(address);
      if (!keeper) return json(res, 404, { error: "No keeper for this wallet yet." });
      return json(res, 200, await earnState(address, keeper.gold, keeper.earned));
    }

    if (req.method === "POST" && path === "/earn/cashout") {
      const body = await readJson(req);
      const address = resolveSession(String(body.session ?? ""));
      if (!address) return json(res, 401, { error: "Your sign-in has expired. Connect your wallet again." });
      if (!earningConfigured()) return json(res, 503, { error: earningReason() ?? "Cashing out is not open yet." });
      const keeper = getKeeper(address);
      if (!keeper) return json(res, 404, { error: "No keeper for this wallet yet." });

      const asked = body.gold === "all" ? keeper.gold : Number(body.gold);
      if (!Number.isInteger(asked) || asked <= 0) return json(res, 400, { error: "Say how much gold to cash out." });
      if (asked > keeper.gold) return json(res, 400, { error: "You do not have that much gold." });
      if (asked < config.minCashoutGold) {
        return json(res, 400, {
          error: `The smallest cash-out is ${(config.minCashoutGold / 100).toFixed(2)} gold.`,
        });
      }
      const tokens = tokensForGold(asked);
      if (tokens <= 0n) return json(res, 400, { error: "That much gold is worth nothing at the current rate." });

      // Never promise what the contract cannot pay. The whole point of
      // this check is that a player finds out here, still holding their
      // gold, rather than at the claim with an entitlement nobody funds.
      const books = await solvency();
      if (!books) {
        return json(res, 503, { error: "Cannot reach the payout contract right now. Your gold is untouched; try again shortly." });
      }
      if (tokens > books.headroom) {
        return json(res, 409, {
          error:
            books.headroom === 0n
              ? "The payout contract is fully committed right now. Your gold is kept — try again once it is topped up."
              : `The payout contract can only cover ${formatTokens(books.headroom)} more ${config.rewardTokenSymbol} right now. Cash out less, or come back later.`,
        });
      }

      cashOut(keeper, asked, tokens, config.tokensPerGold);
      world.refreshKeeper(keeper.id);
      return json(res, 200, {
        cashedOut: asked,
        tokens: tokens.toString(),
        state: await earnState(address, keeper.gold, keeper.earned),
      });
    }

    if (req.method === "POST" && path === "/earn/voucher") {
      const body = await readJson(req);
      const address = resolveSession(String(body.session ?? ""));
      if (!address) return json(res, 401, { error: "Your sign-in has expired. Connect your wallet again." });
      if (!earningConfigured()) return json(res, 503, { error: earningReason() ?? "Claiming is not open yet." });
      const keeper = getKeeper(address);
      if (!keeper) return json(res, 404, { error: "No keeper for this wallet yet." });
      if (keeper.earned <= 0n) return json(res, 400, { error: "Nothing to claim yet. Cash some gold out first." });
      const voucher = await signVoucher(address, keeper.earned);
      return json(res, 200, { voucher, history: listPayouts(keeper.id, 8) });
    }

    if (req.method === "GET" && path === "/me") {
      const address = resolveSession(url.searchParams.get("session"));
      if (!address) return json(res, 401, { error: "expired" });
      const keeper = getKeeper(address);
      return json(res, 200, {
        address,
        keeper: keeper ? { id: keeper.id, name: keeper.name, look: keeper.look } : null,
        admitted: config.gate === "open" || (await eggsOf(address)).length > 0,
      });
    }

    return json(res, 404, { error: "not found" });
  } catch (e) {
    const text = e instanceof Error ? e.message : "Something went wrong.";
    return json(res, 400, { error: text });
  }
}
