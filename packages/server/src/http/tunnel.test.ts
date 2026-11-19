import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcess } from "node:child_process";
import { describe, expect, it } from "vitest";
import { extractTunnelUrl, TunnelManager } from "./tunnel.ts";

describe("extractTunnelUrl", () => {
  it("parses trycloudflare.com HTTPS URLs from log lines", () => {
    expect(extractTunnelUrl("INF |  https://amber-fox-123.trycloudflare.com  |")).toBe(
      "https://amber-fox-123.trycloudflare.com",
    );
    expect(extractTunnelUrl("no url here")).toBeNull();
  });
});

describe("TunnelManager", () => {
  it("reports unavailable when cloudflared is missing", async () => {
    const mgr = new TunnelManager(3000, undefined, false);
    const st = await mgr.start(100);
    expect(st.available).toBe(false);
    expect(st.running).toBe(false);
    expect(st.error).toMatch(/cloudflared/);
  });

  it("captures the HTTPS URL from stderr and cleans up on stop", async () => {
    const fakeProc = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      killed: false,
      kill() {
        this.killed = true;
        return true;
      },
    }) as unknown as ChildProcess & { stderr: PassThrough; killed: boolean };

    const mgr = new TunnelManager(3000, (() => fakeProc) as never, true);
    const startPromise = mgr.start(2000);
    fakeProc.stderr.emit("data", Buffer.from("2026-11-19 INF +---+\nhttps://demo-live-99.trycloudflare.com\n"));

    const st = await startPromise;
    expect(st).toEqual({
      available: true,
      running: true,
      url: "https://demo-live-99.trycloudflare.com",
      error: null,
    });

    const stopped = mgr.stop();
    expect(stopped.running).toBe(false);
    expect(stopped.url).toBeNull();
    expect(fakeProc.killed).toBe(true);
  });
});
