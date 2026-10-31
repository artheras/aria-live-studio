import { useEffect, useRef, useState } from "react";
import type { ClientRole, LiveState, ServerMessage } from "@aria-live/shared";

export type LiveStatus = "connecting" | "open" | "reconnecting" | "offline";

export interface LiveResult {
  state: LiveState | null;
  status: LiveStatus;
  /** serverTime - Date.now() from the last hello, for countdowns. */
  clockOffset: number;
  /** Consecutive failed attempts since the last good connection. */
  attempts: number;
}

export interface UseLiveOptions {
  /** Overlay key (role=overlay only). */
  key?: string | null;
  /** Set false to keep the socket closed (e.g. not signed in yet). */
  enabled?: boolean;
  /** Injected for tests. */
  WebSocketImpl?: typeof WebSocket;
  /** Override the base URL (defaults to same origin /ws). */
  url?: string;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Called once when we've failed this many times without ever getting a snapshot. */
  onNeverConnected?: () => void;
}

export function backoffDelay(attempt: number, base = 500, max = 15_000, rand: () => number = Math.random): number {
  const exp = Math.min(max, base * 2 ** Math.max(0, attempt - 1));
  // ±20% jitter so many overlays don't reconnect in lockstep after a server restart.
  return Math.round(exp * (0.8 + rand() * 0.4));
}

export function liveUrl(role: ClientRole, key?: string | null, base?: string): string {
  let root = base;
  if (!root) {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    root = `${proto}//${window.location.host}/ws`;
  }
  const params = new URLSearchParams({ role });
  if (role === "overlay" && key) params.set("key", key);
  return `${root}?${params.toString()}`;
}

function parseMessage(data: unknown): ServerMessage | null {
  if (typeof data !== "string") return null;
  try {
    const msg = JSON.parse(data) as unknown;
    if (typeof msg !== "object" || msg === null || !("type" in msg)) return null;
    return msg as ServerMessage;
  } catch {
    return null;
  }
}

/**
 * Subscribe to the server's live snapshots. Reconnects forever with
 * exponential backoff; ignores message types it does not know (pings,
 * future additions) so heartbeats never break it.
 */
export function useLive(role: ClientRole, options: UseLiveOptions = {}): LiveResult {
  const { key = null, enabled = true, url, baseDelayMs = 500, maxDelayMs = 15_000 } = options;
  const [state, setState] = useState<LiveState | null>(null);
  const [status, setStatus] = useState<LiveStatus>(enabled ? "connecting" : "offline");
  const [clockOffset, setClockOffset] = useState(0);
  const [attempts, setAttempts] = useState(0);

  // Keep latest callbacks/impl without re-running the effect.
  const implRef = useRef(options.WebSocketImpl);
  implRef.current = options.WebSocketImpl;
  const neverRef = useRef(options.onNeverConnected);
  neverRef.current = options.onNeverConnected;

  useEffect(() => {
    if (!enabled) {
      setStatus("offline");
      return;
    }
    const Impl = implRef.current ?? (typeof WebSocket !== "undefined" ? WebSocket : undefined);
    if (!Impl) {
      setStatus("offline");
      return;
    }

    let socket: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;
    let failures = 0;
    let everReceived = false;
    let warned = false;

    const schedule = () => {
      if (disposed || timer) return;
      failures += 1;
      setAttempts(failures);
      setStatus("reconnecting");
      if (!everReceived && failures >= 3 && !warned) {
        warned = true;
        neverRef.current?.();
      }
      timer = setTimeout(() => {
        timer = null;
        connect();
      }, backoffDelay(failures, baseDelayMs, maxDelayMs));
    };

    const connect = () => {
      if (disposed) return;
      let ws: WebSocket;
      try {
        ws = new Impl(liveUrl(role, key, url));
      } catch {
        schedule();
        return;
      }
      socket = ws;
      ws.onopen = () => {
        if (disposed || socket !== ws) return;
        setStatus("open");
      };
      ws.onmessage = (ev: MessageEvent) => {
        if (disposed || socket !== ws) return;
        const msg = parseMessage(ev.data);
        if (!msg) return;
        if (msg.type === "hello") {
          if (typeof msg.serverTime === "number") setClockOffset(msg.serverTime - Date.now());
          setStatus("open");
        } else if (msg.type === "snapshot" && msg.state) {
          everReceived = true;
          failures = 0;
          setAttempts(0);
          setStatus("open");
          setState(msg.state);
        }
        // Anything else (ping, unknown) is ignored on purpose.
      };
      ws.onerror = () => {
        // onclose follows; nothing to do here.
      };
      ws.onclose = () => {
        if (disposed || socket !== ws) return;
        socket = null;
        schedule();
      };
    };

    const kick = () => {
      // Network came back or tab became visible: retry now instead of waiting.
      if (disposed || socket) return;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      connect();
    };

    setStatus("connecting");
    connect();
    window.addEventListener("online", kick);

    return () => {
      disposed = true;
      window.removeEventListener("online", kick);
      if (timer) clearTimeout(timer);
      if (socket) {
        const s = socket;
        socket = null;
        s.onopen = s.onmessage = s.onerror = s.onclose = null;
        try {
          s.close();
        } catch {
          /* ignore */
        }
      }
    };
  }, [role, key, enabled, url, baseDelayMs, maxDelayMs]);

  return { state, status, clockOffset, attempts };
}
