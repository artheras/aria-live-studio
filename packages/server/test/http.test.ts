import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import type { LiveState, ServerMessage } from "@aria-live/shared";
import { overlaySnapshot } from "../src/http/redact.ts";
import { chatEvent, makeEngine, plan, user } from "./helpers.ts";
import { PUBLIC_URL, startHarness, waitFor, type Harness } from "./harness.ts";

let h: Harness | null = null;
afterEach(async () => {
  await h?.close();
  h = null;
});

function wsConnect(url: string, headers: Record<string, string> = {}) {
  return new Promise<{ ws: WebSocket; messages: ServerMessage[] }>((resolve, reject) => {
    const ws = new WebSocket(url, { headers });
    const messages: ServerMessage[] = [];
    ws.on("message", (d) => messages.push(JSON.parse(d.toString()) as ServerMessage));
    ws.on("open", () => resolve({ ws, messages }));
    ws.on("unexpected-response", (_req, res) => reject(new Error(`status ${res.statusCode}`)));
    ws.on("error", reject);
  });
}

function rawGet(base: string, path: string): Promise<{ status: number; body: string; type: string }> {
  const u = new URL(base);
  return new Promise((resolve, reject) => {
    const req = request({ host: u.hostname, port: u.port, path, method: "GET" }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode!, body, type: String(res.headers["content-type"]) }));
    });
    req.on("error", reject);
    req.end();
  });
}

describe("HTTP auth, CSRF and origin", () => {
  it("requires a session for /api/*", async () => {
    h = await startHarness({}, { login: false });
    expect((await fetch(`${h.base}/api/state`)).status).toBe(401);
    expect((await fetch(`${h.base}/api/round/open`, { method: "POST" })).status).toBe(401);
    const err = await (await fetch(`${h.base}/api/history`)).json();
    expect(err).toEqual({ error: expect.any(String), code: "unauthorized" });
    expect((await fetch(`${h.base}/healthz`)).status).toBe(200);
  });

  it("requires x-aria-csrf and an allowed Origin on mutations", async () => {
    h = await startHarness();
    expect((await h.api("POST", "/api/round/open", {}, { "x-aria-csrf": "wrong" })).status).toBe(403);
    const noCsrf = await fetch(`${h.base}/api/round/open`, { method: "POST", headers: { cookie: h.cookie, "content-type": "application/json" }, body: "{}" });
    expect(noCsrf.status).toBe(403);
    const evil = await h.api("POST", "/api/round/open", {}, { origin: "https://evil.example" });
    expect(evil.status).toBe(403);
    expect((await evil.json()).code).toBe("bad_origin");
    expect((await h.api("POST", "/api/round/open", { prompt: "boss fight" }, { origin: PUBLIC_URL })).status).toBe(200);
    expect((await h.api("POST", "/api/round/reset", {}, { origin: "http://localhost:5173" })).status).toBe(200);
    // GET needs no csrf
    expect((await fetch(`${h.base}/api/state`, { headers: { cookie: h.cookie } })).status).toBe(200);
  });

  it("maps errors: 409 wrong_phase, 400 bad input, 404, 413", async () => {
    h = await startHarness();
    const r = await h.api("POST", "/api/round/close", {});
    expect(r.status).toBe(409);
    expect(((await r.json()) as { code: string }).code).toBe("no_round");
    await h.api("POST", "/api/round/open", {});
    const wp = await h.api("POST", "/api/round/close", {});
    expect(wp.status).toBe(409);
    expect(((await wp.json()) as { code: string }).code).toBe("wrong_phase");
    expect((await h.api("PATCH", "/api/settings", { maxCandidates: "lots" })).status).toBe(400);
    expect((await h.api("POST", "/api/round/open", { prompt: 5 })).status).toBe(400);
    expect((await h.api("POST", "/api/ideas/nope/hide", { hidden: true })).status).toBe(404);
    expect((await h.api("GET", "/api/nothing")).status).toBe(404);
    const big = await h.api("PATCH", "/api/settings", { x: "a".repeat(70_000) });
    expect(big.status).toBe(413);
    const badJson = await fetch(`${h.base}/api/settings`, {
      method: "PATCH",
      headers: { cookie: h.cookie, "x-aria-csrf": h.csrf, "content-type": "application/json" },
      body: "{nope",
    });
    expect(badJson.status).toBe(400);
    expect(((await badJson.json()) as { code: string }).code).toBe("bad_json");
  });

  it("returns the overlay URL and agent connection info", async () => {
    h = await startHarness();
    const o = (await (await h.api("GET", "/api/overlay-url")).json()) as { url: string };
    expect(o.url).toBe(`${PUBLIC_URL}/overlay?key=${encodeURIComponent(h.config.overlayKey)}`);
    const a = (await (await h.api("GET", "/api/agent-connection")).json()) as { token: string; mcpUrl: string; mcpCommand: { command: string; args: string[] } };
    expect(a.token).toBe(h.config.agentToken);
    expect(a.mcpUrl).toBe(PUBLIC_URL);
    expect(a.mcpCommand.command).toBe("node");
    expect(a.mcpCommand.args[0]).toMatch(/\/plugin\/mcp\/aria-live-mcp\.mjs$/);
  });
});

describe("WebSocket", () => {
  it("overlay needs the key; dashboard needs the session", async () => {
    h = await startHarness();
    const wsBase = h.base.replace("http", "ws");
    await expect(wsConnect(`${wsBase}/ws?role=overlay&key=wrong`)).rejects.toThrow(/401/);
    await expect(wsConnect(`${wsBase}/ws?role=dashboard`)).rejects.toThrow(/401/);
    await expect(wsConnect(`${wsBase}/ws?role=dashboard`, { cookie: h.cookie, origin: "https://evil.example" })).rejects.toThrow(/403/);
    await expect(wsConnect(`${wsBase}/ws?role=nope`)).rejects.toThrow(/400/);

    const dash = await wsConnect(`${wsBase}/ws?role=dashboard`, { cookie: h.cookie });
    const ov = await wsConnect(`${wsBase}/ws?role=overlay&key=${encodeURIComponent(h.config.overlayKey)}`);
    await waitFor(() => dash.messages.length >= 2 && ov.messages.length >= 2);
    expect(dash.messages[0]).toMatchObject({ type: "hello", role: "dashboard" });
    expect(ov.messages[0]).toMatchObject({ type: "hello", role: "overlay" });
    expect(ov.messages[1]!.type).toBe("snapshot");

    await h.api("POST", "/api/round/open", { prompt: "go" });
    h.service.handleChat(chatEvent("!idea secret hidden thing", { login: "a" }));
    h.service.handleChat(chatEvent("!idea visible idea", { login: "b" }));
    const hiddenId = h.service.engine.round!.ideas[0]!.id;
    await h.api("POST", `/api/ideas/${hiddenId}/hide`, { hidden: true });
    await waitFor(() => {
      const last = ov.messages.at(-1);
      return last?.type === "snapshot" && last.state.round?.ideas.length === 1;
    });
    const last = ov.messages.at(-1) as { state: LiveState };
    expect(last.state.activity).toEqual([]);
    expect(last.state.round!.ideas[0]!.text).toBe("visible idea");
    const dlast = dash.messages.at(-1) as { state: LiveState };
    expect(dlast.state.round!.ideas).toHaveLength(2);
    expect(dlast.state.activity.length).toBeGreaterThan(0);
    dash.ws.close();
    ov.ws.close();
  });

  it("throttles broadcasts to at most ~10/s", async () => {
    h = await startHarness();
    await h.api("POST", "/api/round/open", {});
    await h.api("PATCH", "/api/settings", { ideaCooldownSec: 0 });
    const ov = await wsConnect(`${h.base.replace("http", "ws")}/ws?role=overlay&key=${encodeURIComponent(h.config.overlayKey)}`);
    await waitFor(() => ov.messages.length >= 2);
    const before = ov.messages.length;
    for (let i = 0; i < 50; i++) h.service.handleChat(chatEvent(`!idea number ${i} ${"z".repeat(i)}`, { login: `v${i}` }));
    await new Promise((r) => setTimeout(r, 250));
    const got = ov.messages.length - before;
    expect(got).toBeGreaterThanOrEqual(1);
    expect(got).toBeLessThanOrEqual(4);
    const last = ov.messages.at(-1) as { state: LiveState };
    expect(last.state.round!.ideas).toHaveLength(50);
    ov.ws.close();
  });
});

describe("overlay redaction", () => {
  it("strips activity, hidden ideas, old steps, workdir and connection internals", () => {
    const { engine } = makeEngine();
    engine.updateSettings({ ideaCooldownSec: 0 });
    engine.openRound();
    engine.submitIdea(user("a"), "first");
    engine.submitIdea(user("b"), "second");
    engine.hideIdea(engine.round!.ideas[1]!.id, true);
    engine.startVote();
    engine.castVote(user("c"), 1);
    engine.closeVote();
    engine.beginPlanning();
    engine.setTask(plan);
    engine.rejectTask("streamer", "private note");
    engine.beginPlanning();
    engine.setTask(plan);
    engine.approveTask("streamer");
    engine.beginExecution("x");
    for (let i = 0; i < 20; i++) engine.appendExecutionStep({ at: i, kind: "tool", text: `step ${i}` });
    engine.finishExecution({ status: "succeeded", branch: "aria/1", workdir: "/home/me/secret", changedFiles: [], summary: null, error: null });
    engine.setConnection({ sessionId: "sess", error: "boom" });
    const o = overlaySnapshot(engine.state);
    expect(o.activity).toEqual([]);
    expect(o.round!.ideas.map((i) => i.text)).toEqual(["first"]);
    expect(o.round!.execution!.workdir).toBeNull();
    expect(o.round!.execution!.steps.map((s) => s.text)).toEqual(Array.from({ length: 8 }, (_, i) => `step ${12 + i}`));
    expect(o.connection.sessionId).toBeNull();
    expect(o.connection.error).toBeNull();
    // the live state is untouched
    expect(engine.state.round!.execution!.workdir).toBe("/home/me/secret");
    expect(engine.state.activity.length).toBeGreaterThan(0);
  });
});

describe("full loop through chat + REST", () => {
  it("idea → vote → plan → approve → execute → done, with chat replies and history", async () => {
    h = await startHarness();
    await h.api("PATCH", "/api/settings", { ideaCooldownSec: 0, voteDurationSec: 0, executorEnabled: true });
    await h.api("POST", "/api/round/open", { prompt: "boss fight" });
    h.service.handleChat(chatEvent("!idea add dark mode", { login: "alice" }));
    h.service.handleChat(chatEvent("!idea add a leaderboard", { login: "bob" }));
    h.service.handleChat(chatEvent("!IDEA Add dark mode!", { login: "carol" }));
    h.service.handleChat(chatEvent("[Aria] !idea fake", { login: "streamer" }));
    expect(h.service.engine.round!.ideas).toHaveLength(2);
    expect(h.service.engine.round!.ideas[0]!.seconds).toBe(1);
    await waitFor(() => h!.twitch.chatMessages().length >= 1);
    expect(h.twitch.chatMessages()[0]).toBe("[Aria] Idea #1 from @alice added");

    expect((await h.api("POST", "/api/round/vote", {})).status).toBe(200);
    h.service.handleChat(chatEvent("!vote 1", { login: "x1" }));
    h.service.handleChat(chatEvent("!vote #1", { login: "x2" }));
    h.service.handleChat(chatEvent("!vote 2", { login: "x3" }));
    expect((await h.api("POST", "/api/round/close", {})).status).toBe(200);
    const st = h.service.engine.round!;
    expect(st.ideas.find((i) => i.id === st.winnerId)!.text).toBe("add dark mode");

    // planner failure → 502, back to decided
    h.planner.fail = new Error("model down");
    const pf = await h.api("POST", "/api/task/plan", {});
    expect(pf.status).toBe(502);
    expect(h.service.engine.round!.phase).toBe("decided");
    h.planner.fail = null;

    const planned = await h.api("POST", "/api/task/plan", {});
    expect(planned.status).toBe(200);
    expect(h.planner.inputs.at(-1)!.otherIdeas).toEqual(["add a leaderboard"]);
    expect(h.service.engine.round!.phase).toBe("awaiting_approval");
    expect((await h.api("POST", "/api/execution/start", {})).status).toBe(409);
    expect((await h.api("PATCH", "/api/task", { title: "Dark mode toggle" })).status).toBe(200);
    expect((await h.api("POST", "/api/task/approve", {})).status).toBe(200);
    expect(h.service.engine.round!.task!.decidedBy).toBe("streamer");

    const ex = await h.api("POST", "/api/execution/start", {});
    expect(ex.status).toBe(200);
    await waitFor(() => h!.executor.release !== null);
    expect(h.service.engine.round!.phase).toBe("executing");
    h.executor.release!({ status: "succeeded", branch: "aria/round-1", workdir: "/tmp/w", changedFiles: ["src/a.ts"], summary: "Added it", error: null });
    await waitFor(() => h!.service.engine.round!.phase === "done");
    expect(h.service.engine.round!.execution!.status).toBe("succeeded");

    expect((await h.api("POST", "/api/round/reset", {})).status).toBe(200);
    await waitFor(async () => ((await (await h!.api("GET", "/api/history")).json()) as unknown[]).length === 1);
    const hist = (await (await h.api("GET", "/api/history")).json()) as { winner: { text: string }; execution: { status: string } }[];
    expect(hist[0]!.winner.text).toBe("add dark mode");
    expect(hist[0]!.execution.status).toBe("succeeded");
  });

  it("refuses execution when the executor is disabled or unavailable, and cancel aborts", async () => {
    h = await startHarness();
    const eng = h.service.engine;
    eng.updateSettings({ ideaCooldownSec: 0, voteDurationSec: 0 });
    eng.openRound();
    eng.submitIdea(user("a"), "thing");
    eng.startVote();
    eng.castVote(user("b"), 1);
    eng.closeVote();
    await h.api("POST", "/api/task/plan", {});
    await h.api("POST", "/api/task/approve", {});
    const dis = await h.api("POST", "/api/execution/start", {});
    expect(dis.status).toBe(409);
    expect(((await dis.json()) as { code: string }).code).toBe("executor_disabled");
    eng.updateSettings({ executorEnabled: true });
    h.executor.ok = false;
    expect((await h.api("POST", "/api/execution/start", {})).status).toBe(502);
    h.executor.ok = true;
    expect((await h.api("POST", "/api/execution/start", {})).status).toBe(200);
    expect((await h.api("POST", "/api/execution/cancel", {})).status).toBe(200);
    await waitFor(() => eng.round!.phase === "done");
    expect(eng.round!.execution!.status).toBe("cancelled");
  });

  it("reset during planning aborts the planner", async () => {
    h = await startHarness();
    const eng = h.service.engine;
    eng.updateSettings({ voteDurationSec: 0 });
    eng.openRound();
    eng.submitIdea(user("a"), "thing");
    eng.startVote();
    eng.castVote(user("b"), 1);
    eng.closeVote();
    h.planner.delayMs = 200;
    const p = h.api("POST", "/api/task/plan", {});
    await waitFor(() => eng.round?.phase === "planning");
    expect((await h.api("POST", "/api/round/reset", {})).status).toBe(200);
    expect(h.planner.inputs[0]!.signal.aborted).toBe(true);
    expect((await p).status).toBe(409);
    expect(eng.round).toBeNull();
  });

  it("auto-closes a timed vote via the server tick", async () => {
    h = await startHarness();
    const eng = h.service.engine;
    eng.updateSettings({ voteDurationSec: 1 });
    eng.openRound();
    eng.submitIdea(user("a"), "thing");
    eng.startVote();
    await waitFor(() => eng.round!.phase === "decided", 3000);
  });
});

describe("static files", () => {
  it("serves the SPA with MIME types and blocks traversal", async () => {
    const dist = mkdtempSync(join(tmpdir(), "aria-dist-"));
    mkdirSync(join(dist, "assets"));
    writeFileSync(join(dist, "index.html"), "<!doctype html><title>app</title>");
    writeFileSync(join(dist, "assets", "app.js"), "console.log(1)");
    writeFileSync(join(dist, "..", "aria-secret.txt"), "TOP SECRET");
    h = await startHarness({}, { webDist: dist, login: false });
    for (const p of ["/", "/overlay", "/history"]) {
      const r = await rawGet(h.base, p);
      expect(r.status).toBe(200);
      expect(r.type).toMatch(/text\/html/);
    }
    const js = await rawGet(h.base, "/assets/app.js");
    expect(js.type).toMatch(/javascript/);
    for (const p of ["/../aria-secret.txt", "/..%2faria-secret.txt", "/%2e%2e/aria-secret.txt", "/assets/../../aria-secret.txt"]) {
      const r = await rawGet(h.base, p);
      expect(r.body).not.toContain("TOP SECRET");
    }
    expect((await rawGet(h.base, "/assets/missing.js")).status).toBe(404);
  });
});
