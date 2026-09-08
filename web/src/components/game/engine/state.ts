import type { Facing, MapId } from "@/shared/maps";
import type { CritterView, Look, PlayerView, SelfState, WildView } from "@/shared/protocol";
import type { JobKind } from "@/shared/species";

/**
 * What the client knows about the room, kept in plain objects the renderer
 * reads every frame. Remote entities carry a target position from the last
 * snapshot and a displayed position that eases toward it.
 */

export interface RemotePlayer extends PlayerView {
  dx: number;
  dy: number;
  seenAt: number;
  bubble?: { text: string; until: number };
}

export interface RemoteCritter extends CritterView {
  dx: number;
  dy: number;
  seenAt: number;
}

export interface RemoteWild extends WildView {
  dx: number;
  dy: number;
  seenAt: number;
}

export interface Floater {
  text: string;
  x: number;
  y: number;
  bornAt: number;
  color: string;
}

export interface SelfEntity {
  id: string;
  name: string;
  look: Look;
  x: number;
  y: number;
  facing: Facing;
  moving: boolean;
  bubble?: { text: string; until: number };
}

export interface ClientWorld {
  map: MapId;
  self: SelfEntity | null;
  selfState: SelfState | null;
  players: Map<string, RemotePlayer>;
  critters: Map<string, RemoteCritter>;
  wild: Map<string, RemoteWild>;
  spotLoad: Record<string, number>;
  floaters: Floater[];
  /** Server clock minus local clock, in ms. */
  clockOffset: number;
  jobSeconds: Record<JobKind, number>;
  /** Free camera for spectators, in tiles. */
  camera: { x: number; y: number };
}

export function createWorld(): ClientWorld {
  return {
    map: "meadow",
    self: null,
    selfState: null,
    players: new Map(),
    critters: new Map(),
    wild: new Map(),
    spotLoad: {},
    floaters: [],
    clockOffset: 0,
    jobSeconds: { forage: 120, fish: 180, dig: 240 },
    camera: { x: 22, y: 18 },
  };
}

export function serverNow(w: ClientWorld): number {
  return Date.now() + w.clockOffset;
}

const EASE = 14;

export function easeEntities(w: ClientWorld, dt: number) {
  const k = 1 - Math.exp(-EASE * dt);
  for (const p of w.players.values()) {
    p.dx += (p.x - p.dx) * k;
    p.dy += (p.y - p.dy) * k;
  }
  for (const c of w.critters.values()) {
    c.dx += (c.x - c.dx) * k;
    c.dy += (c.y - c.dy) * k;
  }
  for (const c of w.wild.values()) {
    c.dx += (c.x - c.dx) * k;
    c.dy += (c.y - c.dy) * k;
  }
  const now = Date.now();
  w.floaters = w.floaters.filter((f) => now - f.bornAt < 1600);
}

export function applySnapshot(
  w: ClientWorld,
  snap: { at: number; map: MapId; players: PlayerView[]; critters: CritterView[]; wild: WildView[]; spotLoad: Record<string, number> },
) {
  if (snap.map !== w.map) return;
  const now = Date.now();
  const seenPlayers = new Set<string>();
  for (const p of snap.players) {
    if (w.self && p.id === w.self.id) continue;
    seenPlayers.add(p.id);
    const cur = w.players.get(p.id);
    if (cur) {
      Object.assign(cur, p, { seenAt: now });
      if (Math.abs(cur.dx - p.x) > 5 || Math.abs(cur.dy - p.y) > 5) {
        cur.dx = p.x;
        cur.dy = p.y;
      }
    } else {
      w.players.set(p.id, { ...p, dx: p.x, dy: p.y, seenAt: now });
    }
  }
  for (const id of [...w.players.keys()]) if (!seenPlayers.has(id)) w.players.delete(id);

  const seenCritters = new Set<string>();
  for (const c of snap.critters) {
    seenCritters.add(c.id);
    const cur = w.critters.get(c.id);
    if (cur) {
      const jump = Math.abs(cur.dx - c.x) > 4 || Math.abs(cur.dy - c.y) > 4 || cur.state !== c.state;
      Object.assign(cur, c, { seenAt: now });
      if (jump) {
        cur.dx = c.x;
        cur.dy = c.y;
      }
    } else {
      w.critters.set(c.id, { ...c, dx: c.x, dy: c.y, seenAt: now });
    }
  }
  for (const id of [...w.critters.keys()]) if (!seenCritters.has(id)) w.critters.delete(id);

  const seenWild = new Set<string>();
  for (const c of snap.wild) {
    seenWild.add(c.id);
    const cur = w.wild.get(c.id);
    if (cur) Object.assign(cur, c, { seenAt: now });
    else w.wild.set(c.id, { ...c, dx: c.x, dy: c.y, seenAt: now });
  }
  for (const id of [...w.wild.keys()]) if (!seenWild.has(id)) w.wild.delete(id);

  w.spotLoad = snap.spotLoad;
}

/** Put a world back to the state it had before any welcome. */
export function resetWorld(w: ClientWorld) {
  const fresh = createWorld();
  w.map = fresh.map;
  w.self = null;
  w.selfState = null;
  w.clockOffset = 0;
  w.camera = fresh.camera;
  clearRoom(w);
}

export function clearRoom(w: ClientWorld) {
  w.players.clear();
  w.critters.clear();
  w.wild.clear();
  w.spotLoad = {};
  w.floaters = [];
}
