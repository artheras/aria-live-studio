/** WebSocket hub: dashboard + overlay clients receive throttled snapshots. */
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import type { ClientRole, LiveState, ServerMessage } from "@aria-live/shared";
import { overlaySnapshot } from "./redact.ts";

interface Client {
  ws: WebSocket;
  role: ClientRole;
  alive: boolean;
}

export interface WsHubOptions {
  getState(): LiveState;
  /** Decide whether an upgrade is allowed; returns the role or an HTTP status to refuse with. */
  authorize(req: IncomingMessage, url: URL): ClientRole | number;
  minIntervalMs?: number;
  heartbeatMs?: number;
}

export class WsHub {
  private readonly wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
  private readonly clients = new Set<Client>();
  private lastSent = 0;
  private timer: NodeJS.Timeout | null = null;
  private heartbeat: NodeJS.Timeout;
  private readonly minInterval: number;

  constructor(private readonly opts: WsHubOptions) {
    this.minInterval = opts.minIntervalMs ?? 100;
    this.heartbeat = setInterval(() => this.ping(), opts.heartbeatMs ?? 25_000);
    this.heartbeat.unref?.();
  }

  get size(): number {
    return this.clients.size;
  }

  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer, url: URL): void {
    const role = this.opts.authorize(req, url);
    if (typeof role === "number") {
      const text = role === 401 ? "Unauthorized" : role === 403 ? "Forbidden" : "Bad Request";
      socket.write(`HTTP/1.1 ${role} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
      socket.destroy();
      return;
    }
    this.wss.handleUpgrade(req, socket, head, (ws) => this.add(ws, role));
  }

  private add(ws: WebSocket, role: ClientRole): void {
    const c: Client = { ws, role, alive: true };
    this.clients.add(c);
    ws.on("pong", () => (c.alive = true));
    ws.on("close", () => this.clients.delete(c));
    ws.on("error", () => this.clients.delete(c));
    ws.on("message", () => {}); // clients only listen
    this.send(c, { type: "hello", role, serverTime: Date.now() });
    const st = this.opts.getState();
    this.send(c, { type: "snapshot", state: role === "overlay" ? overlaySnapshot(st) : st });
  }

  private send(c: Client, msg: ServerMessage | string): void {
    if (c.ws.readyState !== c.ws.OPEN) return;
    c.ws.send(typeof msg === "string" ? msg : JSON.stringify(msg));
  }

  /** Schedule a broadcast (max one per minInterval, trailing). */
  notify(): void {
    if (this.timer) return;
    const wait = Math.max(0, this.lastSent + this.minInterval - Date.now());
    this.timer = setTimeout(() => {
      this.timer = null;
      this.broadcast();
    }, wait);
  }

  broadcast(): void {
    this.lastSent = Date.now();
    if (this.clients.size === 0) return;
    const st = this.opts.getState();
    let dash: string | null = null;
    let overlay: string | null = null;
    for (const c of this.clients) {
      if (c.role === "dashboard") this.send(c, (dash ??= JSON.stringify({ type: "snapshot", state: st })));
      else this.send(c, (overlay ??= JSON.stringify({ type: "snapshot", state: overlaySnapshot(st) })));
    }
  }

  closeRole(role: ClientRole, code = 4001, reason = "signed out"): void {
    for (const c of this.clients) if (c.role === role) c.ws.close(code, reason);
  }

  private ping(): void {
    for (const c of this.clients) {
      if (!c.alive) {
        c.ws.terminate();
        this.clients.delete(c);
        continue;
      }
      c.alive = false;
      try {
        c.ws.ping();
      } catch {
        /* ignore */
      }
    }
  }

  close(): void {
    clearInterval(this.heartbeat);
    if (this.timer) clearTimeout(this.timer);
    for (const c of this.clients) c.ws.terminate();
    this.clients.clear();
    this.wss.close();
  }
}
