/**
 * stdio ↔ Streamable HTTP proxy for hosts that only start local MCP servers
 * (Claude Desktop's .mcpb bundle, Aria Code, any stdio-only client).
 *
 * It connects to the Aria Live server's remote MCP endpoint for one role and
 * forwards tools, resources and prompts unchanged (annotations, _meta,
 * structuredContent included):
 *
 *   agent     PUBLIC_URL/mcp                 Authorization: Bearer <agent token>
 *   cohost    PUBLIC_URL/mcp/cohost/<key>    read-only co-host tools
 *   streamer  PUBLIC_URL/mcp/streamer/<key>  co-host tools + round controls
 *
 * The proxy adds no tools and no permissions of its own: whatever the
 * endpoint refuses, the proxy refuses. The connection is made when the host
 * initializes (so the host's name reaches the stream overlay); when Aria Live
 * is unreachable the host gets a clear error, and the proxy keeps retrying in
 * the background and announces the tools once the server is back.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport, StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { RequestOptions } from "@modelcontextprotocol/sdk/shared/protocol.js";
import {
  CallToolRequestSchema,
  CallToolResultSchema,
  ErrorCode,
  GetPromptRequestSchema,
  GetPromptResultSchema,
  InitializeRequestSchema,
  ListPromptsRequestSchema,
  ListPromptsResultSchema,
  ListResourcesRequestSchema,
  ListResourcesResultSchema,
  ListResourceTemplatesRequestSchema,
  ListResourceTemplatesResultSchema,
  ListToolsRequestSchema,
  ListToolsResultSchema,
  McpError,
  PromptListChangedNotificationSchema,
  ReadResourceRequestSchema,
  ReadResourceResultSchema,
  ResourceListChangedNotificationSchema,
  ToolListChangedNotificationSchema,
  type CallToolResult,
  type Implementation,
  type InitializeResult,
  type ServerCapabilities,
} from "@modelcontextprotocol/sdk/types.js";

/** Same identity as the remote server (packages/mcp/src/server.ts); kept here so the bundle stays small. */
const SERVER_NAME = "aria-live";
const SERVER_VERSION = "0.1.0";

export type ProxyRole = "agent" | "cohost" | "streamer";
export const PROXY_ROLES: readonly ProxyRole[] = ["agent", "cohost", "streamer"];

export interface ProxyTarget {
  role: ProxyRole;
  /** The remote MCP endpoint. */
  url: URL;
  /** Same URL with the key replaced, safe to show in errors and logs. */
  safeUrl: string;
  headers: Record<string, string>;
}

/** A target, or the configuration problem to report on every request. */
export type ProxyConfig = ProxyTarget | { error: string };

export interface ProxyEnv {
  /** Server base URL (http://localhost:3000), or a full remote MCP URL from the dashboard. */
  ARIA_LIVE_URL?: string;
  /** agent | cohost | streamer */
  ARIA_LIVE_ROLE?: string;
  /** Agent token (agent role). */
  ARIA_LIVE_TOKEN?: string;
  /** Co-host or streamer key (the last part of that URL). */
  ARIA_LIVE_KEY?: string;
  [name: string]: string | undefined;
}

/** Hosts may pass an unset optional setting through literally ("${user_config.x}"). */
function setting(value: string | undefined): string {
  const v = (value ?? "").trim();
  return /^\$\{[^}]*\}$/.test(v) ? "" : v;
}

const WHERE =
  "Copy it from the Aria Live dashboard: Connect a coding agent → Remote (URL).";

export function resolveProxyConfig(env: ProxyEnv): ProxyConfig {
  const raw = setting(env.ARIA_LIVE_URL) || "http://localhost:3000";
  let base: URL;
  try {
    base = new URL(raw);
  } catch {
    return { error: `ARIA_LIVE_URL is not a URL: "${raw}". Use the Aria Live address, for example http://localhost:3000.` };
  }
  if (base.protocol !== "http:" && base.protocol !== "https:") {
    return { error: `ARIA_LIVE_URL must start with http:// or https:// (got ${base.protocol}).` };
  }
  base.hash = "";
  base.search = "";

  let role = setting(env.ARIA_LIVE_ROLE).toLowerCase() as ProxyRole | "";
  let key = setting(env.ARIA_LIVE_KEY);
  const token = setting(env.ARIA_LIVE_TOKEN);
  let prefix = base.pathname.replace(/\/+$/, "");

  // A full remote URL pasted as ARIA_LIVE_URL: take the role and key from it.
  const pasted = /^(.*?)\/mcp(?:\/(cohost|streamer)\/([^/]+))?$/.exec(prefix);
  if (pasted) {
    // The URL wins over ARIA_LIVE_ROLE: hosts such as Claude Desktop always send a role default.
    role = (pasted[2] as ProxyRole | undefined) ?? "agent";
    if (pasted[3]) {
      try {
        key = decodeURIComponent(pasted[3]);
      } catch {
        return { error: "The key in ARIA_LIVE_URL is not valid. " + WHERE };
      }
    }
    prefix = pasted[1]!;
  }
  if (!role) role = token ? "agent" : "cohost";
  if (!PROXY_ROLES.includes(role)) {
    return { error: `Unknown role "${role}". Use agent, cohost or streamer.` };
  }

  const origin = `${base.protocol}//${base.host}${prefix}`;
  if (role === "agent") {
    if (!token) {
      return { error: "The agent role needs the agent token (ARIA_LIVE_TOKEN). " + WHERE + " For a read-only co-host, set the role to cohost and paste the co-host key instead." };
    }
    return { role, url: new URL(`${origin}/mcp`), safeUrl: `${origin}/mcp`, headers: { authorization: `Bearer ${token}` } };
  }
  if (!key) {
    return { error: `The ${role} role needs the ${role} key (ARIA_LIVE_KEY, the part after /mcp/${role}/ in the ${role} URL). ` + WHERE };
  }
  return {
    role,
    url: new URL(`${origin}/mcp/${role}/${encodeURIComponent(key)}`),
    safeUrl: `${origin}/mcp/${role}/<key>`,
    headers: {},
  };
}

/** Turns transport failures into a sentence the host (and the model) can act on. */
export function describeUpstreamError(error: unknown, target: ProxyTarget): string {
  const base = target.safeUrl.replace(/\/mcp(\/.*)?$/, "");
  if (error instanceof StreamableHTTPError) {
    if (error.code === 401) {
      return "Aria Live rejected the agent token (HTTP 401). Copy it again from the dashboard (Connect a coding agent) into the agent token setting (ARIA_LIVE_TOKEN).";
    }
    if (error.code === 404 && target.role !== "agent") {
      return `Aria Live does not recognise this ${target.role} key (HTTP 404 at ${target.safeUrl}). It may have been rotated: copy the ${target.role} URL again from the dashboard (Connect a coding agent → Remote (URL)).`;
    }
    if (error.code === 403) {
      return `Aria Live refused the connection (HTTP 403 at ${target.safeUrl}).`;
    }
    return `Aria Live returned an error at ${target.safeUrl} (HTTP ${error.code}). Is ARIA_LIVE_URL the Aria Live server?`;
  }
  const cause = (error as { cause?: { code?: string; message?: string } } | null)?.cause;
  const message = error instanceof Error ? error.message : String(error);
  if (cause?.code || /fetch failed|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|network/i.test(message)) {
    return `Cannot reach Aria Live at ${base} (${cause?.code ?? cause?.message ?? message}). Is the server running and is the URL right?`;
  }
  return `Aria Live MCP error: ${message}`;
}

/** Errors that mean the remote session is gone, so a fresh session may succeed. */
function sessionLost(error: unknown): boolean {
  return error instanceof StreamableHTTPError && (error.code === 404 || error.code === 400);
}

export interface ProxyOptions {
  fetch?: typeof fetch;
  /** Fallback client name when the host does not send one. */
  clientName?: string;
  /** Per-request timeout for tools/call (live_wait_for_task long-polls). */
  callTimeoutMs?: number;
  /** First background reconnect delay after a failure; 0 disables retrying. */
  retryMs?: number;
  log?: (line: string) => void;
}

const DEFAULT_CAPABILITIES: ServerCapabilities = {
  tools: { listChanged: true },
  resources: { listChanged: true },
  prompts: { listChanged: true },
};

/**
 * The stdio-facing MCP server. Connect it to a StdioServerTransport (or any
 * transport); it opens the upstream session when the host initializes.
 */
export function createProxyServer(config: ProxyConfig, options: ProxyOptions = {}): Server {
  const log = options.log ?? (() => {});
  const callTimeoutMs = options.callTimeoutMs ?? 11 * 60_000;
  const retryMs = options.retryMs ?? 5_000;
  const server = new Server({ name: SERVER_NAME, version: SERVER_VERSION }, { capabilities: DEFAULT_CAPABILITIES });

  let client: Client | null = null;
  let connecting: Promise<Client> | null = null;
  let downstreamInfo: Implementation | undefined;
  let lastError = "";
  let retryTimer: NodeJS.Timeout | null = null;
  let retryDelay = retryMs;
  let closed = false;
  let announcedTools = false;

  function configError(): string | null {
    return "error" in config ? config.error : null;
  }

  function scheduleRetry(): void {
    if (closed || !retryMs || retryTimer) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      upstream().then(
        () => {
          retryDelay = retryMs;
          if (!announcedTools) return;
          // The host listed tools while Aria Live was down: tell it to list again.
          void server.sendToolListChanged().catch(() => {});
          void server.sendResourceListChanged().catch(() => {});
          void server.sendPromptListChanged().catch(() => {});
        },
        () => {
          retryDelay = Math.min(retryDelay * 2, 60_000);
          scheduleRetry();
        },
      );
    }, retryDelay);
    retryTimer.unref?.();
  }

  async function connectUpstream(target: ProxyTarget): Promise<Client> {
    const name = downstreamInfo?.name || options.clientName || "aria-live-proxy";
    const c = new Client({ name, version: downstreamInfo?.version ?? SERVER_VERSION }, { capabilities: {} });
    const transport = new StreamableHTTPClientTransport(target.url, {
      requestInit: { headers: target.headers },
      ...(options.fetch ? { fetch: options.fetch } : {}),
    });
    c.setNotificationHandler(ToolListChangedNotificationSchema, () => server.sendToolListChanged().catch(() => {}));
    c.setNotificationHandler(ResourceListChangedNotificationSchema, () => server.sendResourceListChanged().catch(() => {}));
    c.setNotificationHandler(PromptListChangedNotificationSchema, () => server.sendPromptListChanged().catch(() => {}));
    c.onclose = () => {
      if (client === c) client = null;
    };
    try {
      await c.connect(transport, { timeout: 15_000 });
    } catch (error) {
      await c.close().catch(() => {});
      throw error;
    }
    log(`connected to ${target.safeUrl} as ${target.role}`);
    return c;
  }

  async function upstream(): Promise<Client> {
    const problem = configError();
    if (problem) throw new McpError(ErrorCode.InvalidRequest, problem);
    const target = config as ProxyTarget;
    if (client) return client;
    connecting ??= connectUpstream(target)
      .then((c) => {
        client = c;
        lastError = "";
        return c;
      })
      .catch((error: unknown) => {
        lastError = describeUpstreamError(error, target);
        log(lastError);
        scheduleRetry();
        throw new McpError(ErrorCode.InternalError, lastError);
      })
      .finally(() => {
        connecting = null;
      });
    return connecting;
  }

  function dropClient(c: Client): void {
    if (client === c) client = null;
    void c.close().catch(() => {});
  }

  /** Forwards one request; on a lost remote session, reconnects once (the request never ran). */
  async function forward<T>(run: (c: Client) => Promise<T>): Promise<T> {
    let c = await upstream();
    try {
      return await run(c);
    } catch (error) {
      if (!sessionLost(error)) throw mapError(error);
      dropClient(c);
      c = await upstream();
      try {
        return await run(c);
      } catch (retryError) {
        throw mapError(retryError);
      }
    }
  }

  function mapError(error: unknown): unknown {
    if (error instanceof McpError) return error;
    const target = config as ProxyTarget;
    const text = describeUpstreamError(error, target);
    if (!(error instanceof StreamableHTTPError)) {
      // Transport-level failure: the next request opens a new session.
      if (client) dropClient(client);
      scheduleRetry();
    }
    return new McpError(ErrorCode.InternalError, text);
  }

  const has = (c: Client, capability: keyof ServerCapabilities) => Boolean(c.getServerCapabilities()?.[capability]);

  // Initialize: answer the host as usual, then open the upstream session with
  // the host's name so the stream shows "claude-code", "aria-code" …, and pass
  // on the remote server's instructions for this role.
  const baseInitialize = (server as unknown as { _oninitialize?: (r: unknown) => Promise<InitializeResult> })._oninitialize;
  if (typeof baseInitialize === "function") {
    server.setRequestHandler(InitializeRequestSchema, async (request) => {
      const result = await baseInitialize.call(server, request);
      downstreamInfo = request.params.clientInfo;
      try {
        const c = await upstream();
        const instructions = c.getInstructions();
        return instructions ? { ...result, instructions } : result;
      } catch {
        return result; // reported on the first tools/list or tools/call
      }
    });
  }

  server.setRequestHandler(ListToolsRequestSchema, async (request, extra) => {
    announcedTools = true;
    return forward((c) => c.request({ method: "tools/list", params: request.params }, ListToolsResultSchema, { signal: extra.signal }));
  });

  server.setRequestHandler(CallToolRequestSchema, async (request, extra): Promise<CallToolResult> => {
    const progressToken = request.params._meta?.progressToken;
    const requestOptions: RequestOptions = {
      signal: extra.signal,
      timeout: callTimeoutMs,
      resetTimeoutOnProgress: true,
      ...(progressToken !== undefined
        ? {
            onprogress: (progress) =>
              void extra.sendNotification({ method: "notifications/progress", params: { ...progress, progressToken } }).catch(() => {}),
          }
        : {}),
    };
    try {
      return (await forward((c) =>
        c.request({ method: "tools/call", params: request.params }, CallToolResultSchema, requestOptions),
      )) as CallToolResult;
    } catch (error) {
      // A tool result the model can read beats a protocol error it cannot.
      const message = error instanceof Error ? error.message.replace(/^MCP error -?\d+: /, "") : String(error);
      return { isError: true, content: [{ type: "text", text: message }] };
    }
  });

  server.setRequestHandler(ListResourcesRequestSchema, async (request, extra) =>
    forward(async (c) =>
      has(c, "resources")
        ? c.request({ method: "resources/list", params: request.params }, ListResourcesResultSchema, { signal: extra.signal })
        : { resources: [] },
    ),
  );

  server.setRequestHandler(ListResourceTemplatesRequestSchema, async (request, extra) =>
    forward(async (c) =>
      has(c, "resources")
        ? c.request({ method: "resources/templates/list", params: request.params }, ListResourceTemplatesResultSchema, { signal: extra.signal })
        : { resourceTemplates: [] },
    ),
  );

  server.setRequestHandler(ReadResourceRequestSchema, async (request, extra) =>
    forward((c) => {
      if (!has(c, "resources")) throw new McpError(ErrorCode.InvalidParams, `Unknown resource: ${request.params.uri}`);
      return c.request({ method: "resources/read", params: request.params }, ReadResourceResultSchema, { signal: extra.signal });
    }),
  );

  server.setRequestHandler(ListPromptsRequestSchema, async (request, extra) =>
    forward(async (c) =>
      has(c, "prompts")
        ? c.request({ method: "prompts/list", params: request.params }, ListPromptsResultSchema, { signal: extra.signal })
        : { prompts: [] },
    ),
  );

  server.setRequestHandler(GetPromptRequestSchema, async (request, extra) =>
    forward((c) => {
      if (!has(c, "prompts")) throw new McpError(ErrorCode.InvalidParams, `Unknown prompt: ${request.params.name}`);
      return c.request({ method: "prompts/get", params: request.params }, GetPromptResultSchema, { signal: extra.signal });
    }),
  );

  const baseOnClose = server.onclose;
  server.onclose = () => {
    closed = true;
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
    const c = client;
    client = null;
    if (c) {
      // End the remote session politely (DELETE), then close.
      const transport = (c as unknown as { transport?: StreamableHTTPClientTransport }).transport;
      void transport?.terminateSession?.().catch(() => {}).finally(() => c.close().catch(() => {}));
    }
    baseOnClose?.();
  };

  return server;
}
