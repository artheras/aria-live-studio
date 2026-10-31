import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, type Config } from "../src/config.ts";
import type { ExecutionHooks, ExecutionResult, Executor, PlanInput, PlannedTask, Planner } from "../src/contracts.ts";
import { createApp, type App } from "../src/http/server.ts";
import { LiveService } from "../src/live/service.ts";
import { Store } from "../src/live/store.ts";
import { TwitchAuth } from "../src/twitch/auth.ts";
import { HelixClient } from "../src/twitch/helix.ts";
import { plan } from "./helpers.ts";

export const PUBLIC_URL = "http://localhost:3999";

export interface FetchCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
}

export class FakeTwitch {
  calls: FetchCall[] = [];
  login = "streamer";
  scopes = ["user:read:chat", "user:write:chat"];
  validateStatus = 200;
  fetch = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const url = String(input);
    const headers = Object.fromEntries(new Headers(init.headers).entries());
    const body = typeof init.body === "string" ? init.body : "";
    this.calls.push({ url, method: init.method ?? "GET", headers, body });
    const json = (status: number, b: unknown) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
    if (url.endsWith("/oauth2/token")) {
      return json(200, { access_token: `at-${this.calls.length}`, refresh_token: "rt", expires_in: 14000, scope: this.scopes, token_type: "bearer" });
    }
    if (url.endsWith("/oauth2/validate")) {
      if (this.validateStatus !== 200) return json(this.validateStatus, { status: 401, message: "invalid access token" });
      return json(200, { client_id: "cid", login: this.login, scopes: this.scopes, user_id: "1337", expires_in: 14000 });
    }
    if (url.endsWith("/oauth2/revoke")) return new Response(null, { status: 200 });
    if (url.includes("/helix/users")) return json(200, { data: [{ id: "1337", login: this.login, display_name: "StreamerName" }] });
    if (url.endsWith("/helix/chat/messages")) return json(200, { data: [{ message_id: `sent-${this.calls.length}`, is_sent: true, drop_reason: null }] });
    return json(404, { message: "not found" });
  };
  chatMessages(): string[] {
    return this.calls.filter((c) => c.url.endsWith("/chat/messages")).map((c) => (JSON.parse(c.body) as { message: string }).message);
  }
}

export class FakePlanner implements Planner {
  name = "fake";
  fail: Error | null = null;
  delayMs = 0;
  inputs: PlanInput[] = [];
  async plan(input: PlanInput): Promise<PlannedTask> {
    this.inputs.push(input);
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
    if (this.fail) throw this.fail;
    return { ...plan };
  }
}

export class FakeExecutor implements Executor {
  name = "fake-exec";
  ok = true;
  release: ((r: ExecutionResult) => void) | null = null;
  hooks: ExecutionHooks | null = null;
  async check() {
    return this.ok ? { ok: true } : { ok: false, reason: "not installed" };
  }
  run(_task: unknown, hooks: ExecutionHooks): Promise<ExecutionResult> {
    this.hooks = hooks;
    hooks.onStep({ at: Date.now(), kind: "status", text: "starting in /secret/workdir" });
    return new Promise((resolve) => {
      this.release = resolve;
      hooks.signal.addEventListener("abort", () =>
        resolve({ status: "cancelled", branch: null, workdir: null, changedFiles: [], summary: null, error: "cancelled" }),
      );
    });
  }
}

export interface Harness {
  config: Config;
  app: App;
  service: LiveService;
  auth: TwitchAuth;
  twitch: FakeTwitch;
  planner: FakePlanner;
  executor: FakeExecutor;
  base: string;
  dir: string;
  cookie: string;
  csrf: string;
  /** fetch with session cookie + csrf + JSON */
  api(method: string, path: string, body?: unknown, extra?: Record<string, string>): Promise<Response>;
  agent(method: string, path: string, body?: unknown, token?: string): Promise<Response>;
  loginFlow(): Promise<void>;
  close(): Promise<void>;
}

export async function startHarness(env: Record<string, string> = {}, opts: { webDist?: string; login?: boolean } = {}): Promise<Harness> {
  const dir = mkdtempSync(join(tmpdir(), "aria-live-test-"));
  const config = loadConfig({
    DATA_DIR: dir,
    PUBLIC_URL,
    WEB_DEV_URL: "http://localhost:5173",
    TWITCH_CLIENT_ID: "cid",
    TWITCH_CLIENT_SECRET: "csecret",
    TWITCH_AUTH_BASE: "http://twitch.test/oauth2",
    TWITCH_API_BASE: "http://twitch.test/helix",
    ...env,
  });
  const twitch = new FakeTwitch();
  const auth = new TwitchAuth(config, { fetch: twitch.fetch as typeof fetch });
  const helix = new HelixClient(config.twitch.apiBase, auth, { fetch: twitch.fetch as typeof fetch });
  const store = new Store(dir, 10);
  const planner = new FakePlanner();
  const executor = new FakeExecutor();
  const service = new LiveService({
    config: { ...config, executor: { ...config.executor, kind: "aria-code" } },
    store,
    auth,
    helix,
    planner,
    executor,
    createEventSub: () => null,
    voteReplyDelayMs: 20,
  });
  const app = createApp({ config, auth, service, store, webDist: opts.webDist });
  const port = await app.listen(0, "127.0.0.1");
  const base = `http://127.0.0.1:${port}`;

  const h: Harness = {
    config,
    app,
    service,
    auth,
    twitch,
    planner,
    executor,
    base,
    dir,
    cookie: "",
    csrf: "",
    api(method, path, body, extra = {}) {
      return fetch(`${base}${path}`, {
        method,
        headers: {
          cookie: h.cookie,
          "x-aria-csrf": h.csrf,
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
          ...extra,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    },
    agent(method, path, body, token = config.agentToken) {
      return fetch(`${base}${path}`, {
        method,
        headers: {
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    },
    async loginFlow() {
      const r1 = await fetch(`${base}/auth/twitch/login`, { redirect: "manual" });
      const loc = new URL(r1.headers.get("location")!);
      const state = loc.searchParams.get("state")!;
      const r2 = await fetch(`${base}/auth/twitch/callback?code=abc&state=${state}&scope=user%3Aread%3Achat`, { redirect: "manual" });
      if (r2.status !== 302) throw new Error(`login failed ${r2.status} ${await r2.text()}`);
      h.cookie = r2.headers.get("set-cookie")!.split(";")[0]!;
      const me = (await (await fetch(`${base}/api/me`, { headers: { cookie: h.cookie } })).json()) as { csrf: string };
      h.csrf = me.csrf;
    },
    async close() {
      await service.stop();
      await app.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
  service.start();
  if (opts.login !== false) await h.loginFlow();
  return h;
}

export async function waitFor(cond: () => boolean | Promise<boolean>, ms = 3000): Promise<void> {
  const start = Date.now();
  while (!(await cond())) {
    if (Date.now() - start > ms) throw new Error("timeout waiting for condition");
    await new Promise((r) => setTimeout(r, 10));
  }
}
