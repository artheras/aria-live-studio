/**
 * HTTP + WebSocket front door (node:http, no framework).
 *
 * Auth model:
 * - /api/* (except /api/agent/*): broadcaster session cookie; mutating
 *   methods also need `x-aria-csrf` and a matching Origin (if sent).
 *   GET /api/me answers without a session too, so the dashboard can show
 *   "not configured" / "log in".
 * - /api/agent/*: `Authorization: Bearer AGENT_TOKEN` only (no cookie, no csrf).
 * - /ws?role=dashboard: session cookie; /ws?role=overlay&key=OVERLAY_KEY.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import type { AddressInfo } from "node:net";
import type { ApiError, ClientRole } from "@aria-live/shared";
import { REPO_ROOT, type Config } from "../config.ts";
import { AgentError } from "../live/agent.ts";
import { choosePlanner } from "../planner/index.ts";
import { EngineError } from "../live/engine.ts";
import { ServiceError, type LiveService } from "../live/service.ts";
import type { Store } from "../live/store.ts";
import { AuthError, safeEqual, type Session, type TwitchAuth } from "../twitch/auth.ts";
import { WsHub } from "./ws.ts";

export const BODY_LIMIT = 64 * 1024;
const MAX_WAIT_SEC = 60;

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
};

const SPA_ROUTES = new Set(["/", "/overlay", "/history"]);

export interface AppDeps {
  config: Config;
  auth: TwitchAuth;
  service: LiveService;
  store: Store;
  /** Built web app to serve; skipped if missing. */
  webDist?: string;
  /** For tests: rate limit window for agent progress. */
  agentProgressPerSec?: number;
}

export interface App {
  server: Server;
  hub: WsHub;
  listen(port: number, host?: string): Promise<number>;
  close(): Promise<void>;
}

type Handler = (ctx: Ctx) => Promise<unknown> | unknown;

interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  params: Record<string, string>;
  session: Session | null;
  body: Record<string, unknown>;
}

interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  handler: Handler;
  /** "session" = dashboard (csrf on mutation); "agent" = bearer token. */
  auth: "session" | "agent" | "optional";
}

function compile(path: string): { pattern: RegExp; keys: string[] } {
  const keys: string[] = [];
  const re = path.replace(/:([a-zA-Z]+)/g, (_m, k: string) => {
    keys.push(k);
    return "([^/]+)";
  });
  return { pattern: new RegExp(`^${re}$`), keys };
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  if (res.headersSent) return;
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(data),
    "Cache-Control": "no-store",
  });
  res.end(data);
}

function sendError(res: ServerResponse, status: number, code: string, error: string): void {
  const body: ApiError = { error, code };
  sendJson(res, status, body);
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const len = Number(req.headers["content-length"] ?? 0);
  if (len > BODY_LIMIT) throw new HttpError(413, "too_large", "Request body too large");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > BODY_LIMIT) throw new HttpError(413, "too_large", "Request body too large");
    chunks.push(chunk as Buffer);
  }
  if (size === 0) return {};
  const ct = String(req.headers["content-type"] ?? "");
  if (!ct.includes("application/json")) throw new HttpError(415, "bad_content_type", "Send JSON");
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "bad_json", "Invalid JSON body");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new HttpError(400, "bad_input", "Body must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

function htmlPage(res: ServerResponse, status: number, title: string, message: string, link: string): void {
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const html = `<!doctype html><meta charset="utf-8"><title>${esc(title)}</title><body style="font-family:system-ui;padding:2rem"><h1>${esc(title)}</h1><p>${esc(message)}</p><p><a href="${esc(link)}">Back to Aria Live Studio</a></p></body>`;
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  res.end(html);
}

/** Sliding one-second window limiter. */
class PerSecond {
  private hits: number[] = [];
  constructor(private readonly max: number) {}
  take(): boolean {
    const now = Date.now();
    this.hits = this.hits.filter((t) => now - t < 1000);
    if (this.hits.length >= this.max) return false;
    this.hits.push(now);
    return true;
  }
}

export function createApp(deps: AppDeps): App {
  const { config, auth, service, store } = deps;
  const engine = service.engine;
  const appUrl = config.webDevUrl ?? config.publicUrl;
  const allowedOrigins = new Set([new URL(config.publicUrl).origin]);
  if (config.webDevUrl) allowedOrigins.add(new URL(config.webDevUrl).origin);
  const progressLimiter = new PerSecond(deps.agentProgressPerSec ?? 5);
  const webDist = deps.webDist && existsSync(join(deps.webDist, "index.html")) ? resolve(deps.webDist) : null;

  const routes: Route[] = [];
  const route = (spec: string, auth: Route["auth"], handler: Handler) => {
    const [method, path] = spec.split(" ") as [string, string];
    routes.push({ method, ...compile(path), handler, auth });
  };

  // ── dashboard API ──

  route("GET /api/me", "optional", async ({ session }) => {
    const base = { configured: auth.configured };
    if (!session) return { ...base, user: null, csrf: null, executor: null, planner: null };
    const ex = await service.executorStatus();
    return {
      ...base,
      user: session.user,
      csrf: session.csrf,
      executor: { kind: config.executor.kind, ok: ex.ok, reason: ex.reason ?? null },
      planner: (({ label, model }) => ({ kind: label, model }))(choosePlanner(config)),
    };
  });
  route("GET /api/state", "session", () => engine.state);
  route("GET /api/history", "session", async ({ url }) => {
    const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit")) || 50));
    return store.readHistory(limit);
  });
  route("GET /api/overlay-url", "session", () => ({
    url: `${config.publicUrl}/overlay?key=${encodeURIComponent(config.overlayKey)}`,
  }));
  route("GET /api/agent-connection", "session", () => ({
    token: config.agentToken,
    mcpUrl: config.publicUrl,
    mcpCommand: { command: "node", args: [join(REPO_ROOT, "plugin/mcp/aria-live-mcp.mjs")] },
  }));
  route("PATCH /api/settings", "session", ({ body }) => engine.updateSettings(body));
  route("POST /api/round/open", "session", ({ body }) => {
    if (body.prompt !== undefined && typeof body.prompt !== "string") {
      throw new HttpError(400, "bad_input", "prompt must be a string");
    }
    service.openRound((body.prompt as string | undefined) ?? "");
    return engine.state.round;
  });
  route("POST /api/round/vote", "session", () => engine.startVote());
  route("POST /api/round/close", "session", () => engine.closeVote());
  route("POST /api/round/reset", "session", () => ({ archived: service.resetRound() }));
  route("POST /api/ideas/:id/hide", "session", ({ params, body }) => {
    if (typeof body.hidden !== "boolean") throw new HttpError(400, "bad_input", "hidden must be a boolean");
    return engine.hideIdea(params.id!, body.hidden);
  });
  route("POST /api/task/plan", "session", () => service.planTask());
  route("PATCH /api/task", "session", ({ body }) => engine.editTask(body));
  route("POST /api/task/approve", "session", ({ session }) => engine.approveTask(session!.user.login));
  route("POST /api/task/reject", "session", ({ session, body }) => {
    if (body.note !== undefined && body.note !== null && typeof body.note !== "string") {
      throw new HttpError(400, "bad_input", "note must be a string");
    }
    return engine.rejectTask(session!.user.login, (body.note as string | undefined) ?? null);
  });
  route("POST /api/execution/start", "session", async () => {
    await service.startExecution();
    return engine.state.round?.execution ?? null;
  });
  route("POST /api/execution/cancel", "session", () => {
    service.cancelExecution();
    return engine.state.round?.execution ?? null;
  });

  // ── coding-agent API ──

  route("GET /api/agent/status", "agent", () => service.agent.status());
  route("GET /api/agent/task", "agent", ({ url, req, res }) => {
    const raw = url.searchParams.get("wait");
    const wait = raw === null ? 0 : Number(raw);
    if (!Number.isFinite(wait) || wait < 0 || wait > MAX_WAIT_SEC) {
      throw new HttpError(400, "bad_input", `wait must be between 0 and ${MAX_WAIT_SEC}`);
    }
    const now = service.agent.available();
    if (now || wait === 0) {
      if (now) return now;
      res.writeHead(204).end();
      return undefined;
    }
    return new Promise<unknown>((done) => {
      let finished = false;
      const finish = (v: unknown) => {
        if (finished) return;
        finished = true;
        off();
        clearTimeout(timer);
        req.off("close", onClose);
        done(v);
      };
      const off = engine.on((e) => {
        if (e.type !== "change") return;
        const t = service.agent.available();
        if (t) finish(t);
      });
      const timer = setTimeout(() => {
        if (!res.headersSent) res.writeHead(204).end();
        finish(undefined);
      }, wait * 1000);
      const onClose = () => finish(undefined);
      req.on("close", onClose);
    });
  });
  route("POST /api/agent/claim", "agent", ({ body }) => service.agent.claim(body.taskId, body.client));
  route("POST /api/agent/progress", "agent", ({ body, res }) => {
    if (!progressLimiter.take()) throw new HttpError(429, "rate_limited", "Too many progress reports; max 5 per second");
    service.agent.progress(body.taskId, body.kind, body.text);
    res.writeHead(204).end();
    return undefined;
  });
  route("POST /api/agent/complete", "agent", ({ body, res }) => {
    service.agent.complete(body);
    res.writeHead(204).end();
    return undefined;
  });

  // ── helpers ──

  const originOk = (req: IncomingMessage): boolean => {
    const origin = req.headers.origin;
    return !origin || allowedOrigins.has(origin);
  };

  const agentAuthorized = (req: IncomingMessage): boolean => {
    const h = req.headers.authorization ?? "";
    const m = /^Bearer\s+(.+)$/i.exec(h);
    return Boolean(m && safeEqual(m[1]!.trim(), config.agentToken));
  };

  async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const method = req.method ?? "GET";
    let matchedPath = false;
    for (const r of routes) {
      const m = r.pattern.exec(url.pathname);
      if (!m) continue;
      matchedPath = true;
      if (r.method !== method) continue;
      const params: Record<string, string> = {};
      r.keys.forEach((k, i) => {
        params[k] = decodeURIComponent(m[i + 1]!);
      });
      let session: Session | null = null;
      if (r.auth === "agent") {
        if (!agentAuthorized(req)) {
          res.setHeader("WWW-Authenticate", "Bearer");
          return sendError(res, 401, "unauthorized", "Agent token required");
        }
      } else {
        session = auth.sessionFromCookie(req.headers.cookie);
        if (r.auth === "session") {
          if (!session) return sendError(res, 401, "unauthorized", "Log in with Twitch first");
          if (method !== "GET" && method !== "HEAD") {
            const csrf = req.headers["x-aria-csrf"];
            if (typeof csrf !== "string" || !safeEqual(csrf, session.csrf)) {
              return sendError(res, 403, "bad_csrf", "Missing or invalid CSRF token");
            }
            if (!originOk(req)) return sendError(res, 403, "bad_origin", "Cross-origin request refused");
          }
        }
      }
      const body = method === "GET" || method === "HEAD" ? {} : await readBody(req);
      const out = await r.handler({ req, res, url, params, session, body });
      if (!res.headersSent && !res.writableEnded) sendJson(res, 200, out ?? null);
      return;
    }
    if (matchedPath) return sendError(res, 405, "method_not_allowed", "Method not allowed");
    return sendError(res, 404, "not_found", "No such endpoint");
  }

  async function handleAuth(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const method = req.method ?? "GET";
    if (url.pathname === "/auth/twitch/login" && method === "GET") {
      if (!auth.configured) {
        return htmlPage(res, 503, "Twitch not configured", "Set TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET in .env and restart.", `${appUrl}/`);
      }
      const force = url.searchParams.get("force_verify") === "true";
      res.writeHead(302, { Location: auth.authorizeUrl(force), "Cache-Control": "no-store" });
      res.end();
      return;
    }
    if (url.pathname === "/auth/twitch/callback" && method === "GET") {
      try {
        const session = await auth.completeLogin(url.searchParams);
        res.setHeader("Set-Cookie", auth.sessionCookie(session.id));
        res.writeHead(302, { Location: `${appUrl}/`, "Cache-Control": "no-store" });
        res.end();
        service.connectChat();
      } catch (err) {
        const e = err instanceof AuthError ? err : new AuthError(502, "login_failed", (err as Error).message);
        htmlPage(res, e.status, "Login failed", e.message, `${appUrl}/`);
      }
      return;
    }
    if (url.pathname === "/auth/logout" && method === "POST") {
      const session = auth.sessionFromCookie(req.headers.cookie);
      if (session) {
        const csrf = req.headers["x-aria-csrf"];
        if (typeof csrf !== "string" || !safeEqual(csrf, session.csrf) || !originOk(req)) {
          return sendError(res, 403, "bad_csrf", "Missing or invalid CSRF token");
        }
        await service.logout();
        hub.closeRole("dashboard");
      }
      res.setHeader("Set-Cookie", auth.clearCookie());
      return sendJson(res, 200, { ok: true });
    }
    return sendError(res, 404, "not_found", "No such endpoint");
  }

  function serveStatic(req: IncomingMessage, res: ServerResponse, url: URL): void {
    if (!webDist || (req.method !== "GET" && req.method !== "HEAD")) {
      return sendError(res, 404, "not_found", webDist ? "Not found" : "Web app not built (run npm run build) — or use the Vite dev server");
    }
    let rel: string;
    try {
      rel = decodeURIComponent(url.pathname);
    } catch {
      return sendError(res, 400, "bad_path", "Bad path");
    }
    if (rel.includes("\0")) return sendError(res, 400, "bad_path", "Bad path");
    const spa = SPA_ROUTES.has(rel) || SPA_ROUTES.has(rel.replace(/\/$/, ""));
    let file = spa ? join(webDist, "index.html") : resolve(webDist, `.${normalize(`/${rel}`)}`);
    if (file !== webDist && !file.startsWith(webDist + sep)) return sendError(res, 404, "not_found", "Not found");
    if (!spa && (!existsSync(file) || !statSync(file).isFile())) {
      if (extname(rel)) return sendError(res, 404, "not_found", "Not found");
      file = join(webDist, "index.html");
    }
    const type = MIME[extname(file).toLowerCase()] ?? "application/octet-stream";
    const immutable = file.includes(`${sep}assets${sep}`);
    res.writeHead(200, {
      "Content-Type": type,
      "Cache-Control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
      "X-Content-Type-Options": "nosniff",
    });
    if (req.method === "HEAD") return void res.end();
    createReadStream(file).pipe(res);
  }

  const server = createServer((req, res) => {
    let url: URL;
    try {
      url = new URL(req.url ?? "/", "http://localhost");
    } catch {
      return sendError(res, 400, "bad_url", "Bad URL");
    }
    const handle = async () => {
      if (url.pathname === "/healthz") return sendJson(res, 200, { ok: true, version: engine.state.version });
      if (url.pathname.startsWith("/api/")) return handleApi(req, res, url);
      if (url.pathname.startsWith("/auth/")) return handleAuth(req, res, url);
      return serveStatic(req, res, url);
    };
    handle().catch((err: unknown) => {
      if (err instanceof EngineError || err instanceof ServiceError || err instanceof AuthError || err instanceof AgentError || err instanceof HttpError) {
        return sendError(res, err.status, err.code, err.message);
      }
      console.error(`[http] ${req.method} ${url.pathname}:`, err);
      sendError(res, 500, "internal", "Internal server error");
    });
  });

  const hub = new WsHub({
    getState: () => engine.state,
    authorize: (req, url): ClientRole | number => {
      const role = url.searchParams.get("role");
      if (role === "overlay") {
        const key = url.searchParams.get("key") ?? "";
        return safeEqual(key, config.overlayKey) ? "overlay" : 401;
      }
      if (role === "dashboard") {
        if (!originOk(req)) return 403;
        return auth.sessionFromCookie(req.headers.cookie) ? "dashboard" : 401;
      }
      return 400;
    },
  });
  const offChange = engine.on((e) => {
    if (e.type === "change") hub.notify();
  });

  server.on("upgrade", (req, socket, head) => {
    let url: URL;
    try {
      url = new URL(req.url ?? "/", "http://localhost");
    } catch {
      socket.destroy();
      return;
    }
    if (url.pathname !== "/ws") {
      socket.destroy();
      return;
    }
    hub.handleUpgrade(req, socket, head, url);
  });

  return {
    server,
    hub,
    listen(port: number, host?: string) {
      return new Promise<number>((ok, fail) => {
        server.once("error", fail);
        server.listen(port, host, () => {
          server.off("error", fail);
          ok((server.address() as AddressInfo).port);
        });
      });
    },
    close() {
      offChange();
      hub.close();
      return new Promise<void>((ok) => {
        server.close(() => ok());
        server.closeAllConnections();
      });
    },
  };
}
