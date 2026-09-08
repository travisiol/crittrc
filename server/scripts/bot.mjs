/**
 * A keeper that walks to the thicket and keeps its critter foraging, so a
 * spectator (or a screenshot) has something to look at.
 *
 *   node scripts/bot.mjs [seconds=90] [http://localhost:8787]
 */
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import WebSocket from "ws";

const seconds = Number(process.argv[2] ?? 90);
const base = process.argv[3] ?? "http://localhost:8787";
const wsBase = base.replace(/^http/, "ws") + "/ws";
const log = (...a) => console.log("[bot]", ...a);

async function post(path, body) {
  const r = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(`${path}: ${j.error ?? r.status}`);
  return j;
}

const account = privateKeyToAccount(generatePrivateKey());
const { message, nonce } = await post("/auth/nonce", { address: account.address });
const signature = await account.signMessage({ message });
const v = await post("/auth/verify", { address: account.address, nonce, message, signature });
const name = "bot" + Math.floor(Math.random() * 9000 + 1000);
await post("/keeper", { session: v.session, name, look: { skin: 2, eyes: 2, outfit: 1, hair: 4, hat: 2 }, starter: 1 });
log("keeper", name);

const ws = new WebSocket(wsBase);
const send = (m) => ws.send(JSON.stringify(m));
let self = null;
let pos = { x: 22.5, y: 21.5 };
ws.on("message", (d) => {
  const m = JSON.parse(String(d));
  if (m.t === "welcome") self = m.self;
  if (m.t === "self") self = m.self;
  if (m.t === "toast") log(m.text);
  if (m.t === "job:done") log("brought", m.item);
  if (m.t === "map") pos = { x: m.x, y: m.y };
});
await new Promise((r) => ws.on("open", r));
send({ t: "hello", session: v.session, room: "meadow-1" });
await new Promise((r) => setTimeout(r, 500));

async function walk(path) {
  let { x, y } = pos;
  for (const [px, py] of path) {
    while (Math.hypot(px - x, py - y) > 0.05) {
      const d = Math.hypot(px - x, py - y);
      const step = Math.min(0.2, d);
      x += ((px - x) / d) * step;
      y += ((py - y) / d) * step;
      const facing = Math.abs(px - x) > Math.abs(py - y) ? (px > x ? "right" : "left") : py > y ? "down" : "up";
      send({ t: "move", x, y, facing, moving: true });
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  pos = { x, y };
  send({ t: "move", x, y, facing: "left", moving: false });
}

await walk([
  [16.5, 21.5],
  [16.5, 18.5],
  [9.5, 18.5],
  [9.5, 14.5],
  [9.5, 11.5],
  [8.5, 11.5],
]);
log("at the thicket");
send({ t: "chat", channel: "town", text: "off you go, Mossit" });

const until = Date.now() + seconds * 1000;
while (Date.now() < until) {
  const idle = self?.critters.find((c) => c.state === "follow");
  if (idle) send({ t: "job:start", spotId: "thicket_1", critterId: idle.id });
  await new Promise((r) => setTimeout(r, 2000));
}
ws.close();
log("done");
process.exit(0);
