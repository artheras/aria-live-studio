import { afterEach, describe, expect, it } from "vitest";
import { TwitchAuth } from "../src/twitch/auth.ts";
import { startHarness, type Harness } from "./harness.ts";

let h: Harness | null = null;
const auths: TwitchAuth[] = [];
afterEach(async () => {
  for (const auth of auths.splice(0)) auth.stopValidation();
  await h?.close();
  h = null;
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

async function login(auth: TwitchAuth) {
  const state = new URL(auth.authorizeUrl()).searchParams.get("state")!;
  return auth.completeLogin(new URLSearchParams({ state, code: "test-code" }));
}

async function setup(block: "refresh" | "validate", nextRefresh?: Promise<Response>) {
  h = await startHarness();
  const twitch = h.twitch;
  const pending = deferred<Response>();
  let blocked = false;
  const auth = new TwitchAuth(h.config, { fetch: (async (input, init) => {
    const url = String(input);
    const refresh = url.endsWith("/token") && new URLSearchParams(String(init?.body)).get("grant_type") === "refresh_token";
    if (!blocked && (block === "refresh" ? refresh : url.endsWith("/validate"))) {
      blocked = true;
      return pending.promise;
    }
    if (refresh && nextRefresh) return nextRefresh;
    return twitch.fetch(input, init);
  }) as typeof fetch });
  auths.push(auth);
  return { auth, pending, twitch };
}

const token = () => new Response(JSON.stringify({ access_token: "old-refresh-token", refresh_token: "old-rt", expires_in: 100, scope: ["old-scope"] }));

describe("Twitch session isolation", () => {
  it.each([200, 401])("discards an old refresh response (%i) after login changes", async (status) => {
    const { auth, pending } = await setup("refresh");
    const old = auth.refresh().catch((err: unknown) => err);
    const session = await login(auth);
    const current = await auth.getAccessToken();
    pending.resolve(status === 200 ? token() : new Response("revoked", { status }));
    expect(await old).toBeInstanceOf(Error);
    expect(auth.user).toEqual(session.user);
    expect(await auth.getAccessToken()).toBe(current);
    expect(auth.scopes).not.toContain("old-scope");
    // Persistence must also retain the new credentials.
    const reloaded = new TwitchAuth(h!.config);
    expect(await reloaded.getAccessToken()).toBe(current);
  });

  it("shares refreshes only within the same login, without clearing the new flight", async () => {
    const next = deferred<Response>();
    const { auth, pending } = await setup("refresh", next.promise);
    const old = auth.refresh().catch((err: unknown) => err);
    await login(auth);
    const current = auth.refresh();
    expect(auth.refresh()).toBe(current);
    pending.resolve(token());
    expect(await old).toBeInstanceOf(Error);
    expect(auth.refresh()).toBe(current);
    next.resolve(new Response(JSON.stringify({ access_token: "new-refresh-token", refresh_token: "new-rt", expires_in: 1000 })));
    expect(await current).toBe("new-refresh-token");
  });

  it("does not restore credentials after logout while refreshing", async () => {
    const { auth, pending } = await setup("refresh");
    const old = auth.refresh().catch((err: unknown) => err);
    await auth.logout();
    pending.resolve(token());
    expect(await old).toBeInstanceOf(Error);
    expect(auth.user).toBeNull();
    expect(new TwitchAuth(h!.config).user).toBeNull();
  });

  it.each([200, 401])("ignores old validation (%i) after reauthentication", async (status) => {
    const { auth, pending, twitch } = await setup("validate");
    const old = auth.validateNow();
    await login(auth);
    const before = twitch.calls.length;
    pending.resolve(new Response(JSON.stringify({ client_id: "cid", login: "old", user_id: "old-id", scopes: ["old-scope"], expires_in: 1 }), { status }));
    expect(await old).toBe(false);
    expect(auth.user?.login).toBe("streamer");
    expect(auth.scopes).not.toContain("old-scope");
    expect(twitch.calls).toHaveLength(before); // no stale refresh/revoke
  });
});
