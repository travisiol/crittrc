/**
 * How much of the meadow one server can hand out.
 *
 * Opens a crowd of spectator sockets against a running world server, holds
 * them, and reports what came back: how many connections stood up, how many
 * snapshots each one saw a second, how big those snapshots were, and how far
 * the server's own snapshot clock drifted from the wall clock while it did it.
 *
 * This is a harness, not a test. It asserts one thing — that the crowd stayed
 * connected — and prints the rest for a person to read.
 *
 * Start the server first, then run this against it:
 *
 *   cd server && npm run dev                   (in another terminal)
 *   node scripts/load.mjs
 *   node scripts/load.mjs ws://localhost:8787/ws
 *
 *   CLIENTS=500 SECONDS=60 node scripts/load.mjs
 *
 * Environment:
 *   CLIENTS   how many sockets to open           (default 200)
 *   SECONDS   how long to hold them              (default 30)
 *   SERVER    base URL of the world server       (default http://localhost:8787)
 *   ROOM      which room to watch                (default meadow-1)
 *   RAMP      sockets opened per second          (default 100)
 *
 * These are spectators: they send one `hello` with no session and then never
 * say anything again. No keeper is created, no gold moves, nothing is written
 * to the database — the only thing on the server's side is a client in a room
 * being sent the snapshot it already builds for everyone else.
 *
 * A note on the greeting: the server rate-limits socket actions per IP (25 in
 * a burst, then four a second), and `hello` is one of them. Every client here
 * arrives from the same address, so most of the greetings are refused on the
 * first try. That is the server behaving correctly, not a fault, so the
 * harness simply re-sends its hello until it is let in and reports how long
 * the whole crowd took to get through the door.
 *
 * Exits non-zero when fewer than 95% of the clients were still connected at
 * the end.
 */
import WebSocket from "ws";

const base = process.argv[2] ?? process.env.SERVER ?? "http://localhost:8787";
const url = base.startsWith("ws") ? base : base.replace(/^http/, "ws").replace(/\/$/, "") + "/ws";
const CLIENTS = Number(process.env.CLIENTS ?? 200);
const SECONDS = Number(process.env.SECONDS ?? 30);
const ROOM = process.env.ROOM ?? "meadow-1";
const RAMP = Number(process.env.RAMP ?? 100);

/** How often the world server ticks, from world.ts. Used only for context. */
const EXPECTED_HZ = 10;
const HELLO_RETRY_MS = 1_200;
const KEEP = 0.95;

if (!(CLIENTS > 0) || !(SECONDS > 0)) {
  console.error("CLIENTS and SECONDS must both be positive.");
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const clients = [];
/** Every snapshot's size in bytes, and every snapshot's delivery lag in ms. */
const sizes = [];
const lags = [];

let connectErrors = 0;
const errorKinds = new Map();

function noteError(err) {
  connectErrors++;
  const key = err?.code ?? err?.message ?? "unknown";
  errorKinds.set(key, (errorKinds.get(key) ?? 0) + 1);
}

function open(i) {
  const c = {
    i,
    ws: null,
    connected: false,
    greeted: false,
    closed: false,
    helloAttempts: 0,
    greetedAt: 0,
    snapshots: 0,
    others: 0,
    firstAt: 0,
    lastAt: 0,
    firstWall: 0,
    lastWall: 0,
    bytes: 0,
  };
  clients.push(c);

  const ws = new WebSocket(url, { perMessageDeflate: false });
  c.ws = ws;

  const hello = () => {
    if (c.greeted || c.closed || ws.readyState !== WebSocket.OPEN) return;
    c.helloAttempts++;
    ws.send(JSON.stringify({ t: "hello", room: ROOM }));
    c.retry = setTimeout(hello, HELLO_RETRY_MS);
  };

  ws.on("open", () => {
    c.connected = true;
    hello();
  });

  ws.on("message", (data) => {
    const wall = Date.now();
    c.bytes += data.length;
    let msg;
    try {
      msg = JSON.parse(data.toString("utf8"));
    } catch {
      return;
    }
    if (msg.t === "welcome") {
      c.greeted = true;
      c.greetedAt = wall;
      clearTimeout(c.retry);
      return;
    }
    if (msg.t !== "snapshot") {
      c.others++;
      return;
    }
    c.snapshots++;
    sizes.push(data.length);
    lags.push(wall - msg.at);
    if (!c.firstAt) {
      c.firstAt = msg.at;
      c.firstWall = wall;
    }
    c.lastAt = msg.at;
    c.lastWall = wall;
  });

  ws.on("close", () => {
    c.closed = true;
    clearTimeout(c.retry);
  });
  ws.on("error", (err) => {
    c.closed = true;
    clearTimeout(c.retry);
    noteError(err);
  });
}

// ── Numbers ─────────────────────────────────────────────────────────

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}
const mean = (values) => (values.length === 0 ? 0 : values.reduce((s, v) => s + v, 0) / values.length);
/** Math.max(...values) blows the stack once a long run has enough samples. */
const max = (values) => values.reduce((m, v) => (v > m ? v : m), 0);

function bytes(n) {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(2)} KB`;
  return `${Math.round(n)} B`;
}

const LABEL = 26;
const row = (label, value, note = "") =>
  console.log(`  ${label.padEnd(LABEL)}${String(value).padStart(12)}${note ? "  " + note : ""}`);
const rule = () => console.log("  " + "-".repeat(LABEL + 12));

// ── Run ─────────────────────────────────────────────────────────────

console.log(`\nCRITTR load — ${url}  room=${ROOM}`);
console.log(`opening ${CLIENTS} spectator sockets at ${RAMP}/s, holding ${SECONDS}s\n`);

const startedAt = Date.now();
const perBatch = Math.max(1, Math.round(RAMP / 10));
for (let i = 0; i < CLIENTS; i += perBatch) {
  for (let j = i; j < Math.min(CLIENTS, i + perBatch); j++) open(j);
  if (i + perBatch < CLIENTS) await sleep(100);
}
const rampMs = Date.now() - startedAt;

// Let the last sockets finish their handshake before the clock starts.
await sleep(500);
const connected = clients.filter((c) => c.connected).length;
if (connected === 0) {
  console.error(`No socket reached ${url}. Is the server running?`);
  for (const [kind, n] of errorKinds) console.error(`  ${kind}: ${n}`);
  process.exit(1);
}

const holdFrom = Date.now();
await sleep(SECONDS * 1_000);
const heldMs = Date.now() - holdFrom;

const stillOpen = clients.filter((c) => c.ws.readyState === WebSocket.OPEN).length;
const greeted = clients.filter((c) => c.greeted);
const watched = clients.filter((c) => c.snapshots > 1);

// Snapshots a second, per client, over the span that client was actually watching.
const rates = watched.map((c) => (c.snapshots - 1) / Math.max(1, (c.lastWall - c.firstWall) / 1_000));
// How far the server's own timestamps ran ahead of or behind this machine's
// clock over the run: if the two agree, a span of server time and the same
// span of wall time are the same length.
const drifts = watched.map((c) => c.lastAt - c.firstAt - (c.lastWall - c.firstWall));
const greetMs = greeted.map((c) => c.greetedAt - startedAt);
const totalSnapshots = clients.reduce((s, c) => s + c.snapshots, 0);
const totalBytes = clients.reduce((s, c) => s + c.bytes, 0);

for (const c of clients) {
  clearTimeout(c.retry);
  if (c.ws.readyState === WebSocket.OPEN || c.ws.readyState === WebSocket.CONNECTING) c.ws.close();
}

console.log("CONNECTIONS");
row("requested", CLIENTS);
row("established", connected, `${((connected / CLIENTS) * 100).toFixed(1)}%  in ${(rampMs / 1000).toFixed(1)}s`);
row("greeted (welcome)", greeted.length, `${((greeted.length / CLIENTS) * 100).toFixed(1)}%`);
row("still connected", stillOpen, `${((stillOpen / CLIENTS) * 100).toFixed(1)}%`);
row("connect errors", connectErrors);
if (greeted.length > 0) {
  row("hello attempts (mean)", mean(greeted.map((c) => c.helloAttempts)).toFixed(1), "per-IP action limiter");
  row("time to welcome p95", `${(percentile(greetMs, 95) / 1000).toFixed(1)}s`);
}
if (greeted.length < connected) {
  row("still at the door", connected - greeted.length, "throttled, not dropped");
}

console.log("\nSNAPSHOTS");
row("clients receiving", watched.length);
row("total received", totalSnapshots.toLocaleString("en-US"));
row("per second per client", mean(rates).toFixed(2), `server ticks at ${EXPECTED_HZ} Hz`);
row("slowest client", percentile(rates, 5).toFixed(2), "5th percentile");
row("fastest client", percentile(rates, 95).toFixed(2), "95th percentile");

console.log("\nMESSAGE SIZE");
row("mean", bytes(mean(sizes)));
row("p95", bytes(percentile(sizes, 95)));
row("largest", bytes(max(sizes)));
row("total received", bytes(totalBytes));
row("per client per second", bytes(totalBytes / Math.max(1, watched.length) / (heldMs / 1_000)));

console.log("\nCLOCK");
row("delivery lag mean", `${mean(lags).toFixed(0)} ms`, "snapshot.at to arrival");
row("delivery lag p95", `${percentile(lags, 95).toFixed(0)} ms`);
row("snapshot clock drift", `${mean(drifts).toFixed(0)} ms`, `over ${(heldMs / 1000).toFixed(1)}s held`);
row("worst client drift", `${max(drifts.map((d) => Math.abs(d))).toFixed(0)} ms`);

rule();
const kept = stillOpen / CLIENTS;
const ok = kept >= KEEP;
console.log(`  ${ok ? "PASS" : "FAIL"}  ${(kept * 100).toFixed(1)}% of ${CLIENTS} clients stayed connected (needs ${KEEP * 100}%)\n`);

if (greeted.length < connected) {
  console.log(
    `  ${connected - greeted.length} sockets were still waiting for a welcome when the run ended. That is the\n` +
      `  per-IP limiter doing its job, not the server falling over — every client here shares one\n` +
      `  address. Hold for longer (SECONDS), or drive from more than one host, to seat them all.\n`,
  );
}

if (errorKinds.size > 0) {
  console.log("  errors:");
  for (const [kind, n] of errorKinds) console.log(`    ${kind}: ${n}`);
  console.log("");
}

process.exit(ok ? 0 : 1);
