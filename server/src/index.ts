import { createServer } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { assertConfig, config } from "./config";
import { resolveSession } from "./auth";
import { prune } from "./db";
import { clientIp, handleHttp } from "./http";
import { limits, pruneLimits } from "./limits";
import { startBackups, stopBackups } from "./backup";
import { World, type Client } from "./world";

/**
 * Boot: one HTTP server for the JSON routes, one WebSocket server on the
 * same port for the world. `ws://host/ws` is the only socket path.
 */

assertConfig();

const world = new World();
world.start();

const server = createServer((req, res) => {
  void handleHttp(req, res, world);
});

const wss = new WebSocketServer({ server, path: "/ws", maxPayload: 4096 });

wss.on("connection", (ws: WebSocket, req) => {
  const origin = req.headers.origin;
  if (config.origin !== "*" && origin && origin !== config.origin) {
    ws.close(1008, "origin");
    return;
  }
  const client: Client = world.connect(ws, clientIp(req));
  let greeted = false;

  ws.on("message", (data) => {
    let msg: unknown;
    try {
      msg = JSON.parse(String(data));
    } catch {
      return;
    }
    if (!msg || typeof msg !== "object") return;
    const m = msg as { t?: string; session?: string; room?: string };
    // Movement is already bounded by the speed check in the world; this
    // stops everything else being spammed down the same socket.
    if (m.t !== "move" && m.t !== "ping" && !limits.action.take(client.ip)) return;
    if (!greeted) {
      if (m.t !== "hello") return;
      greeted = true;
      const address = resolveSession(m.session);
      if (m.session && !address) {
        ws.send(JSON.stringify({ t: "error", text: "Your sign-in has expired. Connect your wallet again." }));
        ws.close();
        return;
      }
      world.hello(client, address, String(m.room ?? ""));
      return;
    }
    world.handle(client, msg);
  });

  ws.on("pong", () => {
    client.alive = true;
  });

  ws.on("close", () => world.disconnect(client));
  ws.on("error", () => world.disconnect(client));
});

// Drop sockets that stopped answering pings.
setInterval(() => {
  for (const c of world.clients) {
    if (!c.alive) {
      c.ws.terminate();
      world.disconnect(c);
      continue;
    }
    c.alive = false;
    c.ws.ping();
  }
}, 30_000);

setInterval(() => {
  prune();
  pruneLimits();
}, 10 * 60_000);

startBackups();

server.listen(config.port, () => {
  console.log(
    `[crittr] world server on :${config.port} — gate=${config.gate} rooms=${config.roomCount} jobScale=${config.jobScale} db=${config.dbPath}`,
  );
});

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    // Tell everyone why the world went quiet, rather than dropping them.
    for (const c of world.clients) {
      if (c.ws.readyState === c.ws.OPEN) {
        c.ws.send(JSON.stringify({ t: "toast", text: "The meadow is restarting. Back in a moment.", kind: "warn" }));
      }
    }
    stopBackups();
    world.stop();
    wss.close();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1000).unref();
  });
}
