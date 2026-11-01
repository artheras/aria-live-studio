import { describe, expect, it } from "vitest";
import { formatReport, verifyTwitch, type VerifyOptions } from "../src/twitch/verify.ts";

const ALL = ["user:read:chat", "user:write:chat", "channel:manage:broadcast", "clips:edit"];

interface Fake {
  live?: boolean;
  scopes?: string[];
  validate?: number;
  clientId?: string;
  vod?: boolean;
  offlineMarker?: { status: number; message: string };
  offlineClip?: { status: number; message: string };
  clipReadyAfter?: number;
  stickyTitle?: boolean;
}

function twitch(o: Fake = {}) {
  let title = "My stream";
  let clipPolls = 0;
  const calls: string[] = [];
  const json = (status: number, body?: unknown) =>
    new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    calls.push(`${method} ${url.pathname}`);
    if (url.pathname === "/oauth2/validate") {
      if (o.validate) return json(o.validate, { message: "invalid access token" });
      return json(200, { client_id: o.clientId ?? "cid", login: "streamer", user_id: "42", scopes: o.scopes ?? ALL, expires_in: 7200 });
    }
    const p = url.pathname.replace("/helix", "");
    if (p === "/channels" && method === "GET") return json(200, { data: [{ broadcaster_id: "42", title }] });
    if (p === "/channels" && method === "PATCH") {
      if (!o.stickyTitle || !title.startsWith("Building")) title = JSON.parse(String(init!.body)).title;
      return json(204);
    }
    if (p === "/streams") return json(200, { data: o.live ? [{ type: "live", started_at: "2026-11-01T10:00:00Z" }] : [] });
    if (p === "/videos") return json(200, { data: o.vod === false ? [] : [{ id: "1", url: "https://www.twitch.tv/videos/1", created_at: "2026-11-01T10:00:00Z", type: "archive" }] });
    if (p === "/streams/markers") {
      if (!o.live) return json(o.offlineMarker?.status ?? 404, { message: o.offlineMarker?.message ?? "user is not live" });
      return json(200, { data: [{ id: "m1", created_at: "2026-11-01T10:05:00Z", position_seconds: 300, description: "x" }] });
    }
    if (p === "/clips" && method === "POST") {
      if (!o.live) return json(o.offlineClip?.status ?? 404, { message: o.offlineClip?.message ?? "Clipping is not possible for an offline channel." });
      return json(202, { data: [{ id: "Clip1", edit_url: "https://clips.twitch.tv/Clip1/edit" }] });
    }
    if (p === "/clips" && method === "GET") {
      clipPolls++;
      return json(200, { data: clipPolls > (o.clipReadyAfter ?? 1) ? [{ id: "Clip1", url: "https://clips.twitch.tv/Clip1" }] : [] });
    }
    if (p === "/chat/messages") return json(200, { data: [{ message_id: "x", is_sent: true }] });
    return json(404, { message: "unexpected" });
  }) as typeof fetch;
  return { fetchFn, calls, title: () => title };
}

function opts(t: ReturnType<typeof twitch>, extra: Partial<VerifyOptions> = {}): VerifyOptions {
  return {
    clientId: "cid",
    accessToken: "tok",
    authBase: "http://twitch.test/oauth2",
    apiBase: "http://twitch.test/helix",
    write: false,
    chat: false,
    fetch: t.fetchFn,
    sleep: async () => {},
    clipPollMs: 0,
    ...extra,
  };
}

type Check = Awaited<ReturnType<typeof verifyTwitch>>["results"][number];
const by = (r: Awaited<ReturnType<typeof verifyTwitch>>) => Object.fromEntries(r.results.map((c) => [c.id, c])) as Record<string, Check> & Record<"token" | "scopes" | "live" | "vod" | "title" | "marker" | "clip" | "chat", Check>;

describe("verify:twitch", () => {
  it("is read-only by default", async () => {
    const t = twitch({ live: true });
    const r = by(await verifyTwitch(opts(t)));
    expect(r.token.outcome).toBe("pass");
    expect(r.scopes.outcome).toBe("pass");
    expect(r.live.outcome).toBe("pass");
    expect(r.vod.outcome).toBe("pass");
    expect(r.title.outcome).toBe("skip");
    expect(t.calls.some((c) => !c.startsWith("GET"))).toBe(false);
  });

  it("runs every write check while live and restores the title", async () => {
    const t = twitch({ live: true });
    const r = by(await verifyTwitch(opts(t, { write: true, chat: true })));
    expect(r.title.outcome).toBe("pass");
    expect(t.title()).toBe("My stream");
    expect(r.marker.outcome).toBe("pass");
    expect(r.clip).toMatchObject({ outcome: "pass", detail: expect.stringContaining("https://clips.twitch.tv/Clip1") });
    expect(r.chat.outcome).toBe("pass");
  });

  it("accepts the offline answers the studio recognizes and flags others", async () => {
    const ok = by(await verifyTwitch(opts(twitch({ live: false }), { write: true })));
    expect(ok.live.outcome).toBe("warn");
    expect(ok.marker.outcome).toBe("pass");
    expect(ok.clip.outcome).toBe("pass");

    const odd = by(
      await verifyTwitch(
        opts(twitch({ live: false, offlineMarker: { status: 403, message: "nope" }, offlineClip: { status: 400, message: "broadcaster is not live" } }), { write: true }),
      ),
    );
    expect(odd.marker).toMatchObject({ outcome: "warn", observed: { status: 403, message: "nope" } });
    expect(odd.clip).toMatchObject({ outcome: "warn", observed: { status: 400 } });
  });

  it("reports a clip Twitch never finishes", async () => {
    const r = by(await verifyTwitch(opts(twitch({ live: true, clipReadyAfter: 1e9 }), { write: true, clipWaitMs: 5 })));
    expect(r.clip.outcome).toBe("warn");
  });

  it("fails when the title does not come back", async () => {
    const r = by(await verifyTwitch(opts(twitch({ live: true, stickyTitle: true }), { write: true })));
    expect(r.title.outcome).toBe("fail");
  });

  it("skips features whose scope is missing and says how to reconnect", async () => {
    const r = by(await verifyTwitch(opts(twitch({ live: true, scopes: ["user:read:chat", "user:write:chat"] }), { write: true })));
    expect(r.scopes).toMatchObject({ outcome: "warn", detail: expect.stringContaining("Reconnect Twitch") });
    expect([r.title.outcome, r.marker.outcome, r.clip.outcome]).toEqual(["skip", "skip", "skip"]);
  });

  it("stops early without a login, with an expired token or another app's token", async () => {
    expect(by(await verifyTwitch(opts(twitch(), { accessToken: null }))).token.outcome).toBe("fail");
    expect(by(await verifyTwitch(opts(twitch({ validate: 401 })))).token.outcome).toBe("fail");
    const other = await verifyTwitch(opts(twitch({ clientId: "other" })));
    expect(other.results).toHaveLength(1);
    expect(other.results[0]!.outcome).toBe("fail");
  });

  it("warns when past broadcasts are not stored and never prints the token", async () => {
    const report = await verifyTwitch(opts(twitch({ live: true, vod: false })));
    expect(by(report).vod.outcome).toBe("warn");
    const text = formatReport(report) + JSON.stringify(report);
    expect(text).not.toContain("tok\"");
    expect(text).toContain("Store past broadcasts");
  });
});
