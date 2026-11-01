/**
 * Remote MCP over Streamable HTTP (stateful sessions, mcp-session-id).
 *
 *   /mcp                 agent role: Authorization: Bearer AGENT_TOKEN; the
 *                        5 agent tools (wait, claim, progress, complete, status)
 *   /mcp/cohost/KEY      co-host role for chat assistants that cannot send
 *                        headers (ChatGPT / Claude connectors): read-only tools
 *   /mcp/streamer/KEY    streamer role for the same apps: the read-only tools
 *                        plus round control (open, vote, extend, close, hide,
 *                        plan). Never approve, reject, run or cancel.
 *
 * A session belongs to the role (and endpoint) that created it. The bearer
 * token is checked on every request, not just at initialize. Origin, when
 * sent, must be the app's own origin (DNS-rebinding protection); the co-host
 * and streamer endpoints also accept the chat assistants' web origins.
 */
import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { createServer as createMcpServer, type Role } from "@aria-live/mcp/server";
import type { Config } from "../config.ts";
import type { LiveService } from "../live/service.ts";
import type { Store } from "../live/store.ts";
import { safeEqual } from "../twitch/auth.ts";
import { agentApi, cohostApi, streamerApi } from "./adapter.ts";

export const MCP_BODY_LIMIT = 1024 * 1024;
const IDLE_MS = 30 * 60 * 1000;
const MAX_SESSIONS = 64;
/** Web origins of the chat assistants, in case their connectors send one. */
const ASSISTANT_ORIGINS = ["https://chatgpt.com", "https://chat.openai.com", "https://claude.ai"];

interface Session {
  role: Role;
  transport: StreamableHTTPServerTransport;
  server: McpServer;
  lastSeen: number;
  active: number;
}

export interface McpHttpDeps {
  config: Config;
  service: LiveService;
  store: Store;
  allowedOrigins: Set<string>;
  takeProgress: () => boolean;
}

export interface McpHttp {
  /** Handles /mcp and /mcp/*; returns false if the path is not an MCP path. */
  handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean>;
  close(): Promise<void>;
  readonly sessionCount: number;
}

function rpcError(res: ServerResponse, status: number, code: number, message: string, headers: Record<string, string> = {}): void {
  if (res.headersSent) return;
  const body = JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id: null });
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers });
  res.end(body);
}

class TooLarge extends Error {}

async function readJson(req: IncomingMessage): Promise<unknown> {
  if (Number(req.headers["content-length"] ?? 0) > MCP_BODY_LIMIT) throw new TooLarge();
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MCP_BODY_LIMIT) throw new TooLarge();
    chunks.push(chunk as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export function createMcpHttp(deps: McpHttpDeps): McpHttp {
  const { config, service, store } = deps;
  const sessions = new Map<string, Session>();
  const cohostOrigins = new Set([...deps.allowedOrigins, ...ASSISTANT_ORIGINS]);

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [id, s] of sessions) if (!s.active && now - s.lastSeen > IDLE_MS) void drop(id);
  }, 60_000);
  sweep.unref();

  async function drop(id: string): Promise<void> {
    const s = sessions.get(id);
    if (!s) return;
    sessions.delete(id);
    await s.server.close().catch(() => {});
  }

  function evictIfFull(): void {
    if (sessions.size < MAX_SESSIONS) return;
    let oldest: [string, Session] | null = null;
    for (const e of sessions) if (!e[1].active && (!oldest || e[1].lastSeen < oldest[1].lastSeen)) oldest = e;
    if (oldest) void drop(oldest[0]);
  }

  function newServer(role: Role): McpServer {
    if (role === "cohost") return createMcpServer({ role: "cohost", client: cohostApi(service, store) });
    if (role === "streamer") return createMcpServer({ role: "streamer", client: streamerApi(service, store) });
    return createMcpServer({ role: "agent", client: agentApi(service, deps.takeProgress) });
  }

  function authorize(req: IncomingMessage, res: ServerResponse, url: URL): Role | null {
    if (url.pathname === "/mcp") {
      const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? "");
      if (!m || !safeEqual(m[1]!.trim(), config.agentToken)) {
        rpcError(res, 401, -32001, "Agent token required (Authorization: Bearer <token> from the Aria Live dashboard)", {
          "WWW-Authenticate": 'Bearer realm="aria-live"',
        });
        return null;
      }
      return "agent";
    }
    const m = /^\/mcp\/(cohost|streamer)\/([^/]+)$/.exec(url.pathname);
    let key = "";
    try {
      key = m ? decodeURIComponent(m[2]!) : "";
    } catch {
      key = "";
    }
    const role = m?.[1] === "streamer" ? "streamer" : "cohost";
    if (!m || !safeEqual(key, role === "streamer" ? config.streamerKey : config.cohostKey)) {
      rpcError(res, 404, -32001, "Not found");
      return null;
    }
    return role;
  }

  async function handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    if (url.pathname !== "/mcp" && !url.pathname.startsWith("/mcp/")) return false;
    const role = authorize(req, res, url);
    if (!role) return true;
    const origin = req.headers.origin;
    if (origin && !(role === "agent" ? deps.allowedOrigins : cohostOrigins).has(origin)) {
      rpcError(res, 403, -32000, "Origin not allowed");
      return true;
    }
    const method = req.method ?? "GET";
    if (method !== "POST" && method !== "GET" && method !== "DELETE") {
      rpcError(res, 405, -32000, "Method not allowed", { Allow: "GET, POST, DELETE" });
      return true;
    }

    let body: unknown;
    if (method === "POST") {
      try {
        body = await readJson(req);
      } catch (err) {
        if (err instanceof TooLarge) rpcError(res, 413, -32600, "Request body too large (max 1 MB)");
        else rpcError(res, 400, -32700, "Parse error: invalid JSON");
        return true;
      }
    }

    const sid = req.headers["mcp-session-id"];
    const sessionId = Array.isArray(sid) ? sid[0] : sid;
    let session: Session | undefined;
    if (sessionId) {
      session = sessions.get(sessionId);
      // A session is only valid on the endpoint (role) that created it.
      if (!session || session.role !== role) {
        rpcError(res, 404, -32001, "Session not found; initialize again");
        return true;
      }
    } else {
      const init = method === "POST" && (Array.isArray(body) ? body.some((m) => isInitializeRequest(m)) : isInitializeRequest(body));
      if (!init) {
        rpcError(res, 400, -32000, "Bad request: missing mcp-session-id (send initialize first)");
        return true;
      }
      evictIfFull();
      const server = newServer(role);
      const fresh: Session = {
        role,
        server,
        lastSeen: Date.now(),
        active: 0,
        transport: new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (id) => {
            sessions.set(id, fresh);
          },
          onsessionclosed: (id) => {
            sessions.delete(id);
          },
        }),
      };
      fresh.transport.onclose = () => {
        if (fresh.transport.sessionId) sessions.delete(fresh.transport.sessionId);
      };
      await server.connect(fresh.transport);
      session = fresh;
    }

    session.active++;
    session.lastSeen = Date.now();
    try {
      await session.transport.handleRequest(req, res, body);
    } finally {
      session.active--;
      session.lastSeen = Date.now();
    }
    return true;
  }

  return {
    handle,
    get sessionCount() {
      return sessions.size;
    },
    async close() {
      clearInterval(sweep);
      await Promise.all([...sessions.keys()].map((id) => drop(id)));
    },
  };
}
