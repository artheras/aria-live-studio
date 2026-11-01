#!/usr/bin/env node
/**
 * Claude Code PostToolUse hook: tells the stream overlay what the agent just
 * did ("Edited game.js", "Ran tests") while it holds an Aria Live task.
 *
 * - Runs only if ARIA_LIVE_TOKEN is set; posts to ARIA_LIVE_URL
 *   (default http://localhost:3000) /api/agent/progress/current, which
 *   answers 409 when no task is claimed by an MCP agent.
 * - Never sends command text or file contents: only a fixed phrase and a
 *   file's base name.
 * - At most one report per 3 s (timestamp file in the temp dir), 2 s
 *   network timeout, no stdout, always exits 0 — it never blocks the agent.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

const MIN_INTERVAL_MS = 3000;
const TIMEOUT_MS = 2000;

// Hard stop: whatever happens, do not hold the agent up.
setTimeout(() => process.exit(0), TIMEOUT_MS + 1500).unref();

const TEST_RUNNER =
  /(^|[\s;&|(])(npm|pnpm|yarn|bun)\s+(run\s+)?test\b|\b(npx\s+)?(vitest|jest|mocha|ava|playwright\s+test)\b|\bpytest\b|\bpython3?\s+-m\s+(pytest|unittest)\b|\bgo\s+test\b|\bcargo\s+(test|nextest)\b|\bdotnet\s+test\b|\bmvn\b.*\btest\b|\bgradlew?\b.*\btest\b|\bmix\s+test\b|\brspec\b|\bphpunit\b|\bdeno\s+test\b|\bmake\s+(test|check)\b/;

const SENSITIVE = /^\.env|secret|token|credential|password|\.pem$|\.key$|id_rsa/i;

function fileName(path) {
  if (typeof path !== "string" || !path) return "a file";
  const name = basename(path).replace(/[^\w.@+-]/g, "");
  if (!name || SENSITIVE.test(name)) return "a file";
  return name.length > 60 ? `${name.slice(0, 59)}…` : name;
}

/** The one line shown on stream for a tool call, or null to skip it. */
function describe(input) {
  const tool = input?.tool_name;
  const args = input?.tool_input ?? {};
  if (tool === "Edit" || tool === "MultiEdit") return `Edited ${fileName(args.file_path)}`;
  if (tool === "Write") return `Wrote ${fileName(args.file_path)}`;
  if (tool === "Bash") return TEST_RUNNER.test(String(args.command ?? "")) ? "Ran tests" : "Ran a command";
  return null;
}

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) {
    chunks.push(c);
    if (chunks.reduce((n, b) => n + b.length, 0) > 4 * 1024 * 1024) break;
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function main() {
  const token = (process.env.ARIA_LIVE_TOKEN ?? "").trim();
  if (!token) return;
  const base = (process.env.ARIA_LIVE_URL || "http://localhost:3000").replace(/\/+$/, "");
  let input;
  try {
    input = JSON.parse(await readStdin());
  } catch {
    return;
  }
  const text = describe(input);
  if (!text) return;

  const stamp =
    process.env.ARIA_LIVE_HOOK_STAMP ||
    join(tmpdir(), `aria-live-hook-${createHash("sha256").update(base).digest("hex").slice(0, 12)}`);
  const now = Date.now();
  try {
    const last = Number(readFileSync(stamp, "utf8"));
    if (Number.isFinite(last) && now - last >= 0 && now - last < MIN_INTERVAL_MS) return;
  } catch {
    // no stamp yet
  }
  try {
    writeFileSync(stamp, String(now));
  } catch {
    // unwritable temp dir: still report, just without the client-side limit
  }

  await fetch(`${base}/api/agent/progress/current`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ kind: "tool", text }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

main()
  .catch(() => {})
  .finally(() => process.exit(0));
