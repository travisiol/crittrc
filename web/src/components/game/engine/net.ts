import type { ClientMsg, ServerMsg } from "@/shared/protocol";
import { wsUrl } from "@/lib/site";

/**
 * One socket, one `hello`, and a handler for everything the server says.
 * Reconnects on its own with a short backoff; the caller decides what a
 * fresh `welcome` means for the screen.
 */

export type NetStatus = "connecting" | "open" | "reconnecting" | "closed";

export class Net {
  private ws: WebSocket | null = null;
  private closedByUs = false;
  private attempts = 0;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  status: NetStatus = "closed";
  latency = 0;

  constructor(
    private hello: { session?: string; room: string },
    private onMessage: (m: ServerMsg) => void,
    private onStatus: (s: NetStatus) => void,
  ) {}

  connect() {
    this.closedByUs = false;
    this.open();
  }

  private setStatus(s: NetStatus) {
    this.status = s;
    this.onStatus(s);
  }

  private open() {
    this.setStatus(this.attempts === 0 ? "connecting" : "reconnecting");
    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl());
    } catch {
      this.scheduleRetry();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.attempts = 0;
      this.setStatus("open");
      ws.send(JSON.stringify({ t: "hello", ...this.hello } satisfies ClientMsg));
      this.pingTimer = setInterval(() => this.send({ t: "ping", at: Date.now() }), 10_000);
    };
    ws.onmessage = (ev) => {
      let msg: ServerMsg;
      try {
        msg = JSON.parse(String(ev.data)) as ServerMsg;
      } catch {
        return;
      }
      if (msg.t === "pong") this.latency = Math.max(0, Date.now() - msg.at);
      this.onMessage(msg);
    };
    ws.onclose = () => {
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = null;
      this.ws = null;
      if (this.closedByUs) {
        this.setStatus("closed");
        return;
      }
      this.scheduleRetry();
    };
    ws.onerror = () => {
      // onclose follows; nothing to do here.
    };
  }

  private scheduleRetry() {
    this.attempts++;
    this.setStatus("reconnecting");
    const delay = Math.min(8000, 500 * 2 ** Math.min(4, this.attempts));
    setTimeout(() => {
      if (!this.closedByUs) this.open();
    }, delay);
  }

  send(m: ClientMsg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  close() {
    this.closedByUs = true;
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    this.ws?.close();
    this.ws = null;
    this.setStatus("closed");
  }
}
