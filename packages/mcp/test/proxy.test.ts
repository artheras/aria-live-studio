import { randomUUID } from "node:crypto";
import { createServer as createHttpServer, type IncomingMessage, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createProxyServer, resolveProxyConfig, type ProxyConfig } from "../src/proxy.ts";

const TOKEN = "agent-secret";
const KEY = "co/host key";

interface Upstream {
  base: string;
  close(): Promise<void>;
  /** clientInfo.name of each initialize, and the paths hit. */
  clients: string[];
  dropSessions(): void;
}

let upstreams: Upstream[] = [];
let clients: Client[] = [];
afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.close().catch(() => {})));
  await Promise.all(upstreams.splice(0).map((u) => u.close()));
});

function remoteServer(role: string): McpServer {
  const server = new McpServer({ name: "aria-live", version: "0.1.0" }, { instructions: `instructions for ${role}` });
  server.registerTool(
    "live_status",
    {
      title: "Stream status",
      description: "Read-only status.",
      inputSchema: { verbose: z.boolean().optional() },
      outputSchema: { phase: z.string(), role: z.string() },
      annotations: { readOnlyHint: true, openWorldHint: false },
      _meta: { "openai/outputTemplate": "ui://aria-live/round.html" },
    },
    async ({ verbose }) => ({
      content: [{ type: "text", text: `phase voting${verbose ? " (verbose)" : ""}` }],
      structuredContent: { phase: "voting", role },
      _meta: { widget: { round: 3 } },
    }),
  );
  server.registerTool("live_fail", { description: "Always fails." }, async () => ({
    isError: true,
    content: [{ type: "text", text: "Nothing to do" }],
  }));
  server.registerResource("round", "ui://aria-live/round.html", { mimeType: "text/html+skybridge" }, async (uri) => ({
    contents: [{ uri: uri.href, mimeType: "text/html+skybridge", text: "<div>round</div>", _meta: { "openai/widgetPrefersBorder": true } }],
  }));
  server.registerPrompt("recap", { description: "Recap the round" }, async () => ({
    messages: [{ role: "user", content: { type: "text", text: "Recap the round." } }],
  }));
  return server;
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : undefined;
}

/** A local Streamable HTTP MCP server with the same paths and auth as Aria Live. */
async function startUpstream(): Promise<Upstream> {
  const sessions = new Map<string, StreamableHTTPServerTransport>();
  const seen: string[] = [];
  const http: HttpServer = createHttpServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    let role: string;
    if (url.pathname === "/mcp") {
      if (req.headers.authorization !== `Bearer ${TOKEN}`) {
        res.writeHead(401, { "content-type": "application/json", "www-authenticate": "Bearer" }).end('{"jsonrpc":"2.0","error":{"code":-32001,"message":"no"},"id":null}');
        return;
      }
      role = "agent";
    } else if (url.pathname === `/mcp/cohost/${encodeURIComponent(KEY)}`) {
      role = "cohost";
    } else {
      res.writeHead(404).end();
      return;
    }
    const body = req.method === "POST" ? await readJson(req) : undefined;
    const sid = req.headers["mcp-session-id"];
    let transport = typeof sid === "string" ? sessions.get(sid) : undefined;
    if (!transport) {
      if (sid || !isInitializeRequest(body)) {
        res.writeHead(sid ? 404 : 400).end();
        return;
      }
      seen.push((body as { params: { clientInfo: { name: string } } }).params.clientInfo.name);
      const t = new StreamableHTTPServerTransport({
        sessionIdGenerator: randomUUID,
        onsessioninitialized: (id) => void sessions.set(id, t),
      });
      transport = t;
      await remoteServer(role).connect(t);
    }
    await transport.handleRequest(req, res, body);
  });
  await new Promise<void>((r) => http.listen(0, "127.0.0.1", r));
  const port = (http.address() as AddressInfo).port;
  return {
    base: `http://127.0.0.1:${port}`,
    clients: seen,
    dropSessions: () => sessions.clear(),
    close: async () => {
      await Promise.all([...sessions.values()].map((t) => t.close().catch(() => {})));
      http.closeAllConnections();
      await new Promise((r) => http.close(r));
    },
  };
}

async function connectProxy(config: ProxyConfig, name = "claude-ai") {
  const [hostSide, proxySide] = InMemoryTransport.createLinkedPair();
  const proxy = createProxyServer(config, { retryMs: 0 });
  await proxy.connect(proxySide);
  const client = new Client({ name, version: "1.0.0" });
  await client.connect(hostSide);
  clients.push(client);
  return client;
}

const textOf = (r: unknown) => (((r as { content?: unknown }).content ?? []) as { text?: string }[]).map((c) => c.text ?? "").join("\n");

describe("resolveProxyConfig", () => {
  it("builds the endpoint for each role and keeps the key out of logs", () => {
    expect(resolveProxyConfig({ ARIA_LIVE_TOKEN: "t" })).toMatchObject({
      role: "agent",
      safeUrl: "http://localhost:3000/mcp",
      headers: { authorization: "Bearer t" },
    });
    const cohost = resolveProxyConfig({ ARIA_LIVE_URL: "https://live.example/", ARIA_LIVE_KEY: "a b" });
    expect(cohost).toMatchObject({ role: "cohost", safeUrl: "https://live.example/mcp/cohost/<key>", headers: {} });
    expect("url" in cohost && cohost.url.href).toBe("https://live.example/mcp/cohost/a%20b");
    expect(resolveProxyConfig({ ARIA_LIVE_ROLE: "streamer", ARIA_LIVE_KEY: "k" })).toMatchObject({ role: "streamer", safeUrl: "http://localhost:3000/mcp/streamer/<key>" });
  });

  it("accepts the full remote URL from the dashboard", () => {
    const c = resolveProxyConfig({ ARIA_LIVE_URL: "https://x.example/base/mcp/streamer/s3cret" });
    expect(c).toMatchObject({ role: "streamer", safeUrl: "https://x.example/base/mcp/streamer/<key>" });
    expect("url" in c && c.url.href).toBe("https://x.example/base/mcp/streamer/s3cret");
    expect(resolveProxyConfig({ ARIA_LIVE_URL: "http://h:3000/mcp", ARIA_LIVE_TOKEN: "t" })).toMatchObject({ role: "agent", safeUrl: "http://h:3000/mcp" });
    // the pasted URL decides the role, whatever the host sends as the role default
    expect(resolveProxyConfig({ ARIA_LIVE_URL: "http://h/mcp/streamer/k", ARIA_LIVE_ROLE: "cohost", ARIA_LIVE_KEY: "other" })).toMatchObject({ role: "streamer" });
    expect(resolveProxyConfig({ ARIA_LIVE_URL: "http://h/mcp/streamer/k", ARIA_LIVE_KEY: "other" })).toHaveProperty("url", new URL("http://h/mcp/streamer/k"));
  });

  it("treats unsubstituted host placeholders as unset and explains what is missing", () => {
    const c = resolveProxyConfig({ ARIA_LIVE_URL: "${user_config.aria_live_url}", ARIA_LIVE_ROLE: "agent", ARIA_LIVE_TOKEN: "${user_config.agent_token}" });
    expect("error" in c && c.error).toMatch(/agent token/);
    expect("error" in resolveProxyConfig({ ARIA_LIVE_ROLE: "cohost" }) && resolveProxyConfig({ ARIA_LIVE_ROLE: "cohost" })).toBeTruthy();
    expect(resolveProxyConfig({ ARIA_LIVE_ROLE: "admin", ARIA_LIVE_KEY: "k" })).toEqual({ error: expect.stringMatching(/Unknown role "admin"/) });
    expect(resolveProxyConfig({ ARIA_LIVE_URL: "ftp://x", ARIA_LIVE_TOKEN: "t" })).toHaveProperty("error");
  });
});

describe("stdio ↔ Streamable HTTP proxy", () => {
  it("forwards tools with annotations, _meta and structured content, resources, prompts and instructions", async () => {
    const up = await startUpstream();
    upstreams.push(up);
    const client = await connectProxy(resolveProxyConfig({ ARIA_LIVE_URL: up.base, ARIA_LIVE_TOKEN: TOKEN }), "claude-desktop");
    expect(up.clients).toEqual(["claude-desktop"]); // the host's name reaches Aria Live
    expect(client.getInstructions()).toBe("instructions for agent");

    const { tools } = await client.listTools();
    const status = tools.find((t) => t.name === "live_status")!;
    expect(tools.map((t) => t.name)).toEqual(["live_status", "live_fail"]);
    expect(status.annotations).toEqual({ readOnlyHint: true, openWorldHint: false });
    expect(status._meta).toEqual({ "openai/outputTemplate": "ui://aria-live/round.html" });
    expect(status.title).toBe("Stream status");
    expect(status.outputSchema?.properties).toHaveProperty("phase");

    const r = await client.callTool({ name: "live_status", arguments: { verbose: true } });
    expect(textOf(r)).toBe("phase voting (verbose)");
    expect(r.structuredContent).toEqual({ phase: "voting", role: "agent" });
    expect(r._meta).toEqual({ widget: { round: 3 } });

    const fail = await client.callTool({ name: "live_fail", arguments: {} });
    expect(fail.isError).toBe(true);
    expect(textOf(fail)).toBe("Nothing to do");

    const { resources } = await client.listResources();
    expect(resources.map((x) => x.uri)).toEqual(["ui://aria-live/round.html"]);
    const read = await client.readResource({ uri: "ui://aria-live/round.html" });
    expect(read.contents[0]).toMatchObject({ text: "<div>round</div>", _meta: { "openai/widgetPrefersBorder": true } });

    expect((await client.listPrompts()).prompts.map((p) => p.name)).toEqual(["recap"]);
    expect((await client.getPrompt({ name: "recap" })).messages).toHaveLength(1);
  });

  it("reaches the co-host endpoint with the key in the path", async () => {
    const up = await startUpstream();
    upstreams.push(up);
    const client = await connectProxy(resolveProxyConfig({ ARIA_LIVE_URL: up.base, ARIA_LIVE_ROLE: "cohost", ARIA_LIVE_KEY: KEY }));
    const r = await client.callTool({ name: "live_status", arguments: {} });
    expect(r.structuredContent).toEqual({ phase: "voting", role: "cohost" });
    expect(client.getInstructions()).toBe("instructions for cohost");
  });

  it("opens a new remote session when the old one expired", async () => {
    const up = await startUpstream();
    upstreams.push(up);
    const client = await connectProxy(resolveProxyConfig({ ARIA_LIVE_URL: up.base, ARIA_LIVE_TOKEN: TOKEN }));
    await client.callTool({ name: "live_status", arguments: {} });
    up.dropSessions();
    const r = await client.callTool({ name: "live_status", arguments: {} });
    expect(r.structuredContent).toEqual({ phase: "voting", role: "agent" });
    expect(up.clients).toHaveLength(2);
  });

  it("explains a rejected token, an unknown key and an unreachable server", async () => {
    const up = await startUpstream();
    upstreams.push(up);

    const badToken = await connectProxy(resolveProxyConfig({ ARIA_LIVE_URL: up.base, ARIA_LIVE_TOKEN: "wrong" }));
    await expect(badToken.listTools()).rejects.toThrow(/rejected the agent token \(HTTP 401\)/);
    const call = await badToken.callTool({ name: "live_status", arguments: {} });
    expect(call.isError).toBe(true);
    expect(textOf(call)).toMatch(/^Aria Live rejected the agent token/);

    const badKey = await connectProxy(resolveProxyConfig({ ARIA_LIVE_URL: up.base, ARIA_LIVE_ROLE: "cohost", ARIA_LIVE_KEY: "nope" }));
    const keyCall = await badKey.callTool({ name: "live_status", arguments: {} });
    expect(textOf(keyCall)).toMatch(/does not recognise this cohost key/);
    expect(textOf(keyCall)).not.toContain("nope");

    const closed = await startUpstream();
    const deadBase = closed.base;
    await closed.close();
    const down = await connectProxy(resolveProxyConfig({ ARIA_LIVE_URL: deadBase, ARIA_LIVE_TOKEN: TOKEN }));
    const downCall = await down.callTool({ name: "live_status", arguments: {} });
    expect(textOf(downCall)).toMatch(new RegExp(`^Cannot reach Aria Live at ${deadBase.replace(/[.]/g, "\\.")} \\(ECONNREFUSED\\)`));

    const misconfigured = await connectProxy(resolveProxyConfig({ ARIA_LIVE_ROLE: "streamer" }));
    expect(textOf(await misconfigured.callTool({ name: "live_status", arguments: {} }))).toMatch(/streamer role needs the streamer key/);
  });
});
