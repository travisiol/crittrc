"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { canStand, dist2, getMap, type Interactable, type MapId, type Npc, type Spot } from "@/shared/maps";
import type { Look, RoomInfo, SelfState, ServerMsg, VerifyResponse } from "@/shared/protocol";
import { WALK_SPEED, MOVE_HZ } from "@/shared/protocol";
import { ITEMS, JOB_LABEL } from "@/shared/items";
import { speciesById } from "@/shared/species";
import { api, getSession, setSession } from "@/lib/api";
import { Renderer } from "./engine/renderer";
import { Net, type NetStatus } from "./engine/net";
import { Input, type Action } from "./engine/input";
import { applySnapshot, clearRoom, createWorld, easeEntities, resetWorld, type ClientWorld } from "./engine/state";
import { Door } from "./screens/Door";
import { TitleScreen } from "./screens/TitleScreen";
import { RoomPicker } from "./screens/RoomPicker";
import { FittingRoom } from "./screens/FittingRoom";
import { Hud, type Prompt } from "./hud/Hud";
import { type ChatLine } from "./hud/ChatPanel";

/**
 * The game. One canvas, one world object the render loop reads, and a
 * handful of React overlays for the parts that are forms and lists.
 */

type Phase = "title" | "door" | "rooms" | "fitting" | "play";
export type Modal = "none" | "bag" | "trader" | "map" | "board" | "sign" | "bank";

export interface Toast {
  id: number;
  text: string;
  kind: "info" | "warn" | "good";
}

let toastId = 0;

export function Game() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // One world object for the whole life of the component: the render loop
  // mutates it every frame, React only ever reads it in event handlers.
  const [world] = useState<ClientWorld>(createWorld);
  const worldRef = useRef(world);
  const [net, setNet] = useState<Net | null>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const netRef = useRef<Net | null>(null);
  const inputRef = useRef<Input | null>(null);
  // The touch pad is a React child, so the input also lives in state.
  const [input, setInput] = useState<Input | null>(null);
  const promptRef = useRef<Prompt | null>(null);
  const nearRef = useRef<{ spot: Spot | null; target: Interactable | null; npc: Npc | null; wild: string | null }>({
    spot: null,
    target: null,
    npc: null,
    wild: null,
  });

  const [phase, setPhase] = useState<Phase>("title");
  const [serverDown, setServerDown] = useState(false);
  const [session, setSessionState] = useState<string | null>(null);
  const [verify, setVerify] = useState<VerifyResponse | null>(null);
  const [rooms, setRooms] = useState<RoomInfo[]>([]);
  const [room, setRoom] = useState<RoomInfo | null>(null);
  const [spectating, setSpectating] = useState(false);
  const [netStatus, setNetStatus] = useState<NetStatus>("closed");
  const [self, setSelf] = useState<SelfState | null>(null);
  const [mapId, setMapId] = useState<MapId>("meadow");
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [modal, setModal] = useState<Modal>("none");
  const [signText, setSignText] = useState<string>("");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [chat, setChat] = useState<ChatLine[]>([]);
  const [chatOpen, setChatOpen] = useState(false);
  const [fatal, setFatal] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const map = useMemo(() => getMap(mapId), [mapId]);

  const toast = useCallback((text: string, kind: Toast["kind"] = "info") => {
    const id = ++toastId;
    setToasts((t) => [...t.slice(-3), { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);

  // ── Server messages ───────────────────────────────────────────────
  const onMessage = useCallback(
    (m: ServerMsg) => {
      const w = worldRef.current;
      switch (m.t) {
        case "welcome": {
          w.clockOffset = m.serverTime - Date.now();
          w.jobSeconds = m.jobSeconds;
          w.map = m.map;
          setMapId(m.map);
          setRoom(m.room);
          clearRoom(w);
          if (m.self) {
            const start = getMap(m.map).spawn;
            w.self = {
              id: m.self.id,
              name: m.self.name,
              look: m.self.look,
              x: start.x + 0.5,
              y: start.y + 0.5,
              facing: "down",
              moving: false,
            };
            w.selfState = m.self;
            setSelf(m.self);
            setSpectating(false);
          } else {
            w.self = null;
            w.selfState = null;
            setSelf(null);
            setSpectating(true);
          }
          // A keeper's welcome opens the meadow. A spectator welcome only
          // paints the world behind whatever screen is up (door, fitting room).
          if (m.self) setPhase("play");
          return;
        }
        case "snapshot":
          applySnapshot(w, m);
          return;
        case "self":
          w.selfState = m.self;
          setSelf(m.self);
          return;
        case "job:done": {
          const item = ITEMS[m.item];
          const junk = !item || item.price === 0;
          if (w.self) {
            w.floaters.push({
              text: `+ ${item?.name ?? m.item}`,
              x: w.self.x,
              y: w.self.y,
              bornAt: Date.now(),
              color: junk ? "#b9c3ad" : "#f5c542",
            });
          }
          toast(
            junk
              ? `${m.critterName} came back with ${item?.name.toLowerCase() ?? m.item}. Junk — the trader clears it for nothing.`
              : `${m.critterName} brought back a ${item?.name.toLowerCase() ?? m.item}!`,
            junk ? "info" : "good",
          );
          return;
        }
        case "toast":
          toast(m.text, m.kind);
          return;
        case "chat": {
          setChat((c) => [...c.slice(-80), { channel: m.channel, from: m.from, fromId: m.fromId, text: m.text, at: m.at }]);
          const until = Date.now() + 6000;
          if (w.self && m.fromId === w.self.id) w.self.bubble = { text: m.text, until };
          const p = w.players.get(m.fromId);
          if (p) p.bubble = { text: m.text, until };
          return;
        }
        case "map": {
          if (m.map !== w.map) {
            w.map = m.map;
            clearRoom(w);
            setMapId(m.map);
            setModal("none");
          }
          if (w.self) {
            w.self.x = m.x;
            w.self.y = m.y;
          }
          return;
        }
        case "error":
          if (m.text === "world full") {
            toast("That copy of the meadow is full. Pick another.", "warn");
            netRef.current?.close();
            setPhase("rooms");
          } else if (m.text.includes("expired")) {
            setSession(null);
            setSessionState(null);
            setFatal(m.text);
          } else {
            toast(m.text, "warn");
          }
          return;
        case "online":
          setRooms(m.rooms);
          setRoom((r) => (r ? (m.rooms.find((x) => x.id === r.id) ?? r) : r));
          return;
        case "pong":
          w.clockOffset = m.serverTime - Date.now();
          return;
      }
    },
    [toast],
  );

  // ── Connection helpers ────────────────────────────────────────────
  const connect = useCallback(
    (roomId: string, asPlayer: boolean) => {
      netRef.current?.close();
      const next = new Net({ session: asPlayer ? (getSession() ?? undefined) : undefined, room: roomId }, onMessage, setNetStatus);
      netRef.current = next;
      setNet(next);
      next.connect();
    },
    [onMessage],
  );

  // On mount: put a spectator camera on Meadow 1 so the title screen has a
  // live world behind it, pull the room list, and quietly resume a session
  // if one is still in the tab. Resuming does not skip the title screen —
  // it only changes what the button on it says.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { rooms } = await api.rooms();
        if (!cancelled) setRooms(rooms);
      } catch {
        if (!cancelled) setServerDown(true);
      }
      if (cancelled) return;
      connect("meadow-1", false);
      const s = getSession();
      if (!s) return;
      try {
        const me = await api.me(s);
        if (cancelled) return;
        setSessionState(s);
        setVerify({ session: s, address: me.address, keeper: me.keeper, admitted: me.admitted, eggs: [] });
      } catch {
        setSession(null);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => netRef.current?.close(), []);

  // ── Actions from the keyboard ─────────────────────────────────────
  const sendJob = useCallback(
    (slot: number | null) => {
      const w = worldRef.current;
      const spot = nearRef.current.spot;
      if (!w.selfState || !spot) return;
      const followers = w.selfState.critters.filter((c) => c.state === "follow");
      const pick = slot === null ? followers[0] : w.selfState.critters[slot];
      if (!pick) return toast(followers.length ? "No critter in that slot." : "All your critters are busy.", "warn");
      if (pick.state !== "follow") return toast(`${pick.name} is ${pick.state === "work" ? "already working" : "resting"}.`, "warn");
      netRef.current?.send({ t: "job:start", spotId: spot.id, critterId: pick.id });
    },
    [toast],
  );

  // E: talk, read, go through. Shared by the E key and by space when there
  // is no spot to send anyone to.
  const interact = useCallback(() => {
      const npc = nearRef.current.npc;
      const target = nearRef.current.target;
      if (npc) {
        if (npc.key === "trader") setModal("trader");
        else if (npc.key === "hatcher") {
          setSignText("HATCHER: The hatchery is not open yet. When it is, an egg and some $CRITTR will get you a critter here. Nothing to sell today.");
          setModal("sign");
        } else if (npc.key === "warden") {
          setSignText("WARDEN: The gate behind me leads to your den. Nobody else can follow you through it. Your nests are there.");
          setModal("sign");
        } else if (npc.key === "angler") {
          setSignText("ANGLER: Tidlets and Buzzlets get the good fish. The rest of them mostly find boots. Same as me.");
          setModal("sign");
        }
        return;
      }
      if (target) {
        if (target.kind === "gate" && target.to) netRef.current?.send({ t: "gate", to: target.to });
        else if (target.kind === "board") setModal("board");
        else if (target.text) {
          setSignText(target.text);
          setModal("sign");
        }
      }
  }, []);

  const onAction = useCallback(
    (a: Action) => {
      const w = worldRef.current;
      if (a === "close") {
        if (chatOpen) setChatOpen(false);
        else setModal("none");
        return;
      }
      if (a === "chat") {
        if (!w.self) return toast("Connect a wallet to talk.", "warn");
        setChatOpen(true);
        return;
      }
      if (modal !== "none") return;
      if (!w.self) {
        if (a === "map") setModal("map");
        else toast("Connect a wallet first — the meadow only answers people it knows.", "warn");
        return;
      }
      switch (a) {
        case "bag":
          setModal("bag");
          return;
        case "map":
          setModal("map");
          return;
        case "bank":
          setModal("bank");
          return;
        case "use":
          if (nearRef.current.wild) netRef.current?.send({ t: "tame", wildId: nearRef.current.wild });
          else if (nearRef.current.spot) sendJob(null);
          else if (nearRef.current.npc || nearRef.current.target) interact();
          return;
        case "slot1":
          sendJob(0);
          return;
        case "slot2":
          sendJob(1);
          return;
        case "slot3":
          sendJob(2);
          return;
        case "interact":
          interact();
          return;
      }
    },
    [chatOpen, modal, sendJob, toast, interact],
  );

  // The render loop is created once; it reads the latest handler through a ref
  // that is refreshed from an effect, never during render.
  const onActionRef = useRef(onAction);
  useEffect(() => {
    onActionRef.current = onAction;
  }, [onAction]);

  // ── The loop ──────────────────────────────────────────────────────
  // The world is drawn behind the door and the fitting room too; only the
  // room list is a plain screen.
  useEffect(() => {
    if (phase === "rooms") return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = new Renderer(canvas);
    rendererRef.current = renderer;
    renderer.resize();
    const input = new Input((a) => onActionRef.current(a));
    inputRef.current = input;
    setInput(input);
    input.attach();
    if (process.env.NODE_ENV !== "production") {
      // Dev hook: lets a console (or a test) move the camera and read state.
      const dev = window as unknown as { __crittrWorld?: ClientWorld; __crittrInput?: Input };
      dev.__crittrWorld = world;
      dev.__crittrInput = input;
    }
    const onResize = () => renderer.resize();
    window.addEventListener("resize", onResize);

    let raf = 0;
    let last = performance.now();
    let lastSend = 0;
    let lastPromptKey = "";
    const w = worldRef.current;

    const frame = (t: number) => {
      const dt = Math.min(0.1, (t - last) / 1000);
      last = t;
      const currentMap = getMap(w.map);
      const [vx, vy] = input.vector();
      const moving = vx !== 0 || vy !== 0;

      if (w.self) {
        const me = w.self;
        if (moving) {
          const nx = me.x + vx * WALK_SPEED * dt;
          const ny = me.y + vy * WALK_SPEED * dt;
          if (canStand(currentMap, nx, me.y)) me.x = nx;
          if (canStand(currentMap, me.x, ny)) me.y = ny;
          me.facing = Math.abs(vx) > Math.abs(vy) ? (vx > 0 ? "right" : "left") : vy > 0 ? "down" : "up";
        }
        me.moving = moving;
        if (t - lastSend > 1000 / MOVE_HZ) {
          lastSend = t;
          netRef.current?.send({ t: "move", x: me.x, y: me.y, facing: me.facing, moving });
        }

        // What is within reach.
        let spot: Spot | null = null;
        let best = 2.6 * 2.6;
        for (const s of currentMap.spots) {
          const d = dist2(me.x, me.y, s.x + 0.5, s.y + 0.5);
          if (d < best) {
            best = d;
            spot = s;
          }
        }
        let target: Interactable | null = null;
        best = 1.9 * 1.9;
        for (const i of currentMap.interactables) {
          const d = dist2(me.x, me.y, i.x + 0.5, i.y + 0.5);
          if (d < best) {
            best = d;
            target = i;
          }
        }
        let npc: Npc | null = null;
        best = 2.1 * 2.1;
        for (const n of currentMap.npcs) {
          const d = dist2(me.x, me.y, n.x + 0.5, n.y + 0.5);
          if (d < best) {
            best = d;
            npc = n;
          }
        }
        // A wild critter has to be almost touching before it takes the
        // prompt away from a working spot you are standing at.
        let wild: string | null = null;
        best = 1.7 * 1.7;
        for (const c of w.wild.values()) {
          const d = dist2(me.x, me.y, c.dx, c.dy);
          if (d < best) {
            best = d;
            wild = c.id;
          }
        }
        nearRef.current = { spot, target, npc, wild };

        let next: Prompt | null = null;
        if (npc) next = { key: "E", text: npc.key === "trader" ? "Talk to the trader" : `Talk to the ${npc.name.toLowerCase()}` };
        else if (target) next = { key: "E", text: target.label };
        else if (wild) {
          const treats = w.selfState?.bag.find((b) => b.item === "treat")?.qty ?? 0;
          const seen = w.wild.get(wild);
          const species = seen ? speciesById(seen.species).name : "critter";
          if (treats > 0) {
            next = {
              key: "SPACE",
              text: `Offer a treat to the ${species.toLowerCase()}`,
              hint: seen && seen.trust > 0 ? `${Math.round(seen.trust)}% of the way · ${treats} left` : `${treats} treats`,
            };
          } else {
            next = { key: "", text: "A treat would keep it here. The trader sells them.", dim: true };
          }
        } else if (spot) {
          const followers = w.selfState?.critters.filter((c) => c.state === "follow") ?? [];
          const busy = w.selfState?.critters.some((c) => c.job?.spotId === spot.id);
          if (followers.length) next = { key: "SPACE", text: `Send ${followers[0].name} to ${JOB_LABEL[spot.job].verb}`, hint: "1 2 3 picks another" };
          else next = { key: "", text: busy ? `${JOB_LABEL[spot.job].noun} here` : "All your critters are busy", dim: true };
        }
        const key = next ? `${next.key}|${next.text}|${next.dim}` : "";
        if (key !== lastPromptKey) {
          lastPromptKey = key;
          promptRef.current = next;
          setPrompt(next);
        }
      } else if (moving) {
        w.camera.x = Math.max(0, Math.min(currentMap.width, w.camera.x + vx * WALK_SPEED * 1.6 * dt));
        w.camera.y = Math.max(0, Math.min(currentMap.height, w.camera.y + vy * WALK_SPEED * 1.6 * dt));
      }

      easeEntities(w, dt);
      renderer.render(w, currentMap, {
        nearSpot: nearRef.current.spot,
        target: nearRef.current.target,
        nearWild: nearRef.current.wild,
        spectating: !w.self,
      });
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      input.detach();
      setInput(null);
      window.removeEventListener("resize", onResize);
    };
  }, [phase, world]);

  // Pause walking while a modal or the chat box has the keyboard.
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.suspended = modal !== "none" || chatOpen || phase !== "play";
      if (inputRef.current.suspended) inputRef.current.release();
    }
  }, [modal, chatOpen, phase]);

  // Re-render the HUD once a second for countdowns.
  useEffect(() => {
    if (phase !== "play") return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [phase]);

  // ── Screen transitions ────────────────────────────────────────────
  const onSignedIn = (v: VerifyResponse) => {
    setSession(v.session);
    setSessionState(v.session);
    setVerify(v);
    setFatal(null);
    setPhase("rooms");
  };

  const onLookAround = () => {
    setSpectating(true);
    setPhase("play");
    if (!netRef.current || netRef.current.status === "closed") connect("meadow-1", false);
  };

  const onPickRoom = (r: RoomInfo) => {
    setRoom(r);
    if (verify?.keeper) {
      connect(r.id, true);
    } else {
      // The fitting room sits over the world you are about to join.
      connect(r.id, false);
      setPhase("fitting");
    }
  };

  const onKeeperMade = (keeper: { id: string; name: string; look: Look }) => {
    setVerify((v) => (v ? { ...v, keeper } : v));
    if (room) connect(room.id, true);
  };

  const signOut = () => {
    netRef.current?.close();
    setSession(null);
    setSessionState(null);
    setVerify(null);
    setSelf(null);
    resetWorld(world);
    setPhase("title");
    connect("meadow-1", false);
  };

  // The title screen's one button: straight to the room list when the tab
  // still holds a signature, otherwise through the door first.
  const onEnter = () => setPhase(verify?.admitted ? "rooms" : "door");

  const sendChat = (channel: "town" | "world", text: string) => {
    netRef.current?.send({ t: "chat", channel, text });
  };

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-[#1a2a17] text-hud-text select-none">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />

      {phase === "play" && (
        <Hud
          self={self}
          map={map}
          room={room}
          rooms={rooms}
          spectating={spectating}
          netStatus={netStatus}
          prompt={prompt}
          modal={modal}
          setModal={setModal}
          signText={signText}
          toasts={toasts}
          chat={chat}
          chatOpen={chatOpen}
          setChatOpen={setChatOpen}
          sendChat={sendChat}
          net={net}
          world={world}
          session={session}
          onToast={toast}
          input={input}
          address={verify?.address ?? null}
          onGetKeeper={() => setPhase("title")}
          onSignOut={signOut}
          tick={tick}
        />
      )}

      {phase === "title" && (
        <TitleScreen
          rooms={rooms}
          keeperName={verify?.keeper?.name ?? null}
          onEnter={onEnter}
          onLookAround={onLookAround}
          offline={serverDown}
        />
      )}

      {phase === "door" && (
        <Door
          onSignedIn={onSignedIn}
          onLookAround={onLookAround}
          onBack={() => setPhase("title")}
          fatal={fatal}
          hasSession={!!session}
        />
      )}

      {phase === "rooms" && (
        <RoomPicker rooms={rooms} onPick={onPickRoom} onBack={() => setPhase("title")} onSignOut={signOut} verify={verify} />
      )}

      {phase === "fitting" && session && (
        <FittingRoom session={session} onDone={onKeeperMade} onBack={() => setPhase("rooms")} />
      )}
    </div>
  );
}
