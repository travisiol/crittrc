import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "./config";
import type { Look, BagEntry } from "../../web/src/shared/protocol";

/**
 * SQLite through Node's built-in driver: no native build step, one file on
 * disk. Every write that changes gold or a bag goes through here, and the
 * ledger keeps the audit trail a reward window is computed from.
 */

export interface KeeperRow {
  id: string;
  name: string;
  look: Look;
  gold: number;
  sold_day: string;
  sold_today: number;
  nest_collected_at: number;
  created_at: number;
  /** Cumulative token entitlement, in the token's smallest unit. */
  earned: bigint;
}

export interface CritterRow {
  id: string;
  keeper: string;
  species: number;
  name: string;
  token_id: number | null;
  fed: number;
  created_at: number;
}

mkdirSync(dirname(config.dbPath), { recursive: true });
export const db = new DatabaseSync(config.dbPath);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS keepers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    look TEXT NOT NULL,
    gold INTEGER NOT NULL DEFAULT 0,
    sold_day TEXT NOT NULL DEFAULT '',
    sold_today INTEGER NOT NULL DEFAULT 0,
    nest_collected_at INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS critters (
    id TEXT PRIMARY KEY,
    keeper TEXT NOT NULL REFERENCES keepers(id),
    species INTEGER NOT NULL,
    name TEXT NOT NULL,
    token_id INTEGER,
    fed INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS critters_keeper ON critters(keeper);
  CREATE UNIQUE INDEX IF NOT EXISTS critters_token ON critters(token_id) WHERE token_id IS NOT NULL;

  CREATE TABLE IF NOT EXISTS bag (
    keeper TEXT NOT NULL REFERENCES keepers(id),
    item TEXT NOT NULL,
    qty INTEGER NOT NULL,
    PRIMARY KEY (keeper, item)
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    address TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS nonces (
    nonce TEXT PRIMARY KEY,
    address TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    keeper TEXT NOT NULL,
    kind TEXT NOT NULL,
    item TEXT,
    qty INTEGER NOT NULL DEFAULT 0,
    gold INTEGER NOT NULL DEFAULT 0,
    at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS ledger_keeper ON ledger(keeper, at);

  CREATE TABLE IF NOT EXISTS name_attempts (
    ip TEXT PRIMARY KEY,
    at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS payouts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    keeper TEXT NOT NULL,
    gold INTEGER NOT NULL,
    tokens TEXT NOT NULL,
    rate TEXT NOT NULL,
    at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS payouts_keeper ON payouts(keeper, at);

  CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

/**
 * `earned` is the cumulative token entitlement in the token's smallest
 * unit, held as text because SQLite integers are 64-bit and token amounts
 * are not. It arrived after the first keepers did, so it is added by
 * migration rather than being in the CREATE above.
 */
{
  const cols = db.prepare("PRAGMA table_info(keepers)").all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === "earned")) {
    db.exec("ALTER TABLE keepers ADD COLUMN earned TEXT NOT NULL DEFAULT '0'");
  }
}

const qMeta = db.prepare("SELECT value FROM meta WHERE key = ?");
const qSetMeta = db.prepare(
  "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
);

export function getMeta(key: string): string | null {
  const r = qMeta.get(key) as { value: string } | undefined;
  return r ? r.value : null;
}

export function setMeta(key: string, value: string) {
  qSetMeta.run(key, value);
}

/**
 * Everything the server has ever vouched for, across all keepers. Kept as
 * a running total rather than summed on demand: SQLite cannot add these
 * numbers, they are larger than its integers.
 */
export function totalEarned(): bigint {
  const stored = getMeta("total_earned");
  if (stored !== null) return BigInt(stored);
  // First run after the column arrived: add up what is already there.
  const rows = db.prepare("SELECT earned FROM keepers").all() as Array<{ earned: string | null }>;
  const sum = rows.reduce((acc, r) => acc + BigInt(r.earned ?? "0"), 0n);
  setMeta("total_earned", sum.toString());
  return sum;
}

const now = () => Date.now();

// ── Keepers ─────────────────────────────────────────────────────────

const qKeeper = db.prepare("SELECT * FROM keepers WHERE id = ?");
const qKeeperByName = db.prepare("SELECT id FROM keepers WHERE name = ?");
const qInsertKeeper = db.prepare(
  "INSERT INTO keepers (id, name, look, gold, created_at) VALUES (?, ?, ?, 0, ?)",
);
const qSetGold = db.prepare("UPDATE keepers SET gold = ? WHERE id = ?");
const qSetSold = db.prepare("UPDATE keepers SET sold_day = ?, sold_today = ? WHERE id = ?");
const qSetNest = db.prepare("UPDATE keepers SET nest_collected_at = ? WHERE id = ?");

function rowToKeeper(r: Record<string, unknown>): KeeperRow {
  return {
    id: r.id as string,
    name: r.name as string,
    look: JSON.parse(r.look as string) as Look,
    gold: Number(r.gold),
    sold_day: r.sold_day as string,
    sold_today: Number(r.sold_today),
    nest_collected_at: Number(r.nest_collected_at),
    created_at: Number(r.created_at),
    earned: BigInt((r.earned as string | null) ?? "0"),
  };
}

export function getKeeper(id: string): KeeperRow | null {
  const r = qKeeper.get(id) as Record<string, unknown> | undefined;
  return r ? rowToKeeper(r) : null;
}

export function nameTaken(name: string): boolean {
  return !!qKeeperByName.get(name);
}

export function createKeeper(id: string, name: string, look: Look): KeeperRow {
  qInsertKeeper.run(id, name, JSON.stringify(look), now());
  return getKeeper(id)!;
}

export function setGold(id: string, gold: number) {
  qSetGold.run(gold, id);
}

export function setSold(id: string, day: string, soldToday: number) {
  qSetSold.run(day, soldToday, id);
}

export function setNestCollected(id: string, at: number) {
  qSetNest.run(at, id);
}

// ── Critters ────────────────────────────────────────────────────────

const qCritters = db.prepare("SELECT * FROM critters WHERE keeper = ? ORDER BY created_at, id");
const qInsertCritter = db.prepare(
  "INSERT INTO critters (id, keeper, species, name, token_id, fed, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)",
);
const qSetFed = db.prepare("UPDATE critters SET fed = ? WHERE id = ?");
const qCritterByToken = db.prepare("SELECT id FROM critters WHERE token_id = ?");
const qDeleteCritter = db.prepare("DELETE FROM critters WHERE id = ?");

export function listCritters(keeper: string): CritterRow[] {
  return (qCritters.all(keeper) as Record<string, unknown>[]).map((r) => ({
    id: r.id as string,
    keeper: r.keeper as string,
    species: Number(r.species),
    name: r.name as string,
    token_id: r.token_id === null ? null : Number(r.token_id),
    fed: Number(r.fed),
    created_at: Number(r.created_at),
  }));
}

export function insertCritter(c: Omit<CritterRow, "fed" | "created_at">) {
  qInsertCritter.run(c.id, c.keeper, c.species, c.name, c.token_id, now());
}

export function setFed(id: string, fed: boolean) {
  qSetFed.run(fed ? 1 : 0, id);
}

export function critterForToken(tokenId: number): string | null {
  const r = qCritterByToken.get(tokenId) as { id: string } | undefined;
  return r ? r.id : null;
}

export function deleteCritter(id: string) {
  qDeleteCritter.run(id);
}

// ── Bag ─────────────────────────────────────────────────────────────

const qBag = db.prepare("SELECT item, qty FROM bag WHERE keeper = ? ORDER BY item");
const qBagItem = db.prepare("SELECT qty FROM bag WHERE keeper = ? AND item = ?");
const qUpsertBag = db.prepare(
  "INSERT INTO bag (keeper, item, qty) VALUES (?, ?, ?) ON CONFLICT(keeper, item) DO UPDATE SET qty = excluded.qty",
);
const qDeleteBag = db.prepare("DELETE FROM bag WHERE keeper = ? AND item = ?");

export function getBag(keeper: string): BagEntry[] {
  return (qBag.all(keeper) as { item: string; qty: number }[]).map((r) => ({
    item: r.item,
    qty: Number(r.qty),
  }));
}

export function bagCount(keeper: string): number {
  return getBag(keeper).reduce((s, e) => s + e.qty, 0);
}

export function addToBag(keeper: string, item: string, delta: number): number {
  const cur = (qBagItem.get(keeper, item) as { qty: number } | undefined)?.qty ?? 0;
  const next = Number(cur) + delta;
  if (next <= 0) qDeleteBag.run(keeper, item);
  else qUpsertBag.run(keeper, item, next);
  return Math.max(0, next);
}

// ── Earning the token ───────────────────────────────────────────────

const qSetEarned = db.prepare("UPDATE keepers SET gold = ?, earned = ? WHERE id = ?");
const qInsertPayout = db.prepare(
  "INSERT INTO payouts (keeper, gold, tokens, rate, at) VALUES (?, ?, ?, ?, ?)",
);
const qPayouts = db.prepare("SELECT gold, tokens, rate, at FROM payouts WHERE keeper = ? ORDER BY id DESC LIMIT ?");

/**
 * Spend gold and raise the cumulative entitlement in one transaction, so a
 * crash can never leave a keeper credited with tokens they still hold the
 * gold for, or the other way round.
 */
export function cashOut(k: KeeperRow, gold: number, tokens: bigint, rate: string) {
  const runningBefore = totalEarned();
  transaction(() => {
    k.gold -= gold;
    k.earned += tokens;
    qSetEarned.run(k.gold, k.earned.toString(), k.id);
    qInsertPayout.run(k.id, gold, tokens.toString(), rate, Date.now());
    qLedger.run(k.id, "cashout", null, 0, -gold, Date.now());
    qSetMeta.run("total_earned", (runningBefore + tokens).toString());
  });
}

export function listPayouts(keeper: string, limit = 10): Array<{ gold: number; tokens: string; rate: string; at: number }> {
  return (qPayouts.all(keeper, limit) as Array<{ gold: number; tokens: string; rate: string; at: number }>).map((r) => ({
    gold: Number(r.gold),
    tokens: String(r.tokens),
    rate: String(r.rate),
    at: Number(r.at),
  }));
}

// ── Ledger ──────────────────────────────────────────────────────────

const qLedger = db.prepare(
  "INSERT INTO ledger (keeper, kind, item, qty, gold, at) VALUES (?, ?, ?, ?, ?, ?)",
);

export function ledger(keeper: string, kind: string, item: string | null, qty: number, gold: number) {
  qLedger.run(keeper, kind, item, qty, gold, now());
}

// ── Sessions and nonces ─────────────────────────────────────────────

const qInsertSession = db.prepare("INSERT INTO sessions (token, address, created_at) VALUES (?, ?, ?)");
const qSession = db.prepare("SELECT address, created_at FROM sessions WHERE token = ?");
const qDeleteSession = db.prepare("DELETE FROM sessions WHERE token = ?");
const qInsertNonce = db.prepare("INSERT INTO nonces (nonce, address, created_at) VALUES (?, ?, ?)");
const qNonce = db.prepare("SELECT address, created_at FROM nonces WHERE nonce = ?");
const qDeleteNonce = db.prepare("DELETE FROM nonces WHERE nonce = ?");
const qPruneNonces = db.prepare("DELETE FROM nonces WHERE created_at < ?");
const qPruneSessions = db.prepare("DELETE FROM sessions WHERE created_at < ?");

export function insertSession(token: string, address: string) {
  qInsertSession.run(token, address, now());
}

export function sessionAddress(token: string): string | null {
  const r = qSession.get(token) as { address: string; created_at: number } | undefined;
  if (!r) return null;
  if (now() - Number(r.created_at) > config.sessionDays * 86_400_000) {
    qDeleteSession.run(token);
    return null;
  }
  return r.address;
}

export function insertNonce(nonce: string, address: string) {
  qInsertNonce.run(nonce, address, now());
}

/** Returns the address a nonce was issued to and burns it. */
export function consumeNonce(nonce: string): string | null {
  const r = qNonce.get(nonce) as { address: string; created_at: number } | undefined;
  if (!r) return null;
  qDeleteNonce.run(nonce);
  if (now() - Number(r.created_at) > 10 * 60_000) return null;
  return r.address;
}

export function prune() {
  qPruneNonces.run(now() - 60 * 60_000);
  qPruneSessions.run(now() - config.sessionDays * 86_400_000);
}

// ── Name cooldown ───────────────────────────────────────────────────

const qAttempt = db.prepare("SELECT at FROM name_attempts WHERE ip = ?");
const qSetAttempt = db.prepare(
  "INSERT INTO name_attempts (ip, at) VALUES (?, ?) ON CONFLICT(ip) DO UPDATE SET at = excluded.at",
);

export function lastNameAttempt(ip: string): number {
  const r = qAttempt.get(ip) as { at: number } | undefined;
  return r ? Number(r.at) : 0;
}

export function recordNameAttempt(ip: string) {
  qSetAttempt.run(ip, now());
}

/** Stats for the landing page and the snapshot script. */
export function counts(): { keepers: number; critters: number; gold: number } {
  const k = db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(gold),0) AS g FROM keepers").get() as {
    n: number;
    g: number;
  };
  const c = db.prepare("SELECT COUNT(*) AS n FROM critters").get() as { n: number };
  return { keepers: Number(k.n), critters: Number(c.n), gold: Number(k.g) };
}

export function transaction<T>(fn: () => T): T {
  db.exec("BEGIN");
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
