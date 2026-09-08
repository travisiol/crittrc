/**
 * Proves taming end to end: sign in, hold treats, walk to a wild critter
 * with the game's own pathfinder, offer treats until its trust fills, and
 * check it is in the keeper's party and in the database afterwards.
 *
 *   cd server && JOB_SCALE=0.05 NAME_COOLDOWN_SECONDS=0 npm run dev
 *   cd server && npx tsx scripts/tame-e2e.ts
 *
 * Treats are put straight into the bag: buying them is already covered by
 * scripts/e2e.mjs, and this script is about the catching.
 */
import { DatabaseSync } from "node:sqlite";
import WebSocket from "ws";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { canStand, findPath, getMap } from "../../web/src/shared/maps";
import { MAX_CRITTERS } from "../../web/src/shared/species";
import type { ServerMsg, WildView } from "../../web/src/shared/protocol";

const base = process.env.SERVER ?? "http://localhost:8787";
const dbPath = process.env.DB_PATH ?? "./data/crittr.sqlite";
const TREATS = 12;

const log = (...a: unknown[]) => console.log("[tame]", ...a);
const fail = (m: string): never => {
  console.error("[tame] FAIL:", m);
  process.exit(1);
};

async function call<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(base + path, {
    method: body ? "POST" : "GET",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(`${path}: ${json.error ?? res.status}`);
  return json;
}

const account = privateKeyToAccount(generatePrivateKey());
log("wallet", account.address);

const { message, nonce } = await call<{ message: string; nonce: string }>("/auth/nonce", { address: account.address });
const signature = await account.signMessage({ message });
const { session } = await call<{ session: string }>("/auth/verify", {
  address: account.address,
  nonce,
  message,
  signature,
});
const name = "tame" + Math.floor(Math.random() * 9000 + 1000);
await call("/keeper", { session, name, look: { skin: 0, eyes: 0, outfit: 0, hair: 0, hat: 0 }, starter: 1 });
log("keeper", name);

{
  const db = new DatabaseSync(dbPath);
  db.prepare(
    "INSERT INTO bag (keeper, item, qty) VALUES (?, 'treat', ?) ON CONFLICT(keeper, item) DO UPDATE SET qty = excluded.qty",
  ).run(account.address.toLowerCase(), TREATS);
  db.close();
  log("gave", TREATS, "treats");
}

// ── Socket ───────────────────────────────────────────────────────────
const ws = new WebSocket(base.replace(/^http/, "ws") + "/ws");
const inbox: ServerMsg[] = [];
const waiters: Array<{ pred: (m: ServerMsg) => boolean; resolve: (m: ServerMsg) => void }> = [];
ws.on("message", (d) => {
  const m = JSON.parse(String(d)) as ServerMsg;
  inbox.push(m);
  for (const w of [...waiters]) {
    if (!w.pred(m)) continue;
    waiters.splice(waiters.indexOf(w), 1);
    w.resolve(m);
  }
});
const next = (pred: (m: ServerMsg) => boolean, ms = 10000) =>
  new Promise<ServerMsg>((resolve, reject) => {
    const hit = inbox.find(pred);
    if (hit) return resolve(hit);
    const entry = {
      pred,
      resolve: (m: ServerMsg) => {
        clearTimeout(timer);
        resolve(m);
      },
    };
    waiters.push(entry);
    const timer = setTimeout(() => {
      const i = waiters.indexOf(entry);
      if (i >= 0) waiters.splice(i, 1);
      reject(new Error("timed out waiting for a message"));
    }, ms);
  });
const send = (m: unknown) => ws.send(JSON.stringify(m));

await new Promise<void>((r) => ws.on("open", () => r()));
send({ t: "hello", session, room: "meadow-1" });
const welcome = await next((m) => m.t === "welcome");
if (welcome.t !== "welcome" || !welcome.self) fail("no welcome");
const startCritters = welcome.t === "welcome" && welcome.self ? welcome.self.critters.length : 0;
log("in the meadow with", startCritters, "critter(s)");

const map = getMap("meadow");
let me = { x: map.spawn.x + 0.5, y: map.spawn.y + 0.5 };

async function snapshot() {
  inbox.length = 0;
  const m = await next((x) => x.t === "snapshot");
  if (m.t !== "snapshot") throw new Error("not a snapshot");
  return m;
}

/** Walk a real path, one small step at a time, like a player would. */
async function walkTo(tx: number, ty: number): Promise<boolean> {
  const path = findPath(map, me, { x: tx, y: ty });
  if (!path) return false;
  for (const point of path) {
    while (Math.hypot(point.x - me.x, point.y - me.y) > 0.06) {
      const dx = point.x - me.x;
      const dy = point.y - me.y;
      const d = Math.hypot(dx, dy);
      const step = Math.min(0.22, d);
      me = { x: me.x + (dx / d) * step, y: me.y + (dy / d) * step };
      send({ t: "move", x: me.x, y: me.y, facing: "down", moving: true });
      await new Promise((r) => setTimeout(r, 35));
    }
  }
  send({ t: "move", x: me.x, y: me.y, facing: "down", moving: false });
  return true;
}

// ── Find a wild critter standing somewhere reachable ──────────────────
let target: WildView | null = null;
for (let attempt = 0; attempt < 25 && !target; attempt++) {
  const snap = await snapshot();
  const reachable = snap.wild
    .filter((w) => canStand(map, w.x, w.y) && findPath(map, me, { x: w.x, y: w.y }))
    .sort((a, b) => Math.hypot(a.x - me.x, a.y - me.y) - Math.hypot(b.x - me.x, b.y - me.y));
  target = reachable[0] ?? null;
  if (!target) await new Promise((r) => setTimeout(r, 500));
}
if (!target) fail("no reachable wild critter in twenty-five snapshots");
log("courting", target!.id, "at", target!.x.toFixed(1), target!.y.toFixed(1));

// Offering from too far away must be refused, before anything else.
send({ t: "tame", wildId: target!.id });
const far = await next((m) => m.t === "toast" && /Too far away/.test(m.text));
if (far.t === "toast") log("offer from afar refused:", far.text);

// ── Walk over and offer treats until it joins ─────────────────────────
let joined = false;
for (let round = 0; round < 8 && !joined; round++) {
  const snap = await snapshot();
  const seen = snap.wild.find((w) => w.id === target!.id);
  if (!seen) {
    if (round === 0) fail("the critter vanished before the first treat");
    break;
  }
  if (Math.hypot(seen.x - me.x, seen.y - me.y) > 1.6) {
    const ok = await walkTo(seen.x, seen.y);
    if (!ok) {
      log("it moved somewhere unreachable; waiting");
      await new Promise((r) => setTimeout(r, 800));
      continue;
    }
  }
  inbox.length = 0;
  send({ t: "tame", wildId: target!.id });
  const said = await next((m) => m.t === "toast");
  if (said.t === "toast") {
    log(said.text);
    if (/coming with you/.test(said.text)) joined = true;
    else if (/Too far away/.test(said.text)) continue;
    else if (/need a treat/.test(said.text)) fail("ran out of treats before it joined");
  }
}
if (!joined) fail("eight rounds of treats and it still did not join");

// ── It should be in the party, in the database, and off the map ───────
const self = await next((m) => m.t === "self" && m.self.critters.length > startCritters, 8000);
if (self.t !== "self") fail("no self update");
log("party is now", self.self.critters.map((c) => c.name).join(", "));
if (self.self.critters.length !== startCritters + 1) fail("party did not grow by exactly one");
if (self.self.critters.length > MAX_CRITTERS) fail("party is over the cap");

const treatsLeft = self.self.bag.find((b) => b.item === "treat")?.qty ?? 0;
if (treatsLeft >= TREATS) fail("treats were not spent");
log("treats left:", treatsLeft);

{
  const db = new DatabaseSync(dbPath);
  const rows = db.prepare("SELECT species, name FROM critters WHERE keeper = ?").all(account.address.toLowerCase());
  db.close();
  if (rows.length !== startCritters + 1) fail(`database has ${rows.length} critters, expected ${startCritters + 1}`);
  log("database agrees:", rows.length, "critters");
}

const after = await snapshot();
if (after.wild.some((w) => w.id === target!.id)) fail("the tamed critter is still wild in the meadow");
log("it is off the map, and the meadow still has", after.wild.length, "wild critters");

ws.close();
log("OK");
process.exit(0);
