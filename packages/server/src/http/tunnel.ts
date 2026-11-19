/**
 * Optional one-click `cloudflared` quick-tunnel manager so streamers can expose
 * their local server to mobile/cloud chat apps (ChatGPT / Claude) over HTTPS
 * without editing `.env` or restarting the server.
 */
import { execFileSync, spawn, type ChildProcess } from "node:child_process";

export interface TunnelStatus {
  available: boolean;
  running: boolean;
  url: string | null;
  error: string | null;
}

const TRY_CLOUDFLARE_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;

export function extractTunnelUrl(chunk: string): string | null {
  const match = TRY_CLOUDFLARE_RE.exec(chunk);
  return match ? match[0] : null;
}

export function isCloudflaredAvailable(): boolean {
  try {
    execFileSync("cloudflared", ["--version"], { stdio: "ignore", timeout: 2000 });
    return true;
  } catch {
    return false;
  }
}

export class TunnelManager {
  private child: ChildProcess | null = null;
  private url: string | null = null;
  private error: string | null = null;
  private readonly availableCache: boolean;

  constructor(
    private readonly localPort: number,
    private readonly spawnImpl: typeof spawn = spawn,
    available?: boolean,
  ) {
    this.availableCache = available ?? isCloudflaredAvailable();
  }

  status(): TunnelStatus {
    return {
      available: this.availableCache,
      running: Boolean(this.child && !this.child.killed),
      url: this.url,
      error: this.error,
    };
  }

  async start(timeoutMs = 15_000): Promise<TunnelStatus> {
    if (this.child && !this.child.killed && this.url) return this.status();
    if (!this.availableCache) {
      this.error = "cloudflared binary not found on PATH";
      return this.status();
    }
    this.stop();
    this.error = null;

    const proc = this.spawnImpl("cloudflared", ["tunnel", "--url", `http://localhost:${this.localPort}`], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.child = proc;

    return new Promise<TunnelStatus>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(this.status());
      };

      const timer = setTimeout(() => {
        if (!this.url) {
          this.error = "Timed out waiting for cloudflared HTTPS URL";
          this.stop();
        }
        finish();
      }, timeoutMs);

      const onData = (buf: Buffer) => {
        const found = extractTunnelUrl(buf.toString("utf8"));
        if (found) {
          this.url = found;
          this.error = null;
          finish();
        }
      };

      proc.stdout?.on("data", onData);
      proc.stderr?.on("data", onData);
      proc.on("error", (err) => {
        this.error = err.message;
        this.child = null;
        this.url = null;
        finish();
      });
      proc.on("exit", (code) => {
        if (this.child === proc) {
          this.child = null;
          if (!this.url && code !== 0) {
            this.error = `cloudflared exited with code ${code ?? "?"}`;
          }
          this.url = null;
          finish();
        }
      });
    });
  }

  stop(): TunnelStatus {
    if (this.child) {
      const proc = this.child;
      this.child = null;
      this.url = null;
      try {
        proc.kill("SIGTERM");
      } catch {
        // Ignore already-exited processes.
      }
    }
    this.url = null;
    return this.status();
  }
}
