import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer, type WebSocket } from "ws";
import type { AddressInfo } from "node:net";
import { EventSubClient, type ConnectionUpdate } from "../src/twitch/eventsub.ts";
import type { EventSubApi } from "../src/twitch/helix.ts";
import { HelixError } from "../src/twitch/helix.ts";
import type { ChatMessageEvent } from "../src/live/commands.ts";
import { chatEvent } from "./helpers.ts";

async function waitFor(cond: () => boolean, ms = 3000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error("timeout waiting for condition");
    await new Promise((r) => setTimeout(r, 10));
  }
}

let msgSeq = 0;
const meta = (type: string, extra: Record<string, string> = {}, ts = new Date().toISOString()) => ({
  message_id: `m-${++msgSeq}`,
  message_type: type,
  message_timestamp: ts,
  ...extra,
});

function welcome(id: string, keepalive = 10) {
  return {
    metadata: meta("session_welcome"),
    payload: { session: { id, status: "connected", connected_at: new Date().toISOString(), keepalive_timeout_seconds: keepalive, reconnect_url: null, recovery_url: null } },
  };
}

const subscription = (status = "enabled") => ({
  id: "sub-1",
  status,
  type: "channel.chat.message",
  version: "1",
  cost: 0,
  condition: { broadcaster_user_id: "1337", user_id: "1337" },
  transport: { method: "websocket", session_id: "s1" },
  created_at: new Date().toISOString(),
});

function notification(text: string, messageId?: string, ts?: string) {
  const m = meta("notification", { subscription_type: "channel.chat.message", subscription_version: "1" }, ts);
  if (messageId) m.message_id = messageId;
  return { metadata: m, payload: { subscription: subscription(), event: chatEvent(text) } };
}

class MockEventSub {
  wss!: WebSocketServer;
  conns: { ws: WebSocket; url: string; closed: boolean; closeCode?: number }[] = [];
  port = 0;
  /** If set, auto-send welcome with this keepalive on each new connection. */
  autoWelcome: number | null = 10;
  sessionSeq = 0;

  async start() {
    this.wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
    await new Promise((r) => this.wss.once("listening", r));
    this.port = (this.wss.address() as AddressInfo).port;
    this.wss.on("connection", (ws, req) => {
      const c = { ws, url: req.url ?? "", closed: false } as MockEventSub["conns"][number];
      this.conns.push(c);
      ws.on("close", (code) => {
        c.closed = true;
        c.closeCode = code;
      });
      if (this.autoWelcome !== null && !c.url.includes("reconnect")) {
        ws.send(JSON.stringify(welcome(`session-${++this.sessionSeq}`, this.autoWelcome)));
      }
    });
  }
  get url() {
    return `ws://127.0.0.1:${this.port}/ws`;
  }
  send(i: number, msg: unknown) {
    this.conns[i]!.ws.send(JSON.stringify(msg));
  }
  async stop() {
    for (const c of this.conns) c.ws.terminate();
    await new Promise((r) => this.wss.close(r));
  }
}

class FakeHelix implements EventSubApi {
  calls: { type: string; version: string; condition: Record<string, string>; sessionId: string; body: unknown }[] = [];
  fail: Error | null = null;
  async createEventSubSubscription(type: string, version: string, condition: Record<string, string>, sessionId: string) {
    const body = { type, version, condition, transport: { method: "websocket", session_id: sessionId } };
    this.calls.push({ type, version, condition, sessionId, body });
    if (this.fail) throw this.fail;
    return { id: `sub-${this.calls.length}`, status: "enabled", type, version, condition };
  }
  async deleteEventSubSubscription() {}
}

let server: MockEventSub;
let client: EventSubClient | null = null;

function makeClient(helix: FakeHelix, extra: Partial<ConstructorParameters<typeof EventSubClient>[0]> = {}) {
  const chats: ChatMessageEvent[] = [];
  const states: ConnectionUpdate[] = [];
  client = new EventSubClient({
    url: server.url,
    api: helix,
    broadcasterUserId: "1337",
    userId: "1337",
    backoffBaseMs: 20,
    backoffMaxMs: 100,
    watchdogGraceMs: 200,
    log: () => {},
    handlers: { onChatMessage: (e) => chats.push(e), onState: (s) => states.push(s) },
    ...extra,
  });
  return { client, chats, states };
}

afterEach(async () => {
  client?.stop();
  client = null;
  await server?.stop();
});

describe("EventSub WebSocket client", () => {
  it("subscribes on welcome with the documented request body and delivers chat (deduped)", async () => {
    server = new MockEventSub();
    await server.start();
    const helix = new FakeHelix();
    const { client, chats, states } = makeClient(helix);
    client.start();
    await waitFor(() => client.connectionState === "connected");
    expect(helix.calls).toHaveLength(1);
    expect(helix.calls[0]!.body).toEqual({
      type: "channel.chat.message",
      version: "1",
      condition: { broadcaster_user_id: "1337", user_id: "1337" },
      transport: { method: "websocket", session_id: "session-1" },
    });
    expect(states.at(-1)).toMatchObject({ state: "connected", sessionId: "session-1" });

    server.send(0, { metadata: meta("session_keepalive"), payload: {} });
    const n = notification("!idea dark mode", "dup-1");
    server.send(0, n);
    server.send(0, n); // duplicate delivery
    server.send(0, notification("!idea old", undefined, new Date(Date.now() - 11 * 60_000).toISOString())); // stale
    server.send(0, notification("!vote 1"));
    await waitFor(() => chats.length >= 2);
    await new Promise((r) => setTimeout(r, 50));
    expect(chats.map((c) => c.message.text)).toEqual(["!idea dark mode", "!vote 1"]);
    expect(states.at(-1)!.lastEventAt).toBeTypeOf("number");
  });

  it("follows session_reconnect without resubscribing and closes the old socket after the new welcome", async () => {
    server = new MockEventSub();
    await server.start();
    const helix = new FakeHelix();
    const { client, chats } = makeClient(helix);
    client.start();
    await waitFor(() => client.connectionState === "connected");
    server.send(0, {
      metadata: meta("session_reconnect"),
      payload: { session: { id: "session-1", status: "reconnecting", keepalive_timeout_seconds: null, reconnect_url: `${server.url}?reconnect=1`, connected_at: "" } },
    });
    await waitFor(() => server.conns.length === 2);
    expect(server.conns[1]!.url).toContain("reconnect=1");
    // old socket still open until the new welcome
    await new Promise((r) => setTimeout(r, 50));
    expect(server.conns[0]!.closed).toBe(false);
    server.send(0, notification("!idea still on old"));
    await waitFor(() => chats.length === 1);
    server.send(1, welcome("session-1"));
    await waitFor(() => server.conns[0]!.closed);
    expect(client.sessionId).toBe("session-1");
    expect(helix.calls).toHaveLength(1);
    server.send(1, notification("!idea on new"));
    await waitFor(() => chats.length === 2);
  });

  it("reconnects with a fresh session and resubscribes when keepalives stop", async () => {
    server = new MockEventSub();
    server.autoWelcome = 1; // keepalive_timeout_seconds = 1 (+200ms grace)
    await server.start();
    const helix = new FakeHelix();
    const { client, states } = makeClient(helix);
    client.start();
    await waitFor(() => client.connectionState === "connected");
    // send nothing → watchdog fires after ~1.2s
    await waitFor(() => server.conns.length >= 2, 4000);
    await waitFor(() => helix.calls.length >= 2, 2000);
    expect(helix.calls[1]!.sessionId).toBe("session-2");
    expect(states.some((s) => s.state === "reconnecting" && s.error === "keepalive timeout")).toBe(true);
    expect(server.conns[0]!.closed).toBe(true);
  });

  it("reconnects with backoff after a 4003 close", async () => {
    server = new MockEventSub();
    await server.start();
    const helix = new FakeHelix();
    const { client, states } = makeClient(helix);
    client.start();
    await waitFor(() => client.connectionState === "connected");
    server.conns[0]!.ws.close(4003, "connection unused");
    await waitFor(() => helix.calls.length === 2);
    expect(states.find((s) => s.state === "reconnecting")).toMatchObject({ reconnects: 1, error: expect.stringMatching(/unused/) });
    await waitFor(() => client.connectionState === "connected");
  });

  it("revocation: resubscribes once unless authorization was revoked", async () => {
    server = new MockEventSub();
    await server.start();
    const helix = new FakeHelix();
    const { client, states } = makeClient(helix);
    client.start();
    await waitFor(() => client.connectionState === "connected");
    server.send(0, { metadata: meta("revocation", { subscription_type: "channel.chat.message", subscription_version: "1" }), payload: { subscription: subscription("version_removed") } });
    await waitFor(() => helix.calls.length === 2);
    await waitFor(() => client.connectionState === "connected");

    server.send(0, { metadata: meta("revocation", { subscription_type: "channel.chat.message", subscription_version: "1" }), payload: { subscription: subscription("authorization_revoked") } });
    await waitFor(() => client.connectionState === "error");
    await new Promise((r) => setTimeout(r, 50));
    expect(helix.calls).toHaveLength(2);
    expect(states.at(-1)!.error).toMatch(/authorization_revoked/);
  });

  it("does not loop on a 403 subscription error", async () => {
    server = new MockEventSub();
    await server.start();
    const helix = new FakeHelix();
    helix.fail = new HelixError(403, "missing scope");
    const { client } = makeClient(helix);
    client.start();
    await waitFor(() => client.connectionState === "error");
    await new Promise((r) => setTimeout(r, 100));
    expect(helix.calls).toHaveLength(1);
  });
});
