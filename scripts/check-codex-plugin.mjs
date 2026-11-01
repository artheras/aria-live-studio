#!/usr/bin/env node
/**
 * Installs plugin/ into a real Codex CLI (in a throwaway CODEX_HOME) the way a
 * streamer would, then asks Codex's own app-server what it loaded:
 *
 *   codex plugin marketplace add <this repo>
 *   codex plugin add aria-live@aria-live-studio
 *   app-server: mcpServerStatus/list, hooks/list, skills/list
 *
 * Checks the aria-live MCP server starts and lists exactly the 5 agent
 * tools, the progress hook is registered for PostToolUse with Codex's
 * apply_patch covered by the matcher, and both skills are discovered.
 * No OpenAI account or network access to Twitch is needed.
 *
 *   node scripts/check-codex-plugin.mjs                 # uses `codex` on PATH
 *   CODEX_BIN=/path/to/codex node scripts/check-codex-plugin.mjs
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CODEX = process.env.CODEX_BIN || "codex";
const EXPECTED_TOOLS = ["live_claim_task", "live_complete_task", "live_report_progress", "live_status", "live_wait_for_task"];

let failures = 0;
const check = (ok, what, detail) => {
  if (!ok) failures++;
  console.log(`  ${ok ? "✓" : "✗"} ${what}${!ok && detail !== undefined ? `\n      ${JSON.stringify(detail).slice(0, 600)}` : ""}`);
};

// A home outside /tmp avoids Codex's warning about helper binaries under a temp dir.
const home = mkdtempSync(join(process.env.RUNNER_TEMP || tmpdir(), "aria-codex-"));
const env = {
  ...process.env,
  HOME: home,
  CODEX_HOME: join(home, ".codex"),
  ARIA_LIVE_URL: "http://127.0.0.1:9", // the bridge must start without a reachable server
  ARIA_LIVE_TOKEN: "check-token",
};
mkdirSync(env.CODEX_HOME);
const work = mkdtempSync(join(home, "work-"));

function codex(...args) {
  const r = spawnSync(CODEX, args, { env, encoding: "utf8", cwd: work });
  if (r.error) throw new Error(`cannot run ${CODEX}: ${r.error.message}`);
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

/** Minimal JSON-RPC (JSONL over stdio) client for `codex app-server`. */
function appServer() {
  const p = spawn(CODEX, ["app-server"], { env, cwd: work, stdio: ["pipe", "pipe", "ignore"] });
  let buf = "";
  let id = 0;
  const pending = new Map();
  p.stdout.on("data", (d) => {
    buf += d;
    for (let i; (i = buf.indexOf("\n")) >= 0; ) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      let m;
      try {
        m = JSON.parse(line);
      } catch {
        continue;
      }
      if (m.id !== undefined && pending.has(m.id)) {
        pending.get(m.id)(m);
        pending.delete(m.id);
      }
    }
  });
  const call = (method, params) =>
    new Promise((res, rej) => {
      const n = ++id;
      const t = setTimeout(() => rej(new Error(`${method} timed out`)), 60_000);
      pending.set(n, (m) => {
        clearTimeout(t);
        m.error ? rej(new Error(`${method}: ${JSON.stringify(m.error)}`)) : res(m.result);
      });
      p.stdin.write(`${JSON.stringify({ id: n, method, params })}\n`);
    });
  return {
    call,
    notify: (method) => p.stdin.write(`${JSON.stringify({ method })}\n`),
    close: () => p.kill(),
  };
}

async function main() {
  const version = codex("--version");
  if (version.code !== 0) throw new Error(`codex --version failed: ${version.out}`);
  console.log(`Codex plugin check (${version.out.match(/codex-cli \S+/)?.[0] ?? version.out.trim().split("\n").pop()})`);

  const mk = codex("plugin", "marketplace", "add", ROOT);
  check(mk.code === 0, "repository added as a Codex plugin marketplace", mk.out);
  const add = codex("plugin", "add", "aria-live@aria-live-studio");
  check(add.code === 0 && /Added plugin `aria-live`/.test(add.out), "codex plugin add aria-live@aria-live-studio", add.out);

  const rpc = appServer();
  try {
    await rpc.call("initialize", { clientInfo: { name: "aria-live-check", version: "0" } });
    rpc.notify("initialized");

    const mcp = await rpc.call("mcpServerStatus/list", { serverName: "aria-live", detail: "toolsAndAuthOnly" });
    const server = mcp.data?.find((s) => s.name === "aria-live");
    const tools = Object.keys(server?.tools ?? {}).sort();
    check(server?.pluginId === "aria-live@aria-live-studio", "MCP server comes from the plugin", server);
    check(tools.join(",") === EXPECTED_TOOLS.join(","), "MCP server starts and lists the 5 agent tools", server?.toolsError ?? tools);

    const hooks = (await rpc.call("hooks/list", { cwds: [work] })).data?.flatMap((d) => d.hooks) ?? [];
    const hook = hooks.find((h) => h.pluginId === "aria-live@aria-live-studio");
    check(hook?.eventName === "postToolUse", "progress hook registered for PostToolUse", hooks);
    check(Boolean(hook) && /report-progress\.mjs/.test(hook.command) && !hook.command.includes("${"), "hook command resolved to the installed plugin", hook?.command);
    const matcher = new RegExp(`^(?:${hook?.matcher ?? "$^"})$`);
    check(["Bash", "Write", "Edit"].every((t) => matcher.test(t)), "hook matcher covers Codex's Bash and apply_patch (Write|Edit aliases)", hook?.matcher);

    const skills = await rpc.call("skills/list", { cwds: [work], forceReload: true });
    const names = (skills.data ?? []).flatMap((d) => d.skills ?? []).map((x) => x.name).filter((n) => n.startsWith("aria-live")).sort();
    check(names.join(",") === "aria-live:aria-live,aria-live:aria-live-cohost", "both skills discovered (aria-live:aria-live, aria-live:aria-live-cohost)", names);
  } finally {
    rpc.close();
  }
}

try {
  await main();
} catch (err) {
  failures++;
  console.log(`  ✗ ${err.message}`);
} finally {
  rmSync(home, { recursive: true, force: true });
}
console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
