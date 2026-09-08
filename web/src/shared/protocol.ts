import type { Facing, MapId } from "./maps";
import type { JobKind } from "./species";

/**
 * Wire format between the game client and the world server. Plain JSON,
 * one object per frame, `t` is the tag. Kept in one file so both sides
 * compile against the same shapes.
 */

export interface Look {
  skin: number;
  eyes: number;
  outfit: number;
  hair: number;
  hat: number;
}

export const LOOK_COUNTS: Record<keyof Look, number> = {
  skin: 4,
  eyes: 3,
  outfit: 6,
  hair: 6,
  hat: 4,
};

export interface PlayerView {
  id: string;
  name: string;
  look: Look;
  x: number;
  y: number;
  facing: Facing;
  moving: boolean;
}

export type CritterState = "follow" | "work" | "rest";

export interface CritterView {
  id: string;
  owner: string;
  species: number;
  name: string;
  x: number;
  y: number;
  facing: Facing;
  moving: boolean;
  state: CritterState;
  /** Present while working. */
  job?: { spotId: string; kind: JobKind; endsAt: number; startedAt: number };
}

export interface WildView {
  id: string;
  species: number;
  x: number;
  y: number;
  facing: Facing;
  moving: boolean;
  /** 0 to TRUST_FULL. Filled with treats; it joins whoever fills it. */
  trust: number;
}

export interface OwnedCritter {
  id: string;
  species: number;
  name: string;
  fed: boolean;
  /** Token id when the critter came from an egg; null for a starter. */
  tokenId: number | null;
  state: CritterState;
  job?: { spotId: string; kind: JobKind; endsAt: number; startedAt: number };
}

export interface BagEntry {
  item: string;
  qty: number;
}

export interface SelfState {
  id: string;
  name: string;
  look: Look;
  gold: number;
  bag: BagEntry[];
  bagCapacity: number;
  critters: OwnedCritter[];
  /** Gold the trader has already paid today and the daily cap. */
  soldToday: number;
  traderCap: number;
  /** Keepsakes waiting at the den board, by item key. */
  nest: BagEntry[];
  nestReadyAt: number;
  map: MapId;
}

export interface RoomInfo {
  id: string;
  name: string;
  count: number;
  cap: number;
}

// ── Client → server ─────────────────────────────────────────────────

export type ClientMsg =
  | { t: "hello"; session?: string; room: string }
  | { t: "move"; x: number; y: number; facing: Facing; moving: boolean }
  | { t: "job:start"; spotId: string; critterId: string }
  | { t: "job:cancel"; critterId: string }
  | { t: "trade:sell"; items: string[] | "all" }
  | { t: "trade:buy"; item: string; qty: number }
  | { t: "feed"; critterId: string }
  | { t: "tame"; wildId: string }
  | { t: "gate"; to: MapId }
  | { t: "board:collect" }
  | { t: "chat"; channel: "town" | "world"; text: string }
  | { t: "ping"; at: number };

// ── Server → client ─────────────────────────────────────────────────

export type ServerMsg =
  | {
      t: "welcome";
      room: RoomInfo;
      map: MapId;
      self: SelfState | null;
      serverTime: number;
      jobSeconds: Record<JobKind, number>;
    }
  | {
      t: "snapshot";
      at: number;
      map: MapId;
      players: PlayerView[];
      critters: CritterView[];
      wild: WildView[];
      spotLoad: Record<string, number>;
    }
  | { t: "self"; self: SelfState }
  | { t: "job:done"; critterId: string; critterName: string; item: string; kind: JobKind }
  | { t: "toast"; text: string; kind: "info" | "warn" | "good" }
  | { t: "chat"; channel: "town" | "world"; from: string; fromId: string; text: string; at: number }
  | { t: "map"; map: MapId; x: number; y: number }
  | { t: "error"; text: string }
  | { t: "pong"; at: number; serverTime: number }
  | { t: "online"; rooms: RoomInfo[] };

export const CHAT_MAX = 72;
export const MOVE_HZ = 15;
export const SNAPSHOT_HZ = 10;
/** Tiles per second. */
export const WALK_SPEED = 4.2;

/** HTTP shapes. */
export interface NonceResponse {
  message: string;
  nonce: string;
}
export interface VerifyResponse {
  session: string;
  address: string;
  keeper: { id: string; name: string; look: Look } | null;
  /** The door: true when the wallet may enter (holds an egg, or the gate is open). */
  admitted: boolean;
  reason?: string;
  eggs: number[];
}
export interface CreateKeeperRequest {
  session: string;
  name: string;
  look: Look;
  starter: number;
}

/**
 * The bank. Gold is spent to raise a cumulative token entitlement; the
 * player then claims that entitlement from their own wallet with a voucher
 * the server signs. Every amount below is a decimal string in the token's
 * smallest unit, because these do not fit in a JavaScript number.
 */
export interface EarnState {
  enabled: boolean;
  reason: string | null;
  symbol: string;
  decimals: number;
  /** Whole tokens per 1.00 gold. Published, and it can change. */
  rate: string;
  minCashoutGold: number;
  payout: string | null;
  token: string | null;
  chainId: number;
  gold: number;
  /** What the gold in hand is worth at the current rate. */
  goldWorth: string;
  /** Cumulative entitlement the server will vouch for. */
  earned: string;
  /** Cumulative already pulled out of the contract. Null when off chain reads fail. */
  claimedOnChain: string | null;
  claimable: string | null;
  potHolds: string | null;
  potPaused: boolean;
  signerMatches: boolean | null;
  /** Promised to everyone and not yet claimed. */
  owed: string | null;
  /** What may still be promised before the contract would be overdrawn. */
  headroom: string | null;
}

export interface Voucher {
  account: string;
  cumulative: string;
  deadline: number;
  signature: string;
  payout: string;
  chainId: number;
}

export interface PayoutRow {
  gold: number;
  tokens: string;
  rate: string;
  at: number;
}
