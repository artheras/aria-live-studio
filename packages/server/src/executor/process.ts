/** Runs the agent CLI as its own process group and can kill the whole tree. */
import { execFile, spawn, type ChildProcess } from "node:child_process";

const IS_WINDOWS = process.platform === "win32";
const KILL_GRACE_MS = 3000;
const MAX_LINE = 1024 * 1024;

export interface ProcessOutcome {
  code: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  cancelled: boolean;
  spawnError: string | null;
  stderrTail: string;
}

export interface RunProcessOptions {
  bin: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  signal: AbortSignal;
  timeoutMs: number;
  onLine(line: string): void;
}

/** Server-side secrets the agent has no business seeing. */
const HIDDEN_ENV = /^(TWITCH_|SESSION_SECRET$|OVERLAY_KEY$|AGENT_TOKEN$|COHOST_KEY$|STREAMER_KEY$|ARIA_LIVE_TOKEN$)/i;

export function childEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries({ ...process.env, NO_COLOR: "1", ...extra })) {
    if (!HIDDEN_ENV.test(k)) env[k] = v;
  }
  return env;
}

function killTree(child: ChildProcess, sig: NodeJS.Signals): void {
  if (!child.pid) return;
  if (IS_WINDOWS) {
    execFile("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true }, () => {});
    return;
  }
  try {
    process.kill(-child.pid, sig);
  } catch {
    // group already gone
  }
}

export function runProcess(opts: RunProcessOptions): Promise<ProcessOutcome> {
  return new Promise((done) => {
    const outcome: ProcessOutcome = {
      code: null,
      signal: null,
      timedOut: false,
      cancelled: false,
      spawnError: null,
      stderrTail: "",
    };
    let child: ChildProcess;
    try {
      child = spawn(opts.bin, opts.args, {
        cwd: opts.cwd,
        env: opts.env,
        stdio: ["ignore", "pipe", "pipe"],
        detached: !IS_WINDOWS, // own process group, so kill(-pid) reaches grandchildren
        windowsHide: true,
        shell: false,
      });
    } catch (err) {
      outcome.spawnError = (err as Error).message;
      done(outcome);
      return;
    }

    let buffer = "";
    const pushLines = (final: boolean) => {
      let idx: number;
      while ((idx = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, idx).replace(/\r$/, "");
        buffer = buffer.slice(idx + 1);
        if (line.trim()) opts.onLine(line);
      }
      if (buffer.length > MAX_LINE || (final && buffer.trim())) {
        opts.onLine(buffer.slice(0, MAX_LINE));
        buffer = "";
      }
    };
    child.stdout!.setEncoding("utf8");
    child.stdout!.on("data", (chunk: string) => {
      buffer += chunk;
      pushLines(false);
    });
    child.stderr!.setEncoding("utf8");
    child.stderr!.on("data", (chunk: string) => {
      outcome.stderrTail = (outcome.stderrTail + chunk).slice(-2000);
    });

    let forceTimer: NodeJS.Timeout | undefined;
    const stop = (why: "timeout" | "cancel") => {
      if (outcome.timedOut || outcome.cancelled) return;
      if (why === "timeout") outcome.timedOut = true;
      else outcome.cancelled = true;
      killTree(child, "SIGTERM");
      forceTimer = setTimeout(() => killTree(child, "SIGKILL"), KILL_GRACE_MS);
    };
    const onAbort = () => stop("cancel");
    opts.signal.addEventListener("abort", onAbort, { once: true });
    const timeout = setTimeout(() => stop("timeout"), opts.timeoutMs);

    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      clearTimeout(forceTimer);
      opts.signal.removeEventListener("abort", onAbort);
      pushLines(true);
      done(outcome);
    };

    child.once("error", (err) => {
      outcome.spawnError = err.message;
      finish();
    });
    child.once("exit", (code, signal) => {
      outcome.code = code;
      outcome.signal = signal;
      // Clean up anything the agent left running (dev servers, watchers …).
      if (!IS_WINDOWS) killTree(child, "SIGKILL");
      // Wait for stdout to drain, but not forever if a straggler holds the pipe.
      const cap = setTimeout(() => {
        child.stdout?.destroy();
        child.stderr?.destroy();
        finish();
      }, 2000);
      child.once("close", () => {
        clearTimeout(cap);
        finish();
      });
    });
    if (opts.signal.aborted) onAbort();
  });
}

/** `bin --version` exits 0 within 5 s. */
export function binaryWorks(bin: string): Promise<{ ok: boolean; reason?: string }> {
  return new Promise((resolve) => {
    execFile(bin, ["--version"], { timeout: 5000, windowsHide: true, env: childEnv() }, (err) => {
      if (!err) resolve({ ok: true });
      else if ((err as NodeJS.ErrnoException).code === "ENOENT") resolve({ ok: false, reason: `Executable not found: ${bin}` });
      else if (err.killed) resolve({ ok: false, reason: `${bin} --version timed out` });
      else resolve({ ok: false, reason: `${bin} --version failed: ${err.message.split("\n")[0]}` });
    });
  });
}
