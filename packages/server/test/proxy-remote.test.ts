/**
 * The stdio proxy (packages/mcp/src/proxy.ts, bundled into the Claude Desktop
 * .mcpb) against the real remote MCP endpoints of the server.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createProxyServer, resolveProxyConfig, type ProxyEnv } from "@aria-live/mcp/proxy";
import { afterEach, describe, expect, it } from "vitest";
import { startHarness, type Harness } from "./harness.ts";

let h: Harness | null = null;
const clients: Client[] = [];
afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.close().catch(() => {})));
  await h?.close();
  h = null;
});

async function viaProxy(env: ProxyEnv, name = "claude-desktop") {
  const [hostSide, proxySide] = InMemoryTransport.createLinkedPair();
  await createProxyServer(resolveProxyConfig(env), { retryMs: 0 }).connect(proxySide);
  const client = new Client({ name, version: "1.0.0" });
  await client.connect(hostSide);
  clients.push(client);
  return client;
}

const textOf = (r: unknown) => ((r as { content: { text?: string }[] }).content ?? []).map((c) => c.text ?? "").join("\n");

describe("stdio proxy → remote MCP", () => {
  it("agent role: same tools as /mcp, and calls reach the round", async () => {
    h = await startHarness();
    const client = await viaProxy({ ARIA_LIVE_URL: h.base, ARIA_LIVE_ROLE: "agent", ARIA_LIVE_TOKEN: h.config.agentToken });
    const tools = (await client.listTools()).tools;
    expect(tools.map((t) => t.name).sort()).toEqual([
      "live_claim_task",
      "live_complete_task",
      "live_report_progress",
      "live_status",
      "live_wait_for_task",
    ]);
    expect(tools.find((t) => t.name === "live_status")?.annotations?.readOnlyHint).toBe(true);
    h.service.engine.openRound("boss fight");
    const status = await client.callTool({ name: "live_status", arguments: {} });
    expect(status.isError).toBeFalsy();
    expect(textOf(status)).toMatch(/phase collecting/);
  });

  it("co-host role: read-only tools through the key in the URL", async () => {
    h = await startHarness();
    const client = await viaProxy({ ARIA_LIVE_URL: `${h.base}/mcp/cohost/${h.config.cohostKey}` }, "claude-ai");
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["live_status", "live_ideas", "live_history", "live_activity_digest"]));
    expect(names).not.toContain("live_claim_task");
    expect(client.getInstructions()).toMatch(/co-host/);
    const ideas = await client.callTool({ name: "live_ideas", arguments: {} });
    expect(ideas.isError).toBeFalsy();
  });

  it("streamer role, when the server has it", async () => {
    h = await startHarness();
    const key = (h.config as { streamerKey?: string }).streamerKey;
    if (!key) return;
    const client = await viaProxy({ ARIA_LIVE_URL: h.base, ARIA_LIVE_ROLE: "streamer", ARIA_LIVE_KEY: key });
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toContain("live_status");
    expect(names.some((n) => /approve/.test(n))).toBe(false);
  });

  it("wrong token and wrong key come back as readable tool errors", async () => {
    h = await startHarness();
    const agent = await viaProxy({ ARIA_LIVE_URL: h.base, ARIA_LIVE_TOKEN: "wrong" });
    expect(textOf(await agent.callTool({ name: "live_status", arguments: {} }))).toMatch(/rejected the agent token \(HTTP 401\)/);
    const cohost = await viaProxy({ ARIA_LIVE_URL: h.base, ARIA_LIVE_ROLE: "cohost", ARIA_LIVE_KEY: "wrong" });
    expect(textOf(await cohost.callTool({ name: "live_status", arguments: {} }))).toMatch(/does not recognise this cohost key/);
  });
});
