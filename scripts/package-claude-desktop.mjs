#!/usr/bin/env node
/**
 * Builds the Claude Desktop MCP Bundle: dist/aria-live.mcpb
 *
 *   1. esbuild packages/mcp/src/proxy-main.ts into one file (no node_modules)
 *   2. stage bundles/claude-desktop/manifest.json + server/aria-live-proxy.mjs + LICENSE
 *   3. smoke-test the staged server over stdio from a temp dir (self-contained,
 *      clear error when Aria Live is unreachable)
 *   4. mcpb validate + mcpb pack (npx @anthropic-ai/mcpb@2)
 *
 *   node scripts/package-claude-desktop.mjs [--skip-build] [--out=dist/aria-live.mcpb]
 */
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const out = resolve(ROOT, args.find((a) => a.startsWith("--out="))?.slice(6) ?? "dist/aria-live.mcpb");
const stage = join(ROOT, "dist", "claude-desktop");
const MCPB = ["-y", "@anthropic-ai/mcpb@2"];
const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

function run(cmd, argv, opts = {}) {
  const r = spawnSync(cmd, argv, { cwd: ROOT, stdio: "inherit", ...opts });
  if (r.status !== 0) {
    console.error(`✗ ${cmd} ${argv.join(" ")} exited with ${r.status}`);
    process.exit(1);
  }
}

/** Starts the bundled server in an empty temp dir and checks it answers over stdio. */
async function smokeTest(entry) {
  const dir = mkdtempSync(join(tmpdir(), "aria-live-mcpb-"));
  // A loopback port nobody listens on, so the proxy must explain that it cannot connect.
  const port = await new Promise((res) => {
    const s = createServer().listen(0, "127.0.0.1", () => {
      const p = s.address().port;
      s.close(() => res(p));
    });
  });
  try {
    copyFileSync(entry, join(dir, "aria-live-proxy.mjs"));
    const child = spawn(process.execPath, [join(dir, "aria-live-proxy.mjs")], {
      cwd: dir,
      env: { PATH: process.env.PATH ?? "", ARIA_LIVE_URL: `http://127.0.0.1:${port}`, ARIA_LIVE_ROLE: "cohost", ARIA_LIVE_KEY: "smoke" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    const send = (m) => child.stdin.write(`${JSON.stringify(m)}\n`);
    const reply = (id) =>
      new Promise((res, rej) => {
        const timer = setTimeout(() => rej(new Error(`no reply to ${id}; stderr: ${stderr}`)), 20_000);
        const check = () => {
          for (const line of stdout.split("\n")) {
            if (!line.trim()) continue;
            const msg = JSON.parse(line);
            if (msg.id === id) {
              clearTimeout(timer);
              child.stdout.off("data", check);
              return res(msg);
            }
          }
        };
        child.stdout.on("data", check);
        check();
      });
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "smoke", version: "0" } } });
    const init = await reply(1);
    if (init.result?.serverInfo?.name !== "aria-live") throw new Error(`bad initialize: ${JSON.stringify(init)}`);
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "live_status", arguments: {} } });
    const call = await reply(2);
    const text = call.result?.content?.[0]?.text ?? "";
    child.kill();
    if (!call.result?.isError || !text.startsWith(`Cannot reach Aria Live at http://127.0.0.1:${port} (ECONNREFUSED)`)) {
      throw new Error(`unexpected tools/call answer: ${JSON.stringify(call)}`);
    }
    console.log(`✓ bundled server runs standalone and reports: ${text}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (!args.includes("--skip-build")) run(npm, ["run", "build:proxy", "--workspace", "@aria-live/mcp"]);
const entry = join(ROOT, "packages", "mcp", "dist", "aria-live-proxy.mjs");
if (!existsSync(entry)) {
  console.error(`✗ ${entry} is missing (run without --skip-build)`);
  process.exit(1);
}

rmSync(stage, { recursive: true, force: true });
mkdirSync(join(stage, "server"), { recursive: true });
const manifest = JSON.parse(readFileSync(join(ROOT, "bundles", "claude-desktop", "manifest.json"), "utf8"));
const plugin = JSON.parse(readFileSync(join(ROOT, "plugin", ".claude-plugin", "plugin.json"), "utf8"));
if (manifest.version !== plugin.version) {
  console.error(`✗ bundles/claude-desktop/manifest.json version ${manifest.version} ≠ plugin version ${plugin.version}`);
  process.exit(1);
}
writeFileSync(join(stage, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
cpSync(entry, join(stage, manifest.server.entry_point));
copyFileSync(join(ROOT, "LICENSE"), join(stage, "LICENSE"));
for (const extra of ["icon.png"]) {
  const p = join(ROOT, "bundles", "claude-desktop", extra);
  if (existsSync(p)) copyFileSync(p, join(stage, extra));
}

await smokeTest(join(stage, manifest.server.entry_point));

run(npx, [...MCPB, "validate", join(stage, "manifest.json")]);
mkdirSync(dirname(out), { recursive: true });
rmSync(out, { force: true });
run(npx, [...MCPB, "pack", stage, out]);
console.log(`✓ ${out} (${Math.round(statSync(out).size / 1024)} KiB)`);
