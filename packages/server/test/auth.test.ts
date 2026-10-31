import { afterEach, describe, expect, it } from "vitest";
import { OAuthStateStore, parseCookies, signValue, unsignValue } from "../src/twitch/auth.ts";
import { startHarness, type Harness } from "./harness.ts";

let h: Harness | null = null;
afterEach(async () => {
  await h?.close();
  h = null;
});

describe("cookie signing", () => {
  it("round-trips and rejects tampering", () => {
    const s = signValue("session-abc", "secret");
    expect(unsignValue(s, "secret")).toBe("session-abc");
    expect(unsignValue(s, "other-secret")).toBeNull();
    expect(unsignValue(s.replace("abc", "abd"), "secret")).toBeNull();
    expect(unsignValue("no-dot", "secret")).toBeNull();
    expect(parseCookies("a=1; aria_session=x%2Ey; b")).toEqual({ a: "1", aria_session: "x.y" });
  });
});

describe("OAuth state", () => {
  it("is single use and expires after 10 minutes", () => {
    let now = 0;
    const store = new OAuthStateStore(() => now);
    const s = store.create();
    expect(store.consume(s)).toBe(true);
    expect(store.consume(s)).toBe(false);
    const s2 = store.create();
    now += 10 * 60 * 1000 + 1;
    expect(store.consume(s2)).toBe(false);
    expect(store.consume("made-up")).toBe(false);
    expect(store.consume(null)).toBe(false);
  });
});

describe("Twitch login flow", () => {
  it("redirects to authorize with the right params", async () => {
    h = await startHarness({}, { login: false });
    const r = await fetch(`${h.base}/auth/twitch/login`, { redirect: "manual" });
    expect(r.status).toBe(302);
    const u = new URL(r.headers.get("location")!);
    expect(u.origin + u.pathname).toBe("http://twitch.test/oauth2/authorize");
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("client_id")).toBe("cid");
    expect(u.searchParams.get("redirect_uri")).toBe("http://localhost:3999/auth/twitch/callback");
    expect(u.searchParams.get("scope")).toBe("user:read:chat user:write:chat");
    expect(u.searchParams.get("state")!.length).toBeGreaterThan(20);
  });

  it("rejects a callback with an unknown state and accepts a state only once", async () => {
    h = await startHarness({}, { login: false });
    const bad = await fetch(`${h.base}/auth/twitch/callback?code=x&state=nope`, { redirect: "manual" });
    expect(bad.status).toBe(400);
    const r1 = await fetch(`${h.base}/auth/twitch/login`, { redirect: "manual" });
    const state = new URL(r1.headers.get("location")!).searchParams.get("state")!;
    const ok = await fetch(`${h.base}/auth/twitch/callback?code=x&state=${state}`, { redirect: "manual" });
    expect(ok.status).toBe(302);
    expect(ok.headers.get("location")).toBe("http://localhost:5173/");
    const cookie = ok.headers.get("set-cookie")!;
    expect(cookie).toMatch(/^aria_session=/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).not.toMatch(/Secure/);
    const again = await fetch(`${h.base}/auth/twitch/callback?code=x&state=${state}`, { redirect: "manual" });
    expect(again.status).toBe(400);
    // token exchange was a form POST with the code
    const tokenCall = h.twitch.calls.find((c) => c.url.endsWith("/token"))!;
    expect(tokenCall.method).toBe("POST");
    expect(new URLSearchParams(tokenCall.body).get("grant_type")).toBe("authorization_code");
    expect(new URLSearchParams(tokenCall.body).get("code")).toBe("x");
  });

  it("returns the user, csrf and the broadcaster connection after login", async () => {
    h = await startHarness();
    const me = (await (await h.api("GET", "/api/me")).json()) as Record<string, unknown>;
    expect(me.user).toEqual({ id: "1337", login: "streamer", displayName: "StreamerName" });
    expect(me.configured).toBe(true);
    expect(typeof me.csrf).toBe("string");
    expect(h.service.engine.state.connection).toMatchObject({ channel: { id: "1337" }, canReply: true });
  });

  it("rejects logins outside ALLOWED_LOGINS with 403", async () => {
    h = await startHarness({ ALLOWED_LOGINS: "someoneelse, other" }, { login: false });
    await expect(h.loginFlow()).rejects.toThrow(/403/);
    expect(h.auth.user).toBeNull();
  });

  it("refuses a tampered cookie", async () => {
    h = await startHarness();
    const r = await fetch(`${h.base}/api/state`, { headers: { cookie: h.cookie.slice(0, -2) + "xx" } });
    expect(r.status).toBe(401);
  });

  it("stays logged in across restarts (tokens persisted with sessions)", async () => {
    h = await startHarness();
    const { TwitchAuth } = await import("../src/twitch/auth.ts");
    const again = new TwitchAuth(h.config, { fetch: h.twitch.fetch as typeof fetch });
    expect(again.user?.login).toBe("streamer");
    expect(again.sessionFromCookie(h.cookie)?.csrf).toBe(h.csrf);
  });

  it("logout requires csrf, clears the session and revokes the token", async () => {
    h = await startHarness();
    expect((await fetch(`${h.base}/auth/logout`, { method: "POST", headers: { cookie: h.cookie } })).status).toBe(403);
    const r = await h.api("POST", "/auth/logout");
    expect(r.status).toBe(200);
    expect(h.twitch.calls.some((c) => c.url.endsWith("/revoke"))).toBe(true);
    expect((await h.api("GET", "/api/state")).status).toBe(401);
    expect(h.service.engine.state.connection.state).toBe("signed_out");
  });

  it("shows not configured without Twitch credentials and does not crash", async () => {
    h = await startHarness({ TWITCH_CLIENT_ID: "", TWITCH_CLIENT_SECRET: "" }, { login: false });
    const me = (await (await fetch(`${h.base}/api/me`)).json()) as Record<string, unknown>;
    expect(me).toMatchObject({ configured: false, user: null });
    const r = await fetch(`${h.base}/auth/twitch/login`, { redirect: "manual" });
    expect(r.status).toBe(503);
  });

  it("refreshes once on 401 then retries the Helix call", async () => {
    h = await startHarness();
    const { HelixClient } = await import("../src/twitch/helix.ts");
    let n = 0;
    const f = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/helix/users")) {
        n++;
        if (n === 1) return new Response("{}", { status: 401 });
        expect(new Headers(init?.headers).get("authorization")).toMatch(/^Bearer at-/);
        return new Response(JSON.stringify({ data: [{ id: "1", login: "x", display_name: "X" }] }), { status: 200 });
      }
      return h!.twitch.fetch(input, init);
    }) as typeof fetch;
    const helix = new HelixClient(h.config.twitch.apiBase, h.auth, { fetch: f });
    const before = h.twitch.calls.filter((c) => c.url.endsWith("/token")).length;
    const users = await helix.getUsers({ ids: ["1"] });
    expect(users[0]!.login).toBe("x");
    expect(n).toBe(2);
    expect(h.twitch.calls.filter((c) => c.url.endsWith("/token")).length).toBe(before + 1);
  });
});
