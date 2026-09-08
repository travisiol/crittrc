import { canStand, findPath, getMap, mulberry32, type Facing, type GameMap, type Spot } from "../../web/src/shared/maps";
import { JOB_LABEL } from "../../web/src/shared/items";
import { SPECIES, speciesById } from "../../web/src/shared/species";
import { LOOK_COUNTS, type CritterView, type Look, type PlayerView } from "../../web/src/shared/protocol";

/**
 * The meadow's own inhabitants.
 *
 * These are not fake numbers on a counter: each one is a keeper standing
 * in the world, walking the paths, sending a critter to a bush and talking
 * now and then. They are what stops the first person through the door from
 * arriving somewhere empty. They hold no wallet, own no gold and can never
 * claim anything — everything they do is scenery.
 *
 * They also leave room: a bot will only ever take one of the three places
 * at a working spot, so a real keeper is never crowded out.
 */

const SYLLABLES_A = ["mo", "bra", "fen", "tal", "wisp", "kel", "rin", "dov", "hal", "sor", "pim", "cal", "vex", "nim", "ros", "gan", "tib", "wren", "hol", "urs"];
const SYLLABLES_B = ["by", "ric", "dle", "ley", "wick", "ver", "mer", "ton", "dan", "sel", "per", "rick", "nan", "ket", "worth", "lin", "gar", "hew", "beck", "ny"];

export interface BotCritter {
  id: string;
  species: number;
  name: string;
  x: number;
  y: number;
  facing: Facing;
  moving: boolean;
  state: "follow" | "work";
  job?: { spotId: string; kind: Spot["job"]; startedAt: number; endsAt: number };
}

type Brain = "settle" | "wander" | "toSpot" | "waiting" | "toTrader" | "loiter";

export interface Bot {
  id: string;
  name: string;
  look: Look;
  x: number;
  y: number;
  facing: Facing;
  moving: boolean;
  speed: number;
  path: Array<{ x: number; y: number }>;
  brain: Brain;
  nextThinkAt: number;
  spot: Spot | null;
  critters: BotCritter[];
  trail: Array<{ x: number; y: number }>;
  phase: number;
  bubbleUntil: number;
}

export interface BotContext {
  map: GameMap;
  /** How many of this room's bots already work that spot. */
  botsAtSpot: (spotId: string) => number;
  /** Everyone at the spot, bots and people, against its capacity. */
  spotIsFull: (spot: Spot) => boolean;
  jobSeconds: (kind: Spot["job"]) => number;
  say: (bot: Bot, text: string) => void;
}

const CHATTER = [
  "anyone pulled a gilded koi yet",
  "quarry is quiet today",
  "my cobbl keeps finding gravel",
  "the trader capped me again",
  "brb, watering",
  "treats actually work, try one",
  "who is at the pond",
  "nice hat",
  "third boot in a row",
  "moon cap!!",
  "back in a sec",
  "which bush is best",
  "star shard finally",
  "afk a minute",
  "gm",
];

export function makeBotNames(count: number, seed: number, taken: (name: string) => boolean): string[] {
  const rnd = mulberry32(seed);
  const out: string[] = [];
  const used = new Set<string>();
  let guard = 0;
  while (out.length < count && guard++ < count * 60) {
    const a = SYLLABLES_A[Math.floor(rnd() * SYLLABLES_A.length)];
    const b = SYLLABLES_B[Math.floor(rnd() * SYLLABLES_B.length)];
    let name = a + b;
    if (rnd() < 0.28) name += String(Math.floor(rnd() * 90) + 10);
    name = name.slice(0, 8);
    if (name.length < 3) continue;
    if (used.has(name.toLowerCase()) || taken(name)) continue;
    used.add(name.toLowerCase());
    out.push(name);
  }
  return out;
}

export function makeBots(roomId: string, names: string[], seed: number): Bot[] {
  const map = getMap("meadow");
  const rnd = mulberry32(seed);
  const bots: Bot[] = [];

  for (let i = 0; i < names.length; i++) {
    let x = map.spawn.x + 0.5;
    let y = map.spawn.y + 0.5;
    for (let tries = 0; tries < 300; tries++) {
      const cx = 6 + rnd() * (map.width - 12);
      const cy = 6 + rnd() * (map.height - 12);
      if (canStand(map, cx, cy)) {
        x = cx;
        y = cy;
        break;
      }
    }
    const critterCount = 1 + Math.floor(rnd() * 3);
    const critters: BotCritter[] = [];
    for (let c = 0; c < critterCount; c++) {
      const species = SPECIES[Math.floor(rnd() * SPECIES.length)];
      critters.push({
        id: `botc-${roomId}-${i}-${c}`,
        species: species.id,
        name: species.name,
        x,
        y,
        facing: "down",
        moving: false,
        state: "follow",
      });
    }
    bots.push({
      id: `bot-${roomId}-${i}`,
      name: names[i],
      look: {
        skin: Math.floor(rnd() * LOOK_COUNTS.skin),
        eyes: Math.floor(rnd() * LOOK_COUNTS.eyes),
        outfit: Math.floor(rnd() * LOOK_COUNTS.outfit),
        hair: Math.floor(rnd() * LOOK_COUNTS.hair),
        hat: Math.floor(rnd() * LOOK_COUNTS.hat),
      },
      x,
      y,
      facing: "down",
      moving: false,
      speed: 2.6 + rnd() * 1.4,
      path: [],
      brain: "settle",
      nextThinkAt: Date.now() + rnd() * 6000,
      spot: null,
      critters,
      trail: [],
      phase: rnd() * 1000,
      bubbleUntil: 0,
    });
  }
  return bots;
}

function facingFrom(dx: number, dy: number, fallback: Facing): Facing {
  if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) return fallback;
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? "right" : "left";
  return dy > 0 ? "down" : "up";
}

function walkTo(bot: Bot, map: GameMap, x: number, y: number): boolean {
  const path = findPath(map, bot, { x, y });
  if (!path || path.length === 0) return false;
  bot.path = path;
  return true;
}

/**
 * One frame of one bot: move along the path, then decide what is next.
 * `now` is a millisecond clock; the caller passes the same one it uses for
 * job timers so bot work finishes on the same schedule as a player's.
 */
export function stepBot(bot: Bot, ctx: BotContext, dt: number, now: number) {
  const map = ctx.map;

  // ── Follow the path ───────────────────────────────────────────────
  if (bot.path.length > 0) {
    const next = bot.path[0];
    const dx = next.x - bot.x;
    const dy = next.y - bot.y;
    const d = Math.hypot(dx, dy);
    if (d < 0.08) {
      bot.path.shift();
      bot.moving = bot.path.length > 0;
      // Arriving is what prompts the next decision. The timers set when a
      // walk begins are only a fallback for a route that never finishes.
      if (bot.path.length === 0) bot.nextThinkAt = now + 200 + Math.random() * 1400;
    } else {
      const step = Math.min(d, bot.speed * dt);
      const nx = bot.x + (dx / d) * step;
      const ny = bot.y + (dy / d) * step;
      if (canStand(map, nx, ny)) {
        bot.x = nx;
        bot.y = ny;
        bot.facing = facingFrom(dx, dy, bot.facing);
        bot.moving = true;
      } else {
        // The world moved under it; give up on this route.
        bot.path = [];
        bot.moving = false;
        bot.brain = "wander";
        bot.nextThinkAt = now;
      }
    }
  } else {
    bot.moving = false;
  }

  const last = bot.trail[0];
  if (bot.moving && (!last || Math.hypot(last.x - bot.x, last.y - bot.y) > 0.22)) {
    bot.trail.unshift({ x: bot.x, y: bot.y });
    if (bot.trail.length > 24) bot.trail.length = 24;
  }

  // ── Critters ──────────────────────────────────────────────────────
  let slot = 0;
  for (const cr of bot.critters) {
    if (cr.state === "work") {
      if (cr.job && now >= cr.job.endsAt) {
        cr.state = "follow";
        cr.job = undefined;
        cr.x = bot.x;
        cr.y = bot.y;
      }
      continue;
    }
    const idx = Math.min(bot.trail.length - 1, (slot + 1) * 4);
    slot++;
    const t = idx >= 0 ? bot.trail[idx] : { x: bot.x, y: bot.y };
    const dx = t.x - cr.x;
    const dy = t.y - cr.y;
    const d = Math.hypot(dx, dy);
    if (d > 6) {
      cr.x = t.x;
      cr.y = t.y;
      cr.moving = false;
    } else if (d < 0.08) {
      cr.moving = false;
    } else {
      cr.x += dx * 0.3;
      cr.y += dy * 0.3;
      cr.facing = facingFrom(dx, dy, cr.facing);
      cr.moving = true;
    }
  }

  if (now < bot.nextThinkAt || bot.path.length > 0) return;

  // ── Decide ────────────────────────────────────────────────────────
  const rnd = Math.random();

  if (bot.brain === "toSpot" && bot.spot) {
    const spot = bot.spot;
    const idle = bot.critters.find((c) => c.state === "follow");
    if (idle && !ctx.spotIsFull(spot)) {
      const seconds = ctx.jobSeconds(spot.job);
      idle.state = "work";
      idle.x = spot.standX + 0.5;
      idle.y = spot.standY + 0.5;
      idle.facing = facingFrom(spot.x - spot.standX, spot.y - spot.standY, "down");
      idle.moving = false;
      idle.job = { spotId: spot.id, kind: spot.job, startedAt: now, endsAt: now + seconds * 1000 };
      if (Math.random() < 0.25) ctx.say(bot, `off you go, ${idle.name.toLowerCase()}`);
    }
    bot.spot = null;
    bot.brain = "loiter";
    bot.nextThinkAt = now + 4000 + Math.random() * 9000;
    return;
  }

  if (rnd < 0.06) {
    ctx.say(bot, CHATTER[Math.floor(Math.random() * CHATTER.length)]);
    bot.nextThinkAt = now + 2500 + Math.random() * 6000;
    return;
  }

  // Send a critter out: pick a spot no other bot is already working.
  if (rnd < 0.42 && bot.critters.some((c) => c.state === "follow")) {
    const free = map.spots.filter((s) => ctx.botsAtSpot(s.id) < 1 && !ctx.spotIsFull(s));
    if (free.length) {
      const spot = free[Math.floor(Math.random() * free.length)];
      if (walkTo(bot, map, spot.standX + 0.5, spot.standY + 0.5)) {
        bot.spot = spot;
        bot.brain = "toSpot";
        bot.nextThinkAt = now + 60_000;
        return;
      }
    }
  }

  // Stand at the trader for a bit, like someone selling.
  if (rnd < 0.55) {
    const trader = map.npcs.find((n) => n.key === "trader");
    if (trader && walkTo(bot, map, trader.x + 0.5, trader.y + 1.5)) {
      bot.brain = "toTrader";
      bot.nextThinkAt = now + 60_000;
      return;
    }
  }

  // Otherwise wander somewhere reachable and stop for a while.
  for (let tries = 0; tries < 12; tries++) {
    const tx = bot.x + (Math.random() - 0.5) * 22;
    const ty = bot.y + (Math.random() - 0.5) * 16;
    if (tx < 2 || ty < 2 || tx > map.width - 2 || ty > map.height - 2) continue;
    if (!canStand(map, tx, ty)) continue;
    if (walkTo(bot, map, tx, ty)) {
      bot.brain = "wander";
      bot.nextThinkAt = now + 45_000;
      return;
    }
  }
  bot.brain = "loiter";
  bot.nextThinkAt = now + 2000 + Math.random() * 6000;
}

export function botPlayerView(bot: Bot): PlayerView {
  return {
    id: bot.id,
    name: bot.name,
    look: bot.look,
    x: Math.round(bot.x * 100) / 100,
    y: Math.round(bot.y * 100) / 100,
    facing: bot.facing,
    moving: bot.moving,
  };
}

export function botCritterView(bot: Bot, cr: BotCritter): CritterView {
  return {
    id: cr.id,
    owner: bot.id,
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

/** Used only for the log line at boot. */
export function describeBots(bots: Bot[]): string {
  const jobs = bots.reduce((s, b) => s + b.critters.length, 0);
  void speciesById;
  void JOB_LABEL;
  return `${bots.length} keepers, ${jobs} critters`;
}
