/**
 * EventSub WebSocket client for `channel.chat.message`.
 * https://dev.twitch.tv/docs/eventsub/handling-websocket-events/
 *
 * - welcome -> subscribe (fresh sessions only) within 10s
 * - watchdog: no frame within keepalive_timeout + grace -> reconnect
 * - session_reconnect -> open reconnect_url, keep the old socket until the
 *   new welcome, then close the old one; subscriptions carry over
 * - revocation -> error; one resubscribe attempt unless the user revoked
 * - other disconnects -> exponential backoff with jitter, fresh session, resubscribe
 * - notifications deduped by message_id and dropped when older than 10 min
 */
import WebSocket from "ws";
import type { TwitchConnectionState } from "@aria-live/shared";
import type { EventSubApi } from "./helix.ts";
import { HelixError } from "./helix.ts";
import type { ChatMessageEvent } from "../live/commands.ts";

export const CHAT_SUBSCRIPTION = { type: "channel.chat.message", version: "1" } as const;

export const CLOSE_REASONS: Record<number, string> = {
  4000: "Twitch internal server error",
  4001: "client sent inbound traffic",
  4002: "client failed ping-pong",
  4003: "connection unused (no subscription in time)",
  4004: "reconnect grace time expired",
  4005: "network timeout",
  4006: "network error",
  4007: "invalid reconnect",
};

const MAX_MESSAGE_AGE_MS = 10 * 60 * 1000;
const DEDUPE_TTL_MS = 10 * 60 * 1000;
const DEDUPE_MAX = 2000;

export interface EventSubMetadata {
  message_id: string;
  message_type: string;
  message_timestamp: string;
  subscription_type?: string;
  subscription_version?: string;
}

export interface EventSubFrame {
  metadata: EventSubMetadata;
  payload: {
    session?: {
      id: string;
      status: string;
      keepalive_timeout_seconds: number | null;
      reconnect_url: string | null;
      connected_at?: string;
    };
    subscription?: { id: string; type: string; version: string; status: string; condition: Record<string, string> };
    event?: unknown;
  };
}

export interface ConnectionUpdate {
  state: TwitchConnectionState;
  sessionId: string | null;
  lastEventAt?: number;
  reconnects: number;
  error: string | null;
}

export interface EventSubHandlers {
  onChatMessage?(event: ChatMessageEvent, metadata: EventSubMetadata): void;
  onNotification?(type: string, event: unknown, metadata: EventSubMetadata): void;
  onRevocation?(subscription: NonNullable<EventSubFrame["payload"]["subscription"]>): void;
  onState?(update: ConnectionUpdate): void;
}

export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface EventSubOptions {
  url: string;
  api: EventSubApi;
  broadcasterUserId: string;
  /** The user whose token we use (same as broadcaster in this app). */
  userId: string;
  handlers?: EventSubHandlers;
  now?: () => number;
  random?: () => number;
  timers?: Timers;
  /** Extra slack on top of keepalive_timeout_seconds. Default 5000. */
  watchdogGraceMs?: number;
  /** Timeout waiting for session_welcome. Default 15000. */
  welcomeTimeoutMs?: number;
  backoffBaseMs?: number;
  backoffMaxMs?: number;
  log?: (msg: string) => void;
}

interface Conn {
  ws: WebSocket;
  sessionId: string | null;
  /** True when opened from a session_reconnect reconnect_url. */
  migrating: boolean;
  watchdog: unknown;
  keepaliveMs: number;
}

const defaultTimers: Timers = {
  setTimeout: (fn, ms) => {
    const t = setTimeout(fn, ms);
    t.unref?.();
    return t;
  },
  clearTimeout: (h) => clearTimeout(h as NodeJS.Timeout),
};

export class EventSubClient {
  private current: Conn | null = null;
  private pending: Conn | null = null;
  private stopped = true;
  private attempt = 0;
  private reconnects = 0;
  private backoffTimer: unknown = null;
  private state: TwitchConnectionState = "signed_out";
  private error: string | null = null;
  private lastEventAt: number | undefined;
  private seen = new Map<string, number>();
  private resubscribedAfterRevocation = new Set<string>();
  readonly subscriptionIds = new Set<string>();

  private readonly now: () => number;
  private readonly random: () => number;
  private readonly timers: Timers;
  private readonly grace: number;
  private readonly welcomeTimeout: number;
  private readonly base: number;
  private readonly max: number;
  private readonly log: (m: string) => void;

  constructor(private readonly opts: EventSubOptions) {
    this.now = opts.now ?? Date.now;
    this.random = opts.random ?? Math.random;
    this.timers = opts.timers ?? defaultTimers;
    this.grace = opts.watchdogGraceMs ?? 5000;
    this.welcomeTimeout = opts.welcomeTimeoutMs ?? 15000;
    this.base = opts.backoffBaseMs ?? 1000;
    this.max = opts.backoffMaxMs ?? 30000;
    this.log = opts.log ?? ((m) => console.log(`[eventsub] ${m}`));
  }

  get sessionId(): string | null {
    return this.current?.sessionId ?? null;
  }

  get connectionState(): TwitchConnectionState {
    return this.state;
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.attempt = 0;
    this.setState("connecting", null);
    this.open(this.opts.url, false);
  }

  stop(): void {
    this.stopped = true;
    if (this.backoffTimer) this.timers.clearTimeout(this.backoffTimer);
    this.backoffTimer = null;
    for (const c of [this.current, this.pending]) if (c) this.dispose(c, 1000);
    this.current = null;
    this.pending = null;
    this.subscriptionIds.clear();
    this.setState("signed_out", null);
  }

  // ── state ──

  private setState(state: TwitchConnectionState, error: string | null): void {
    this.state = state;
    this.error = error;
    this.emitState();
  }

  private emitState(): void {
    const u: ConnectionUpdate = {
      state: this.state,
      sessionId: this.state === "connected" ? (this.current?.sessionId ?? null) : null,
      reconnects: this.reconnects,
      error: this.error,
    };
    if (this.lastEventAt !== undefined) u.lastEventAt = this.lastEventAt;
    this.opts.handlers?.onState?.(u);
  }

  // ── sockets ──

  private open(url: string, migrating: boolean): Conn {
    const ws = new WebSocket(url);
    const conn: Conn = { ws, sessionId: null, migrating, watchdog: null, keepaliveMs: 0 };
    if (migrating) this.pending = conn;
    else this.current = conn;
    this.arm(conn, this.welcomeTimeout);

    ws.on("message", (data) => this.onFrame(conn, data.toString()));
    ws.on("error", (err) => this.log(`socket error: ${err.message}`));
    ws.on("close", (code, reason) => this.onClose(conn, code, reason.toString()));
    return conn;
  }

  private arm(conn: Conn, ms: number): void {
    if (conn.watchdog) this.timers.clearTimeout(conn.watchdog);
    conn.watchdog = this.timers.setTimeout(() => {
      conn.watchdog = null;
      if (this.stopped) return;
      this.log(`no message for ${ms}ms, reconnecting`);
      this.dropAndReconnect(conn, "keepalive timeout");
    }, ms);
  }

  private dispose(conn: Conn, code = 1000): void {
    if (conn.watchdog) this.timers.clearTimeout(conn.watchdog);
    conn.watchdog = null;
    conn.ws.removeAllListeners("message");
    conn.ws.removeAllListeners("close");
    conn.ws.on("error", () => {});
    try {
      if (conn.ws.readyState === WebSocket.CONNECTING) conn.ws.terminate();
      else conn.ws.close(code);
    } catch {
      conn.ws.terminate();
    }
  }

  private dropAndReconnect(conn: Conn, why: string): void {
    if (conn === this.pending) {
      // The migration target failed; keep using the old socket if it is alive.
      this.dispose(conn);
      this.pending = null;
      if (this.current) return;
    } else if (conn === this.current) {
      this.dispose(conn);
      this.current = null;
      if (this.pending) this.dispose(this.pending);
      this.pending = null;
    } else {
      this.dispose(conn);
      return;
    }
    this.scheduleReconnect(why);
  }

  private onClose(conn: Conn, code: number, reason: string): void {
    if (this.stopped) return;
    const why = CLOSE_REASONS[code] ?? (reason || `closed (${code})`);
    this.log(`socket closed ${code}: ${why}`);
    if (conn.watchdog) this.timers.clearTimeout(conn.watchdog);
    conn.watchdog = null;
    if (conn === this.current && this.pending) {
      // Twitch closes the old socket after the reconnect handshake; the new one takes over.
      this.current = null;
      return;
    }
    this.dropAndReconnect(conn, why);
  }

  private scheduleReconnect(why: string): void {
    if (this.stopped || this.backoffTimer) return;
    this.subscriptionIds.clear();
    const exp = Math.min(this.max, this.base * 2 ** this.attempt);
    const delay = Math.round(exp / 2 + this.random() * (exp / 2));
    this.attempt++;
    this.reconnects++;
    this.setState("reconnecting", why);
    this.backoffTimer = this.timers.setTimeout(() => {
      this.backoffTimer = null;
      if (this.stopped) return;
      this.open(this.opts.url, false);
    }, delay);
  }

  // ── frames ──

  private onFrame(conn: Conn, raw: string): void {
    let msg: EventSubFrame;
    try {
      msg = JSON.parse(raw) as EventSubFrame;
    } catch {
      return;
    }
    if (!msg?.metadata?.message_type) return;
    if (conn !== this.current && conn !== this.pending) return;
    if (conn.keepaliveMs) this.arm(conn, conn.keepaliveMs);

    switch (msg.metadata.message_type) {
      case "session_welcome":
        return this.onWelcome(conn, msg);
      case "session_keepalive":
        return;
      case "session_reconnect": {
        const url = msg.payload.session?.reconnect_url;
        if (url && conn === this.current && !this.pending) {
          this.log("reconnect requested by Twitch");
          this.open(url, true);
        }
        return;
      }
      case "notification":
        return this.onNotification(msg);
      case "revocation":
        return this.onRevocation(msg);
    }
  }

  private onWelcome(conn: Conn, msg: EventSubFrame): void {
    const s = msg.payload.session;
    if (!s?.id) return;
    conn.sessionId = s.id;
    conn.keepaliveMs = (s.keepalive_timeout_seconds ?? 10) * 1000 + this.grace;
    this.arm(conn, conn.keepaliveMs);

    if (conn.migrating) {
      const old = this.current;
      this.current = conn;
      this.pending = null;
      conn.migrating = false;
      if (old) this.dispose(old);
      this.reconnects++;
      this.setState("connected", null);
      return;
    }
    void this.subscribe(conn);
  }

  private async subscribe(conn: Conn): Promise<void> {
    const sessionId = conn.sessionId!;
    try {
      const sub = await this.opts.api.createEventSubSubscription(
        CHAT_SUBSCRIPTION.type,
        CHAT_SUBSCRIPTION.version,
        { broadcaster_user_id: this.opts.broadcasterUserId, user_id: this.opts.userId },
        sessionId,
      );
      if (conn !== this.current || this.stopped) return;
      this.subscriptionIds.add(sub.id);
      this.attempt = 0;
      this.setState("connected", null);
    } catch (err) {
      if (conn !== this.current || this.stopped) return;
      const e = err as Error;
      this.log(`subscribe failed: ${e.message}`);
      if (err instanceof HelixError && (err.status === 401 || err.status === 403)) {
        // Auth/scope problems will not fix themselves by retrying.
        this.dispose(conn);
        this.current = null;
        this.setState("error", `Chat subscription refused: ${e.message}`);
        return;
      }
      this.dropAndReconnect(conn, `subscription failed: ${e.message}`);
    }
  }

  private isDuplicateOrStale(meta: EventSubMetadata): boolean {
    const now = this.now();
    const ts = Date.parse(meta.message_timestamp);
    if (Number.isFinite(ts) && now - ts > MAX_MESSAGE_AGE_MS) return true;
    for (const [id, at] of this.seen) {
      if (now - at <= DEDUPE_TTL_MS && this.seen.size <= DEDUPE_MAX) break;
      this.seen.delete(id);
    }
    if (this.seen.has(meta.message_id)) return true;
    this.seen.set(meta.message_id, now);
    return false;
  }

  private onNotification(msg: EventSubFrame): void {
    const meta = msg.metadata;
    if (this.isDuplicateOrStale(meta)) return;
    this.lastEventAt = this.now();
    const type = meta.subscription_type ?? msg.payload.subscription?.type ?? "";
    this.opts.handlers?.onNotification?.(type, msg.payload.event, meta);
    if (type === CHAT_SUBSCRIPTION.type && msg.payload.event) {
      this.opts.handlers?.onChatMessage?.(msg.payload.event as ChatMessageEvent, meta);
    }
    this.emitState();
  }

  private onRevocation(msg: EventSubFrame): void {
    const sub = msg.payload.subscription;
    if (!sub) return;
    this.subscriptionIds.delete(sub.id);
    this.opts.handlers?.onRevocation?.(sub);
    const reason = sub.status;
    this.setState("error", `Subscription ${sub.type} revoked: ${reason}`);
    const final = reason === "authorization_revoked" || reason === "user_removed";
    if (!final && !this.resubscribedAfterRevocation.has(sub.type) && this.current?.sessionId) {
      this.resubscribedAfterRevocation.add(sub.type);
      void this.subscribe(this.current);
    }
  }
}
