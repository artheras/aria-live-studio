import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { REPO_ROOT } from "../src/config.ts";

const SCRIPT = join(REPO_ROOT, "plugin/hooks/report-progress.mjs");

interface Hit {
  path: string;
  auth: string | undefined;
  body: { kind: string; text: string };
}

let server: Server;
let base: string;
let hits: Hit[];
let status: number;
let dir: string;

beforeEach(async () => {
  hits = [];
  status = 204;
  dir = mkdtempSync(join(tmpdir(), "aria-hook-"));
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      hits.push({ path: req.url ?? "", auth: req.headers.authorization, body: JSON.parse(raw) });
      res.writeHead(status).end();
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  rmSync(dir, { recursive: true, force: true });
});

function runHook(input: unknown, env: Record<string, string> = {}, stamp = join(dir, `stamp-${Math.random()}`)) {
  return new Promise<{ code: number | null; stdout: string; ms: number }>((resolve) => {
    const t0 = Date.now();
    const child = spawn(process.execPath, [SCRIPT], {
      env: { PATH: process.env.PATH ?? "", ARIA_LIVE_URL: base, ARIA_LIVE_TOKEN: "tok", ARIA_LIVE_HOOK_STAMP: stamp, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    child.stdout.on("data", (c) => (stdout += c));
    child.on("close", (code) => resolve({ code, stdout, ms: Date.now() - t0 }));
    child.stdin.end(typeof input === "string" ? input : JSON.stringify(input));
  });
}

const bash = (command: string) => ({ hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command } });

describe("progress hook (Claude Code and Codex)", () => {
  it("posts a fixed phrase, never the command text or file contents", async () => {
    const cases: [unknown, string][] = [
      [{ tool_name: "Edit", tool_input: { file_path: "/home/me/game/src/boss.js", old_string: "SECRET_OLD", new_string: "SECRET_NEW" } }, "Edited boss.js"],
      [{ tool_name: "MultiEdit", tool_input: { file_path: "src/hud.ts", edits: [{ old_string: "a", new_string: "SECRET" }] } }, "Edited hud.ts"],
      [{ tool_name: "Write", tool_input: { file_path: "/x/y/test/boss.test.js", content: "SECRET_CONTENT" } }, "Wrote boss.test.js"],
      [{ tool_name: "Write", tool_input: { file_path: "/x/.env.local", content: "API_KEY=SECRET" } }, "Wrote a file"],
      [bash("cd app && npm test -- --grep SECRET"), "Ran tests"],
      [bash("pytest -k SECRET tests/"), "Ran tests"],
      [bash("npx vitest run SECRET"), "Ran tests"],
      [bash("go test ./... SECRET"), "Ran tests"],
      [bash("cargo test SECRET"), "Ran tests"],
      [bash("curl https://example.com/?token=SECRET"), "Ran a command"],
    ];
    for (const [input, text] of cases) {
      const r = await runHook({ hook_event_name: "PostToolUse", ...(input as object) });
      expect(r.code).toBe(0);
      expect(r.stdout).toBe("");
      expect(hits.at(-1)?.body).toEqual({ kind: "tool", text });
    }
    expect(hits).toHaveLength(cases.length);
    expect(hits.every((h) => h.path === "/api/agent/progress/current" && h.auth === "Bearer tok")).toBe(true);
    expect(JSON.stringify(hits)).not.toMatch(/SECRET|curl|example\.com|\/home\/me/);
  });

  it("understands Codex apply_patch and shell calls, without leaking patch contents", async () => {
    const patch = (body: string) => ({ hook_event_name: "PostToolUse", tool_name: "apply_patch", tool_input: { command: body }, tool_response: {} });
    const cases: [unknown, string][] = [
      [patch("*** Begin Patch\n*** Update File: /home/me/game/src/game.js\n@@\n-SECRET_OLD\n+SECRET_NEW\n*** End Patch"), "Edited game.js"],
      [patch("*** Begin Patch\n*** Add File: src/pause.js\n+export const SECRET = 1;\n*** Update File: src/game.js\n@@\n+x\n*** End Patch"), "Added pause.js and 1 more"],
      [patch("*** Begin Patch\n*** Delete File: src/old.js\n*** End Patch"), "Deleted old.js"],
      [patch("*** Begin Patch\n*** Update File: config/.env\n+TOKEN=SECRET\n*** End Patch"), "Edited a file"],
      [{ hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command: "npm test -- SECRET" }, tool_response: {} }, "Ran tests"],
    ];
    for (const [input, text] of cases) {
      const r = await runHook(input);
      expect(r).toMatchObject({ code: 0, stdout: "" });
      expect(hits.at(-1)?.body).toEqual({ kind: "tool", text });
    }
    expect(hits).toHaveLength(cases.length);
    expect(JSON.stringify(hits)).not.toMatch(/SECRET|\/home\/me/);
    // A patch without file headers is skipped.
    await runHook(patch("not a patch"));
    expect(hits).toHaveLength(cases.length);
  });

  it("rate limits to one report per 3 s per stamp file", async () => {
    const stamp = join(dir, "shared-stamp");
    await runHook(bash("ls"), {}, stamp);
    await runHook(bash("ls"), {}, stamp);
    await runHook({ tool_name: "Edit", tool_input: { file_path: "a.js" } }, {}, stamp);
    expect(hits).toHaveLength(1);
  });

  it("does nothing without a token, for other tools, or for bad input", async () => {
    expect((await runHook(bash("npm test"), { ARIA_LIVE_TOKEN: "" })).code).toBe(0);
    expect((await runHook({ tool_name: "Read", tool_input: { file_path: "a.js" } })).code).toBe(0);
    expect((await runHook("not json")).code).toBe(0);
    expect(hits).toHaveLength(0);
  });

  it("exits 0 silently when no task is claimed (409) or the server is down", async () => {
    status = 409;
    const r = await runHook(bash("npm test"));
    expect(r).toMatchObject({ code: 0, stdout: "" });
    expect(hits).toHaveLength(1);
    const down = await runHook(bash("npm test"), { ARIA_LIVE_URL: "http://127.0.0.1:1" });
    expect(down).toMatchObject({ code: 0, stdout: "" });
    expect(down.ms).toBeLessThan(4000);
  });
});
