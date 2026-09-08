import type { WebSocket } from "ws";
import { randomUUID } from "node:crypto";
import { config } from "./config";
import {
  addToBag,
  bagCount,
  getBag,
  getKeeper,
  insertCritter,
  ledger,
  listCritters,
  nameTaken,
  setFed,
  setGold,
  setNestCollected,
  setSold,
  transaction,
  type KeeperRow,
} from "./db";
import {
  canStand,
  dist2,
  getMap,
  type Facing,
  type GameMap,
  type MapId,
  type Spot,
} from "../../web/src/shared/maps";
import {
  botCritterView,
  botPlayerView,
  describeBots,
  makeBotNames,
  makeBots,
  stepBot,
  type Bot,
  type BotContext,
} from "./bots";
import {
  BAG_CAPACITY,
  ITEMS,
  JOB_LABEL,
  JOB_SECONDS,
  SHOP,
  TRADER_DAILY_CAP,
  formatGold,
  lootTable,
  rollLoot,
} from "../../web/src/shared/items";
import {
  MAX_CRITTERS,
  PARTY_SIZE,
  SPECIES,
  TRUST_FULL,
  TRUST_PER_TREAT,
  speciesById,
  type JobKind,
} from "../../web/src/shared/species";
import {
  CHAT_MAX,
  WALK_SPEED,
  type ClientMsg,
  type CritterState,
  type CritterView,
  type OwnedCritter,
  type PlayerView,
  type RoomInfo,
  type SelfState,
  type ServerMsg,
  type WildView,
} from "../../web/src/shared/protocol";

/**
 * The world: rooms, the people in them, their critters, and the rules that
 * turn time into items and items into gold. The client only ever asks; the
 * answer is decided here.
 */

interface Job {
  spotId: string;
  kind: JobKind;
  startedAt: number;
  endsAt: number;
  fed: boolean;
  affinity: boolean;
}

interface LiveCritter {
  id: string;
  species: number;
  name: string;
  tokenId: number | null;
  fed: boolean;
  state: CritterState;
  x: number;
  y: number;
  facing: Facing;
  moving: boolean;
  job?: Job;
}

export interface Client {
  ws: WebSocket;
  ip: string;
  address: string | null;
  keeper: KeeperRow | null;
  room: Room | null;
  map: MapId;
  x: number;
  y: number;
  facing: Facing;
  moving: boolean;
  lastMoveAt: number;
  trail: Array<{ x: number; y: number }>;
  critters: LiveCritter[];
  lastChatAt: number;
  alive: boolean;
}

interface Wild {
  id: string;
  species: number;
  x: number;
  y: number;
  facing: Facing;
  moving: boolean;
  tx: number;
  ty: number;
  nextThinkAt: number;
  /** Fills with treats. At TRUST_FULL it goes home with whoever filled it. */
  trust: number;
}

class Room {
  clients = new Set<Client>();
  wild: Wild[] = [];
  bots: Bot[] = [];
  constructor(
    public id: string,
    public name: string,
    public cap: number,
  ) {}
  /** People signed in here. */
  humans(): number {
    let n = 0;
    for (const c of this.clients) if (c.keeper) n++;
    return n;
  }
  /** Everyone standing in the meadow, the game's own keepers included. */
  players(): number {
    return this.humans() + this.bots.length;
  }
  info(): RoomInfo {
    return { id: this.id, name: this.name, count: this.players(), cap: this.cap };
  }
}

const TICK_MS = 100;
const TRAIL_STEP = 5;

function send(c: Client, msg: ServerMsg) {
  if (c.ws.readyState === c.ws.OPEN) c.ws.send(JSON.stringify(msg));
}

function facingFrom(dx: number, dy: number, fallback: Facing): Facing {
  if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) return fallback;
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? "right" : "left";
  return dy > 0 ? "down" : "up";
}

function utcDay(): string {
  return new Date().toISOString().slice(0, 10);
}

const NEST_INTERVAL_MS = 20 * 60 * 60 * 1000;

export class World {
  rooms: Room[] = [];
  clients = new Set<Client>();
  private timer: NodeJS.Timeout | null = null;
  private lastOnlineAt = 0;

  /** Names the game's own keepers hold, so nobody can register one. */
  readonly botNames = new Set<string>();
  /** Wild critter ids never repeat, so a caught one cannot be courted twice. */
  private wildSeq = 0;

  constructor() {
    for (let i = 1; i <= config.roomCount; i++) {
      const room = new Room(`meadow-${i}`, `Meadow ${i}`, config.roomCap);
      this.spawnWild(room);
      this.rooms.push(room);
    }
    this.spawnBots();
  }

  /**
   * Spread the game's keepers across the rooms the way a real crowd sits:
   * most of them in the first one, thinning out after that, so the room
   * list has somewhere obviously busy to point at.
   */
  private spawnBots() {
    const total = Math.max(0, Math.min(500, config.botCount));
    if (total === 0) return;
    const weights = this.rooms.map((_, i) => 1 / (i + 1.6));
    const sum = weights.reduce((a, b) => a + b, 0);
    const names = makeBotNames(total, 91_337, (n) => nameTaken(n));
    for (const n of names) this.botNames.add(n.toLowerCase());

    let cursor = 0;
    this.rooms.forEach((room, i) => {
      const share = i === this.rooms.length - 1 ? names.length - cursor : Math.round((weights[i] / sum) * total);
      const slice = names.slice(cursor, cursor + Math.max(0, share));
      cursor += slice.length;
      room.bots = makeBots(room.id, slice, 4242 + i * 17);
    });
    console.log(`[crittr] ${describeBots(this.rooms.flatMap((r) => r.bots))} across ${this.rooms.length} rooms`);
  }

  start() {
    if (!this.timer) this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  roomsInfo(): RoomInfo[] {
    return this.rooms.map((r) => r.info());
  }

  jobSeconds(): Record<JobKind, number> {
    return {
      forage: Math.max(3, Math.round(JOB_SECONDS.forage * config.jobScale)),
      fish: Math.max(3, Math.round(JOB_SECONDS.fish * config.jobScale)),
      dig: Math.max(3, Math.round(JOB_SECONDS.dig * config.jobScale)),
    };
  }

  // ── Connections ───────────────────────────────────────────────────

  connect(ws: WebSocket, ip: string): Client {
    const meadow = getMap("meadow");
    const c: Client = {
      ws,
      ip,
      address: null,
      keeper: null,
      room: null,
      map: "meadow",
      x: meadow.spawn.x + 0.5,
      y: meadow.spawn.y + 0.5,
      facing: "down",
      moving: false,
      lastMoveAt: Date.now(),
      trail: [],
      critters: [],
      lastChatAt: 0,
      alive: true,
    };
    this.clients.add(c);
    return c;
  }

  disconnect(c: Client) {
    for (const cr of c.critters) if (cr.job) this.cancelJob(c, cr, false);
    if (c.room) c.room.clients.delete(c);
    this.clients.delete(c);
  }

  /** Attach a signed-in keeper to the connection and put it in a room. */
  hello(c: Client, address: string | null, roomId: string) {
    const room = this.rooms.find((r) => r.id === roomId) ?? this.rooms[0];
    if (address) {
      const keeper = getKeeper(address);
      if (!keeper) {
        send(c, { t: "error", text: "No keeper for this wallet yet. Go through the fitting room first." });
        return;
      }
      // Bots give way: only real keepers count against the cap.
      if (room.humans() >= room.cap) {
        send(c, { t: "error", text: "world full" });
        return;
      }
      // One connection per keeper: the newer one wins.
      for (const other of this.clients) {
        if (other !== c && other.keeper?.id === keeper.id) {
          send(other, { t: "error", text: "You signed in from somewhere else." });
          other.ws.close();
          this.disconnect(other);
        }
      }
      c.address = address;
      c.keeper = keeper;
      c.critters = listCritters(keeper.id).map((row, i) => ({
        id: row.id,
        species: row.species,
        name: row.name,
        tokenId: row.token_id,
        fed: row.fed === 1,
        state: i < PARTY_SIZE ? "follow" : "rest",
        x: c.x,
        y: c.y,
        facing: "down" as Facing,
        moving: false,
      }));
    }
    c.room = room;
    room.clients.add(c);
    send(c, {
      t: "welcome",
      room: room.info(),
      map: c.map,
      self: c.keeper ? this.selfState(c) : null,
      serverTime: Date.now(),
      jobSeconds: this.jobSeconds(),
    });
    this.broadcastOnline();
  }

  // ── Messages ──────────────────────────────────────────────────────

  handle(c: Client, raw: unknown) {
    if (!raw || typeof raw !== "object" || typeof (raw as { t?: unknown }).t !== "string") return;
    const msg = raw as ClientMsg;
    switch (msg.t) {
      case "move":
        return this.onMove(c, msg);
      case "job:start":
        return this.onJobStart(c, String(msg.spotId ?? ""), String(msg.critterId ?? ""));
      case "job:cancel":
        return this.onJobCancel(c, String(msg.critterId ?? ""));
      case "trade:sell":
        return this.onSell(c, msg.items);
      case "trade:buy":
        return this.onBuy(c, String(msg.item ?? ""), Number(msg.qty ?? 0));
      case "feed":
        return this.onFeed(c, String(msg.critterId ?? ""));
      case "tame":
        return this.onTame(c, String(msg.wildId ?? ""));
      case "gate":
        return this.onGate(c, msg.to);
      case "board:collect":
        return this.onCollect(c);
      case "chat":
        return this.onChat(c, msg.channel, String(msg.text ?? ""));
      case "ping":
        return send(c, { t: "pong", at: Number(msg.at) || 0, serverTime: Date.now() });
    }
  }

  private map(c: Client): GameMap {
    return getMap(c.map);
  }

  private onMove(c: Client, m: { x: number; y: number; facing: Facing; moving: boolean }) {
    if (!c.keeper) return;
    const x = Number(m.x);
    const y = Number(m.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const facing: Facing = ["up", "down", "left", "right"].includes(m.facing) ? m.facing : c.facing;
    const now = Date.now();
    const dt = Math.min(1, (now - c.lastMoveAt) / 1000);
    c.lastMoveAt = now;
    const maxDist = WALK_SPEED * dt * 1.6 + 0.35;
    const map = this.map(c);
    if (dist2(x, y, c.x, c.y) > maxDist * maxDist || !canStand(map, x, y)) {
      send(c, { t: "map", map: c.map, x: c.x, y: c.y });
      return;
    }
    c.x = x;
    c.y = y;
    c.facing = facing;
    c.moving = !!m.moving;
    const last = c.trail[0];
    if (!last || dist2(last.x, last.y, x, y) > 0.05) {
      c.trail.unshift({ x, y });
      if (c.trail.length > 40) c.trail.length = 40;
    }
  }

  private findSpot(c: Client, spotId: string): Spot | null {
    return this.map(c).spots.find((s) => s.id === spotId) ?? null;
  }

  private spotLoad(room: Room, map: MapId, spotId: string): number {
    let n = 0;
    for (const other of room.clients) {
      if (other.map !== map) continue;
      for (const cr of other.critters) if (cr.job?.spotId === spotId) n++;
    }
    if (map === "meadow") {
      for (const bot of room.bots) for (const cr of bot.critters) if (cr.job?.spotId === spotId) n++;
    }
    return n;
  }

  private botsAtSpot(room: Room, spotId: string): number {
    let n = 0;
    for (const bot of room.bots) for (const cr of bot.critters) if (cr.job?.spotId === spotId) n++;
    return n;
  }

  private onJobStart(c: Client, spotId: string, critterId: string) {
    if (!c.keeper || !c.room) return;
    const cr = c.critters.find((x) => x.id === critterId);
    if (!cr) return send(c, { t: "toast", text: "That critter is not with you.", kind: "warn" });
    if (cr.state === "work") return send(c, { t: "toast", text: `${cr.name} is already working.`, kind: "warn" });
    if (cr.state === "rest") return send(c, { t: "toast", text: `${cr.name} is resting in the den.`, kind: "warn" });
    const spot = this.findSpot(c, spotId);
    if (!spot) return;
    if (dist2(c.x, c.y, spot.x + 0.5, spot.y + 0.5) > 2.6 * 2.6) {
      return send(c, { t: "toast", text: "Too far away. Walk up to it.", kind: "warn" });
    }
    if (this.spotLoad(c.room, c.map, spot.id) >= spot.capacity) {
      return send(c, { t: "toast", text: "No room at this spot. Try the next one along.", kind: "warn" });
    }
    if (bagCount(c.keeper.id) >= BAG_CAPACITY) {
      return send(c, { t: "toast", text: "Your bag is full. Sell to the trader before sending anyone out.", kind: "warn" });
    }
    const species = speciesById(cr.species);
    const affinity = species.affinity === spot.job;
    const fed = cr.fed;
    if (fed) {
      cr.fed = false;
      setFed(cr.id, false);
    }
    const seconds = this.jobSeconds()[spot.job];
    const now = Date.now();
    cr.job = { spotId: spot.id, kind: spot.job, startedAt: now, endsAt: now + seconds * 1000, fed, affinity };
    cr.state = "work";
    cr.x = spot.standX + 0.5;
    cr.y = spot.standY + 0.5;
    cr.facing = facingFrom(spot.x - spot.standX, spot.y - spot.standY, "down");
    cr.moving = false;
    const mins = Math.max(1, Math.round(seconds / 60));
    send(c, {
      t: "toast",
      text: `${cr.name} is ${JOB_LABEL[spot.job].noun.toLowerCase()} at ${JOB_LABEL[spot.job].place}. About ${
        seconds < 60 ? `${seconds} seconds` : `${mins} minute${mins > 1 ? "s" : ""}`
      }.${affinity ? " It likes it here." : ""}`,
      kind: "info",
    });
    send(c, { t: "self", self: this.selfState(c) });
  }

  private onJobCancel(c: Client, critterId: string) {
    const cr = c.critters.find((x) => x.id === critterId);
    if (!cr || !cr.job) return;
    this.cancelJob(c, cr, true);
    send(c, { t: "self", self: this.selfState(c) });
  }

  private cancelJob(c: Client, cr: LiveCritter, tell: boolean) {
    cr.job = undefined;
    cr.state = "follow";
    cr.x = c.x;
    cr.y = c.y;
    if (tell) send(c, { t: "toast", text: `${cr.name} came back with nothing.`, kind: "warn" });
  }

  private completeJob(c: Client, cr: LiveCritter) {
    if (!c.keeper || !cr.job) return;
    const job = cr.job;
    const table = lootTable(job.kind, { affinity: job.affinity, fed: job.fed });
    const item = rollLoot(table, Math.random);
    cr.job = undefined;
    cr.state = "follow";
    cr.x = c.x;
    cr.y = c.y;
    const keeper = c.keeper;
    const full = bagCount(keeper.id) >= BAG_CAPACITY;
    if (!full) {
      transaction(() => {
        addToBag(keeper.id, item, 1);
        ledger(keeper.id, "job", item, 1, 0);
      });
      send(c, { t: "job:done", critterId: cr.id, critterName: cr.name, item, kind: job.kind });
    } else {
      send(c, {
        t: "toast",
        text: `Your bag was full. ${cr.name} dropped the ${ITEMS[item]?.name.toLowerCase() ?? item}.`,
        kind: "warn",
      });
    }
    send(c, { t: "self", self: this.selfState(c) });
  }

  private nearNpc(c: Client, key: string, radius = 2.4): boolean {
    const npc = this.map(c).npcs.find((n) => n.key === key);
    if (!npc) return false;
    return dist2(c.x, c.y, npc.x + 0.5, npc.y + 0.5) <= radius * radius;
  }

  private resetDay(k: KeeperRow) {
    const day = utcDay();
    if (k.sold_day !== day) {
      k.sold_day = day;
      k.sold_today = 0;
      setSold(k.id, day, 0);
    }
  }

  private onSell(c: Client, items: string[] | "all") {
    if (!c.keeper) return;
    if (!this.nearNpc(c, "trader")) return send(c, { t: "toast", text: "Walk up to the trader first.", kind: "warn" });
    const k = c.keeper;
    this.resetDay(k);
    const bag = getBag(k.id);
    const wanted = items === "all" ? bag.map((b) => b.item) : Array.isArray(items) ? items.map(String) : [];
    let paid = 0;
    let sold = 0;
    let cleared = 0;
    let capped = false;
    transaction(() => {
      for (const key of wanted) {
        const entry = bag.find((b) => b.item === key);
        const def = ITEMS[key];
        if (!entry || !def || def.from === "shop") continue;
        if (def.price === 0) {
          addToBag(k.id, key, -entry.qty);
          ledger(k.id, "junk", key, entry.qty, 0);
          cleared += entry.qty;
          continue;
        }
        const room = Math.max(0, TRADER_DAILY_CAP - k.sold_today - paid);
        const allowed = Math.min(entry.qty, Math.floor(room / def.price));
        if (allowed < entry.qty) capped = true;
        if (allowed <= 0) continue;
        addToBag(k.id, key, -allowed);
        paid += allowed * def.price;
        sold += allowed;
        ledger(k.id, "sell", key, allowed, allowed * def.price);
      }
      if (paid > 0) {
        k.gold += paid;
        k.sold_today += paid;
        setGold(k.id, k.gold);
        setSold(k.id, k.sold_day, k.sold_today);
      }
    });
    if (sold > 0) {
      send(c, {
        t: "toast",
        text: `Sold ${sold} for ${formatGold(paid)} gold.${cleared ? ` Took ${cleared} junk off your hands.` : ""}`,
        kind: "good",
      });
    } else if (cleared > 0) {
      send(c, { t: "toast", text: `Took ${cleared} junk off your hands. Pays nothing, clears the bag.`, kind: "info" });
    } else if (!capped) {
      send(c, { t: "toast", text: "Nothing here I buy.", kind: "info" });
    }
    if (capped) {
      send(c, {
        t: "toast",
        text: "You've sold me all I can take today. Come back tomorrow. Keep what is left.",
        kind: "warn",
      });
    }
    send(c, { t: "self", self: this.selfState(c) });
  }

  private onBuy(c: Client, item: string, qty: number) {
    if (!c.keeper) return;
    if (!this.nearNpc(c, "trader")) return send(c, { t: "toast", text: "Walk up to the trader first.", kind: "warn" });
    const price = SHOP[item];
    if (!price || !Number.isInteger(qty) || qty <= 0 || qty > 24) return;
    const k = c.keeper;
    const cost = price * qty;
    if (k.gold < cost) return send(c, { t: "toast", text: "Not enough gold.", kind: "warn" });
    if (bagCount(k.id) + qty > BAG_CAPACITY) return send(c, { t: "toast", text: "No room in your bag.", kind: "warn" });
    transaction(() => {
      k.gold -= cost;
      setGold(k.id, k.gold);
      addToBag(k.id, item, qty);
      ledger(k.id, "buy", item, qty, -cost);
    });
    send(c, { t: "toast", text: `Bought ${qty} ${ITEMS[item].name.toLowerCase()}${qty > 1 ? "s" : ""} for ${formatGold(cost)} gold.`, kind: "good" });
    send(c, { t: "self", self: this.selfState(c) });
  }

  private onFeed(c: Client, critterId: string) {
    if (!c.keeper) return;
    const cr = c.critters.find((x) => x.id === critterId);
    if (!cr) return;
    if (cr.state === "work") return send(c, { t: "toast", text: `${cr.name} is busy. Feed it when it is back.`, kind: "warn" });
    if (cr.fed) return send(c, { t: "toast", text: `${cr.name} is already full.`, kind: "info" });
    const k = c.keeper;
    const treats = getBag(k.id).find((b) => b.item === "treat")?.qty ?? 0;
    if (treats <= 0) return send(c, { t: "toast", text: "No treats in your bag. The trader sells them.", kind: "warn" });
    transaction(() => {
      addToBag(k.id, "treat", -1);
      setFed(cr.id, true);
      ledger(k.id, "feed", "treat", 1, 0);
    });
    cr.fed = true;
    send(c, { t: "toast", text: `${cr.name} ate the treat. Its next job brings back less junk.`, kind: "good" });
    send(c, { t: "self", self: this.selfState(c) });
  }

  /**
   * Offer a treat to a wild critter. Trust is on the critter, not on the
   * keeper, so two people courting the same one are racing: it goes home
   * with whoever hands over the treat that fills it.
   */
  private onTame(c: Client, wildId: string) {
    if (!c.keeper || !c.room) return;
    if (c.map !== "meadow") return;
    const wild = c.room.wild.find((w) => w.id === wildId);
    if (!wild) return send(c, { t: "toast", text: "It wandered off.", kind: "warn" });
    if (dist2(c.x, c.y, wild.x, wild.y) > 2.0 * 2.0) {
      return send(c, { t: "toast", text: "Too far away. Get closer, slowly.", kind: "warn" });
    }
    const k = c.keeper;
    if (c.critters.length >= MAX_CRITTERS) {
      return send(c, {
        t: "toast",
        text: `You already keep ${MAX_CRITTERS} critters. That is as many as one den holds.`,
        kind: "warn",
      });
    }
    const treats = getBag(k.id).find((b) => b.item === "treat")?.qty ?? 0;
    if (treats <= 0) {
      return send(c, { t: "toast", text: "You need a treat in hand. The trader sells them.", kind: "warn" });
    }

    const species = speciesById(wild.species);
    const gain = TRUST_PER_TREAT.min + Math.floor(Math.random() * (TRUST_PER_TREAT.max - TRUST_PER_TREAT.min + 1));
    transaction(() => {
      addToBag(k.id, "treat", -1);
      ledger(k.id, "tame", "treat", 1, 0);
    });
    wild.trust = Math.min(TRUST_FULL, wild.trust + gain);

    if (wild.trust < TRUST_FULL) {
      send(c, {
        t: "toast",
        text: `The ${species.name.toLowerCase()} took the treat. ${Math.round((wild.trust / TRUST_FULL) * 100)}% of the way.`,
        kind: "info",
      });
      send(c, { t: "self", self: this.selfState(c) });
      return;
    }

    // It joins. Take it out of the world and give the meadow a new one.
    c.room.wild = c.room.wild.filter((w) => w.id !== wild.id);
    const id = newCritterId();
    insertCritter({ id, keeper: k.id, species: species.id, name: species.name, token_id: null });
    ledger(k.id, "tamed", species.key, 1, 0);
    c.critters.push({
      id,
      species: species.id,
      name: species.name,
      tokenId: null,
      fed: false,
      state: c.critters.filter((x) => x.state !== "rest").length < PARTY_SIZE ? "follow" : "rest",
      x: c.x,
      y: c.y,
      facing: "down",
      moving: false,
    });
    send(c, { t: "toast", text: `The ${species.name.toLowerCase()} is coming with you.`, kind: "good" });
    send(c, { t: "self", self: this.selfState(c) });
    setTimeout(() => this.addWild(c.room!), 20_000);
  }

  private onGate(c: Client, to: MapId) {
    if (!c.keeper) return;
    if (to !== "meadow" && to !== "den") return;
    const gate = this.map(c).interactables.find(
      (i) => i.kind === "gate" && i.to === to && dist2(c.x, c.y, i.x + 0.5, i.y + 0.5) <= 2.2 * 2.2,
    );
    if (!gate) return;
    for (const cr of c.critters) if (cr.job) this.cancelJob(c, cr, true);
    const target = getMap(to);
    c.map = to;
    c.x = target.spawn.x + 0.5;
    c.y = target.spawn.y + 0.5;
    c.facing = to === "den" ? "up" : "down";
    c.trail = [];
    for (const cr of c.critters) {
      cr.x = c.x;
      cr.y = c.y;
    }
    send(c, { t: "map", map: to, x: c.x, y: c.y });
    send(c, { t: "self", self: this.selfState(c) });
  }

  private nestState(c: Client): { ready: Array<{ item: string; qty: number }>; readyAt: number } {
    const k = c.keeper!;
    const readyAt = k.nest_collected_at + NEST_INTERVAL_MS;
    if (Date.now() < readyAt) return { ready: [], readyAt };
    const ready = new Map<string, number>();
    for (const cr of c.critters) {
      const item = speciesById(cr.species).keepsake;
      ready.set(item, (ready.get(item) ?? 0) + 1);
    }
    return { ready: [...ready].map(([item, qty]) => ({ item, qty })), readyAt };
  }

  private onCollect(c: Client) {
    if (!c.keeper) return;
    if (c.map !== "den") return;
    const board = this.map(c).interactables.find((i) => i.kind === "board");
    if (!board || dist2(c.x, c.y, board.x + 0.5, board.y + 0.5) > 2.4 * 2.4) return;
    const { ready } = this.nestState(c);
    const k = c.keeper;
    if (ready.length === 0) {
      return send(c, { t: "toast", text: "Nothing on the shelves yet. Come back tomorrow.", kind: "info" });
    }
    let space = BAG_CAPACITY - bagCount(k.id);
    let taken = 0;
    transaction(() => {
      for (const r of ready) {
        const n = Math.min(r.qty, space);
        if (n <= 0) continue;
        addToBag(k.id, r.item, n);
        ledger(k.id, "nest", r.item, n, 0);
        space -= n;
        taken += n;
      }
      k.nest_collected_at = Date.now();
      setNestCollected(k.id, k.nest_collected_at);
    });
    send(c, {
      t: "toast",
      text: taken > 0 ? `Collected ${taken} keepsake${taken > 1 ? "s" : ""} from the nests.` : "Your bag is full. The shelves were emptied anyway.",
      kind: taken > 0 ? "good" : "warn",
    });
    send(c, { t: "self", self: this.selfState(c) });
  }

  private onChat(c: Client, channel: "town" | "world", textRaw: string) {
    if (!c.keeper || !c.room) return;
    if (channel !== "town" && channel !== "world") return;
    const now = Date.now();
    if (now - c.lastChatAt < 700) return;
    const text = textRaw.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, CHAT_MAX);
    if (!text) return;
    c.lastChatAt = now;
    const msg: ServerMsg = { t: "chat", channel, from: c.keeper.name, fromId: c.keeper.id, text, at: now };
    if (channel === "world") {
      for (const other of this.clients) send(other, msg);
    } else {
      for (const other of c.room.clients) {
        if (other.map !== c.map) continue;
        if (c.map === "den" && other !== c) continue;
        send(other, msg);
      }
    }
  }

  // ── State views ───────────────────────────────────────────────────

  /**
   * Re-read a keeper whose row changed outside the socket — cashing gold
   * out happens over HTTP — and push the new state to their screen.
   */
  refreshKeeper(id: string) {
    for (const c of this.clients) {
      if (c.keeper?.id !== id) continue;
      const fresh = getKeeper(id);
      if (!fresh) continue;
      c.keeper = fresh;
      send(c, { t: "self", self: this.selfState(c) });
    }
  }

  selfState(c: Client): SelfState {
    const k = c.keeper!;
    this.resetDay(k);
    const nest = this.nestState(c);
    return {
      id: k.id,
      name: k.name,
      look: k.look,
      gold: k.gold,
      bag: getBag(k.id),
      bagCapacity: BAG_CAPACITY,
      critters: c.critters.map<OwnedCritter>((cr) => ({
        id: cr.id,
        species: cr.species,
        name: cr.name,
        fed: cr.fed,
        tokenId: cr.tokenId,
        state: cr.state,
        job: cr.job ? { spotId: cr.job.spotId, kind: cr.job.kind, endsAt: cr.job.endsAt, startedAt: cr.job.startedAt } : undefined,
      })),
      soldToday: k.sold_today,
      traderCap: TRADER_DAILY_CAP,
      nest: nest.ready,
      nestReadyAt: nest.readyAt,
      map: c.map,
    };
  }

  private playerView(c: Client): PlayerView {
    return {
      id: c.keeper!.id,
      name: c.keeper!.name,
      look: c.keeper!.look,
      x: Math.round(c.x * 100) / 100,
      y: Math.round(c.y * 100) / 100,
      facing: c.facing,
      moving: c.moving,
    };
  }

  private critterView(c: Client, cr: LiveCritter): CritterView {
    return {
      id: cr.id,
      owner: c.keeper!.id,
      species: cr.species,
      name: cr.name,
      x: Math.round(cr.x * 100) / 100,
      y: Math.round(cr.y * 100) / 100,
      facing: cr.facing,
      moving: cr.moving,
      state: cr.state,
      job: cr.job ? { spotId: cr.job.spotId, kind: cr.job.kind, endsAt: cr.job.endsAt, startedAt: cr.job.startedAt } : undefined,
    };
  }

  // ── Simulation ────────────────────────────────────────────────────

  private spawnWild(room: Room) {
    room.wild = [];
    for (let i = 0; i < config.wildPerRoom; i++) this.addWild(room);
  }

  /** Put one more wild critter somewhere it can stand. */
  private addWild(room: Room) {
    const map = getMap("meadow");
    if (room.wild.length >= config.wildPerRoom) return;
    for (let tries = 0; tries < 400; tries++) {
      const x = 3 + Math.random() * (map.width - 6);
      const y = 3 + Math.random() * (map.height - 6);
      if (!canStand(map, x, y)) continue;
      room.wild.push({
        id: `wild-${room.id}-${this.wildSeq++}`,
        species: SPECIES[Math.floor(Math.random() * SPECIES.length)].id,
        x,
        y,
        facing: "down",
        moving: false,
        tx: x,
        ty: y,
        nextThinkAt: Date.now() + Math.random() * 3000,
        trust: 0,
      });
      return;
    }
  }

  private stepWild(room: Room, dt: number) {
    const map = getMap("meadow");
    const now = Date.now();
    for (const w of room.wild) {
      if (now >= w.nextThinkAt) {
        w.nextThinkAt = now + 1500 + Math.random() * 4000;
        if (Math.random() < 0.7) {
          const tx = w.x + (Math.random() - 0.5) * 6;
          const ty = w.y + (Math.random() - 0.5) * 6;
          if (canStand(map, tx, ty)) {
            w.tx = tx;
            w.ty = ty;
          }
        } else {
          w.tx = w.x;
          w.ty = w.y;
        }
      }
      const dx = w.tx - w.x;
      const dy = w.ty - w.y;
      const d = Math.hypot(dx, dy);
      if (d < 0.05) {
        w.moving = false;
        continue;
      }
      const step = Math.min(d, 1.8 * dt);
      const nx = w.x + (dx / d) * step;
      const ny = w.y + (dy / d) * step;
      if (canStand(map, nx, ny)) {
        w.facing = facingFrom(dx, dy, w.facing);
        w.x = nx;
        w.y = ny;
        w.moving = true;
      } else {
        w.tx = w.x;
        w.ty = w.y;
        w.moving = false;
      }
    }
  }

  private stepFollowers(c: Client) {
    let slot = 0;
    for (const cr of c.critters) {
      if (cr.state !== "follow") continue;
      const idx = Math.min(c.trail.length - 1, (slot + 1) * TRAIL_STEP);
      slot++;
      const target = idx >= 0 ? c.trail[idx] : { x: c.x, y: c.y };
      const dx = target.x - cr.x;
      const dy = target.y - cr.y;
      const d = Math.hypot(dx, dy);
      if (d > 6) {
        cr.x = target.x;
        cr.y = target.y;
        cr.moving = false;
        continue;
      }
      if (d < 0.08) {
        cr.moving = false;
        continue;
      }
      cr.x += dx * 0.35;
      cr.y += dy * 0.35;
      cr.facing = facingFrom(dx, dy, cr.facing);
      cr.moving = true;
    }
  }

  /** One frame for every bot in a room, with the room's own view of it. */
  private stepBots(room: Room, dt: number, now: number) {
    if (room.bots.length === 0) return;
    const map = getMap("meadow");
    const ctx: BotContext = {
      map,
      botsAtSpot: (spotId) => this.botsAtSpot(room, spotId),
      spotIsFull: (spot) => this.spotLoad(room, "meadow", spot.id) >= spot.capacity,
      jobSeconds: (kind) => this.jobSeconds()[kind],
      say: (bot, text) => {
        if (!config.botChat) return;
        bot.bubbleUntil = now + 6000;
        const msg: ServerMsg = { t: "chat", channel: "town", from: bot.name, fromId: bot.id, text, at: now };
        for (const c of room.clients) if (c.map === "meadow") send(c, msg);
      },
    };
    for (const bot of room.bots) stepBot(bot, ctx, dt, now);
  }

  private tick() {
    const now = Date.now();
    const dt = TICK_MS / 1000;
    for (const room of this.rooms) {
      this.stepWild(room, dt);
      this.stepBots(room, dt, now);
      // Build the meadow snapshot once, send it to everyone standing in it.
      const players: PlayerView[] = [];
      const critters: CritterView[] = [];
      const spotLoad: Record<string, number> = {};
      for (const bot of room.bots) {
        players.push(botPlayerView(bot));
        for (const cr of bot.critters) {
          critters.push(botCritterView(bot, cr));
          if (cr.job) spotLoad[cr.job.spotId] = (spotLoad[cr.job.spotId] ?? 0) + 1;
        }
      }
      for (const c of room.clients) {
        if (!c.keeper) continue;
        this.stepFollowers(c);
        for (const cr of c.critters) {
          if (cr.job && now >= cr.job.endsAt) this.completeJob(c, cr);
        }
        if (c.map !== "meadow") continue;
        players.push(this.playerView(c));
        for (const cr of c.critters) {
          if (cr.state === "rest") continue;
          critters.push(this.critterView(c, cr));
          if (cr.job) spotLoad[cr.job.spotId] = (spotLoad[cr.job.spotId] ?? 0) + 1;
        }
      }
      const wild: WildView[] = room.wild.map((w) => ({
        id: w.id,
        species: w.species,
        x: Math.round(w.x * 100) / 100,
        y: Math.round(w.y * 100) / 100,
        facing: w.facing,
        moving: w.moving,
        trust: w.trust,
      }));
      const meadowMsg = JSON.stringify({ t: "snapshot", at: now, map: "meadow", players, critters, wild, spotLoad } satisfies ServerMsg);
      for (const c of room.clients) {
        if (c.ws.readyState !== c.ws.OPEN) continue;
        if (c.map === "meadow") {
          c.ws.send(meadowMsg);
        } else if (c.keeper) {
          const mine = c.critters.filter((cr) => cr.state !== "rest").map((cr) => this.critterView(c, cr));
          send(c, { t: "snapshot", at: now, map: c.map, players: [this.playerView(c)], critters: mine, wild: [], spotLoad: {} });
        }
      }
    }
    if (now - this.lastOnlineAt > 5000) this.broadcastOnline();
  }

  private broadcastOnline() {
    this.lastOnlineAt = Date.now();
    const msg: ServerMsg = { t: "online", rooms: this.roomsInfo() };
    for (const c of this.clients) send(c, msg);
  }
}

export function newCritterId(): string {
  return randomUUID();
}
