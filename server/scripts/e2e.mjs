/**
 * End-to-end smoke test against a running world server.
 *
 *   JOB_SCALE=0.05 npm run dev        (in another terminal)
 *   node scripts/e2e.mjs [http://localhost:8787]
 *
 * Signs in with a throwaway key, makes a keeper, walks to the thicket,
 * sends the starter critter foraging, waits for it, walks to the trader
 * and sells. Exits non-zero on the first thing that does not happen.
 */
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import WebSocket from "ws";

const base = process.argv[2] ?? "http://localhost:8787";
const wsBase = base.replace(/^http/, "ws") + "/ws";

const log = (...a) => console.log("[e2e]", ...a);
const fail = (m) => {
  console.error("[e2e] FAIL:", m);
  process.exit(1);
};

async function post(path, body) {
  const r = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(`${path}: ${j.error ?? r.status}`);
  return j;
}

const account = privateKeyToAccount(generatePrivateKey());
log("wallet", account.address);

const { message, nonce } = await post("/auth/nonce", { address: account.address });
const signature = await account.signMessage({ message });
const v = await post("/auth/verify", { address: account.address, nonce, message, signature });
if (!v.session || !v.admitted || v.keeper) fail("verify shape");
log("signed in, admitted, no keeper yet");

const name = "e2e" + Math.floor(Math.random() * 90000 + 10000);
const created = await post("/keeper", { session: v.session, name, look: { skin: 1, eyes: 0, outfit: 2, hair: 3, hat: 1 }, starter: 1 });
if (created.keeper.name !== name || created.critters.length !== 1) fail("keeper create");
log("keeper", name, "with", created.critters[0].name);

// Same wallet, second keeper must be refused.
await post("/keeper", { session: v.session, name: name + "x", look: { skin: 0, eyes: 0, outfit: 0, hair: 0, hat: 0 }, starter: 2 })
  .then(() => fail("second keeper accepted"))
  .catch((e) => log("second keeper refused:", e.message));

const ws = new WebSocket(wsBase);
const inbox = [];
const waiters = [];
ws.on("message", (d) => {
  const m = JSON.parse(String(d));
  if (process.env.E2E_DEBUG && m.t !== "snapshot") log("<-", JSON.stringify(m).slice(0, 160));
  inbox.push(m);
  for (const w of [...waiters]) if (w.pred(m)) {
    waiters.splice(waiters.indexOf(w), 1);
    w.resolve(m);
  }
});
const next = (pred, ms = 8000) =>
  new Promise((resolve, reject) => {
    const hit = inbox.find(pred);
    if (hit) return resolve(hit);
    const w = { pred, resolve: (m) => { clearTimeout(timer); resolve(m); } };
    waiters.push(w);
    const timer = setTimeout(() => {
      const i = waiters.indexOf(w);
      if (i >= 0) waiters.splice(i, 1);
      reject(new Error("timeout waiting for " + pred.toString()));
    }, ms);
  });
const send = (m) => ws.send(JSON.stringify(m));

await new Promise((r) => ws.on("open", r));
send({ t: "hello", session: v.session, room: "meadow-1" });
const welcome = await next((m) => m.t === "welcome");
if (!welcome.self || welcome.self.name !== name) fail("welcome self");
log("in", welcome.room.name, "jobs", JSON.stringify(welcome.jobSeconds));
let self = welcome.self;
const critter = self.critters[0];

const snap = await next((m) => m.t === "snapshot");
log("snapshot: players", snap.players.length, "critters", snap.critters.length, "wild", snap.wild.length);
if (snap.wild.length === 0) fail("no wild critters");

// Teleport-speed moves must be refused (correction comes back as t:"map").
inbox.length = 0;
send({ t: "move", x: 8.5, y: 11.5, facing: "left", moving: false });
const corr = await next((m) => m.t === "map");
log("far move corrected back to", corr.x, corr.y);

// Walk to the thicket hollow one small step at a time.
async function walkTo(tx, ty) {
  let { x, y } = corr;
  // Straight-line path through the plaza and along the west path (y=18).
  const path = [
    [16.5, y],
    [16.5, 18.5],
    [9.5, 18.5],
    [9.5, 14.5],
    [9.5, 11.5],
    [tx, ty],
  ];
  for (const [px, py] of path) {
    while (Math.hypot(px - x, py - y) > 0.05) {
      const d = Math.hypot(px - x, py - y);
      const step = Math.min(0.25, d);
      x += ((px - x) / d) * step;
      y += ((py - y) / d) * step;
      send({ t: "move", x, y, facing: "left", moving: true });
      await new Promise((r) => setTimeout(r, 40));
    }
  }
  return { x, y };
}
inbox.length = 0;
const pos = await walkTo(8.5, 11.5);
await new Promise((r) => setTimeout(r, 300));
if (inbox.some((m) => m.t === "map")) fail("walk was corrected: " + JSON.stringify(inbox.filter((m) => m.t === "map").pop()));
log("walked to the thicket at", pos.x.toFixed(2), pos.y.toFixed(2));

send({ t: "job:start", spotId: "thicket_1", critterId: critter.id });
const started = await next((m) => m.t === "self" && m.self.critters[0].state === "work");
log("job started, ends in", Math.round((started.self.critters[0].job.endsAt - Date.now()) / 1000), "s");

// Sending the same critter again must be refused while it works.
send({ t: "job:start", spotId: "thicket_2", critterId: critter.id });
const busy = await next((m) => m.t === "toast" && /already working/.test(m.text));
log("double send refused:", busy.text);

const done = await next((m) => m.t === "job:done", 20000);
log("job done:", done.critterName, "brought", done.item);
self = (await next((m) => m.t === "self" && m.self.bag.length > 0)).self;
if (self.bag.reduce((s, b) => s + b.qty, 0) !== 1) fail("bag should hold one item");

// Selling far from the trader must be refused.
send({ t: "trade:sell", items: "all" });
const far = await next((m) => m.t === "toast" && /Walk up to the trader/.test(m.text));
log("sell from afar refused:", far.text);

// Walk to the trader: back along the path, then up to the hut door.
{
  let { x, y } = pos;
  const path = [
    [9.5, 14.5],
    [9.5, 18.5],
    [20.5, 18.5],
    [20.5, 10.5],
  ];
  for (const [px, py] of path) {
    while (Math.hypot(px - x, py - y) > 0.05) {
      const d = Math.hypot(px - x, py - y);
      const step = Math.min(0.25, d);
      x += ((px - x) / d) * step;
      y += ((py - y) / d) * step;
      send({ t: "move", x, y, facing: "up", moving: true });
      await new Promise((r) => setTimeout(r, 40));
    }
  }
}
inbox.length = 0;
send({ t: "trade:sell", items: "all" });
const sold = await next((m) => m.t === "toast" && /(Sold|junk)/.test(m.text));
log("trader:", sold.text);
self = (await next((m) => m.t === "self")).self;
log("gold now", self.gold, "bag", self.bag.length);

// Buy a treat if we can afford one, then feed.
if (self.gold >= 50) {
  send({ t: "trade:buy", item: "treat", qty: 1 });
  const bought = await next((m) => m.t === "toast" && /Bought/.test(m.text));
  log(bought.text);
  send({ t: "feed", critterId: critter.id });
  const fed = await next((m) => m.t === "toast" && /ate the treat/.test(m.text));
  log(fed.text);
}

// Chat round trip.
send({ t: "chat", channel: "town", text: "hello meadow" });
const chat = await next((m) => m.t === "chat" && m.text === "hello meadow");
log("chat echoed from", chat.from);

// Second connection with the same keeper kicks the first.
const ws2 = new WebSocket(wsBase);
await new Promise((r) => ws2.on("open", r));
ws2.send(JSON.stringify({ t: "hello", session: v.session, room: "meadow-1" }));
const kicked = await next((m) => m.t === "error" && /somewhere else/.test(m.text));
log("duplicate login:", kicked.text);
ws2.close();
ws.close();

const health = await fetch(base + "/health").then((r) => r.json());
log("health keepers", health.keepers, "critters", health.critters);
log("OK");
process.exit(0);
