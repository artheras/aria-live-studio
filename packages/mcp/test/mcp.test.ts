import { createServer as createHttpServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentStatus, AgentTask } from "@aria-live/shared";
import { LiveClient } from "../src/client.ts";
import { createServer } from "../src/server.ts";

const TOKEN = "agent-secret";

const STATUS: AgentStatus = {
  connected: true,
  channel: "streamer",
  phase: "awaiting_approval",
  roundIndex: 3,
  prompt: "Boss fight features",
  ballot: [
    { number: 1, text: "Add a boss fight", votes: 7 },
    { number: 2, text: "Boss reacts to chat", votes: 4 },
  ],
  winner: { number: 1, text: "Add a boss fight", votes: 7 },
  task: { id: "t1", title: "Boss fight", status: "draft" },
  execution: null,
};

const TASK: AgentTask = {
  taskId: "t1",
  roundIndex: 3,
  idea: { text: "Add a boss fight", author: "viewer_a", votes: 7 },
  task: {
    title: "Boss fight",
    summary: "A boss at the end of level 1",
    userStory: "As a player I fight a boss",
    acceptanceCriteria: ["Boss appears", "Boss has health"],
    steps: ["Add Boss class", "Spawn it"],
    risks: [],
    size: "M",
  },
  projectBrief: "A browser game",
  instructions: "Implement: Boss fight",
  claimed: false,
};

interface Recorded {
  method: string;
  path: string;
  auth: string | undefined;
  body: unknown;
}

let http: Server;
let base: string;
let recorded: Recorded[];
let approved: boolean;
let cancelled: boolean;

async function readBody(req: IncomingMessage): Promise<unknown> {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : undefined;
}

beforeEach(async () => {
  recorded = [];
  approved = false;
  cancelled = false;
  http = createHttpServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const body = await readBody(req);
    recorded.push({ method: req.method ?? "", path: url.pathname + url.search, auth: req.headers.authorization, body });
    const json = (status: number, data?: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(data === undefined ? "" : JSON.stringify(data));
    };
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return json(401, { error: "bad token", code: "unauthorized" });
    if (url.pathname === "/api/agent/status") return json(200, STATUS);
    if (url.pathname === "/api/agent/task") {
      if (approved) return json(200, TASK);
      const wait = Number(url.searchParams.get("wait") ?? 0);
      setTimeout(() => (approved ? json(200, TASK) : (res.writeHead(204), res.end())), Math.min(wait, 1) * 50);
      return;
    }
    if (url.pathname === "/api/agent/claim") return json(200, { ...TASK, claimed: true });
    if (url.pathname === "/api/agent/progress" || url.pathname === "/api/agent/complete") {
      if (cancelled) return json(409, { error: "Task was cancelled", code: "cancelled" });
      res.writeHead(204);
      return res.end();
    }
    json(404, { error: "nope", code: "not_found" });
  });
  await new Promise<void>((r) => http.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise<void>((r) => http.close(() => r()));
});

async function connect(token = TOKEN, clientName = "Codex") {
  const server = createServer({ client: new LiveClient({ baseUrl: base, token }) });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: clientName, version: "1.0.0" });
  await client.connect(clientTransport);
  return client;
}

function textOf(result: Awaited<ReturnType<Client["callTool"]>>): string {
  return (result.content as { type: string; text: string }[]).map((c) => c.text).join("\n");
}

describe("aria-live MCP server", () => {
  it("lists exactly the agent tools — there is no approve tool", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "live_claim_task",
      "live_complete_task",
      "live_report_progress",
      "live_status",
      "live_wait_for_task",
    ]);
  });

  it("describes the round and sends the bearer token", async () => {
    const client = await connect();
    const result = await client.callTool({ name: "live_status", arguments: {} });
    expect(textOf(result)).toContain("1. Add a boss fight — 7 vote(s)");
    expect(textOf(result)).toContain("Task: Boss fight [draft] id=t1");
    expect(recorded[0]?.auth).toBe(`Bearer ${TOKEN}`);
  });

  it("waits, then hands over the approved task", async () => {
    const client = await connect();
    const none = await client.callTool({ name: "live_wait_for_task", arguments: { timeout_seconds: 0 } });
    expect(textOf(none)).toContain("No approved task yet");
    approved = true;
    const got = await client.callTool({ name: "live_wait_for_task", arguments: { timeout_seconds: 5 } });
    expect(textOf(got)).toContain("Task t1");
    expect(textOf(got)).toContain("call live_claim_task before starting");
  });

  it("claims with the host's name and reports progress and completion", async () => {
    const client = await connect(TOKEN, "Claude Code");
    await client.callTool({ name: "live_claim_task", arguments: { task_id: "t1" } });
    await client.callTool({ name: "live_report_progress", arguments: { task_id: "t1", text: "Added Boss class" } });
    await client.callTool({
      name: "live_complete_task",
      arguments: { task_id: "t1", status: "succeeded", summary: "Boss added", changed_files: ["src/boss.ts"] },
    });
    const bodies = recorded.map((r) => [r.path, r.body]);
    expect(bodies).toEqual([
      ["/api/agent/claim", { taskId: "t1", client: "Claude Code" }],
      ["/api/agent/progress", { taskId: "t1", kind: "status", text: "Added Boss class" }],
      [
        "/api/agent/complete",
        { taskId: "t1", status: "succeeded", summary: "Boss added", changedFiles: ["src/boss.ts"] },
      ],
    ]);
  });

  it("tells the agent to stop when the streamer cancelled", async () => {
    const client = await connect();
    cancelled = true;
    const result = await client.callTool({ name: "live_report_progress", arguments: { task_id: "t1", text: "x" } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("The streamer cancelled this task");
  });

  it("explains a bad token and an unreachable server", async () => {
    const bad = await connect("wrong");
    const result = await bad.callTool({ name: "live_status", arguments: {} });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("rejected the agent token");

    const down = createServer({ client: new LiveClient({ baseUrl: "http://127.0.0.1:1", token: TOKEN }) });
    const [c, s] = InMemoryTransport.createLinkedPair();
    await down.connect(s);
    const client = new Client({ name: "x", version: "1" });
    await client.connect(c);
    const unreachable = await client.callTool({ name: "live_status", arguments: {} });
    expect(textOf(unreachable)).toContain("Cannot reach Aria Live");
  });

  it("rejects out-of-range arguments before calling the server", async () => {
    const client = await connect();
    const result = await client.callTool({
      name: "live_report_progress",
      arguments: { task_id: "t1", text: "x".repeat(201) },
    });
    expect(result.isError).toBe(true);
    expect(recorded).toHaveLength(0);
  });
});
