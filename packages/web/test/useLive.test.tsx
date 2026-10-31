import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { useLive, type LiveResult } from "../src/lib/useLive";
import { makeState } from "./fixtures";

class FakeWS {
  static instances: FakeWS[] = [];
  url: string;
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  closed = false;
  constructor(url: string) {
    this.url = url;
    FakeWS.instances.push(this);
  }
  open() {
    this.onopen?.({});
  }
  send(msg: unknown) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
  drop() {
    this.onclose?.({});
  }
  close() {
    this.closed = true;
  }
}

let latest: LiveResult;
function Probe({ role, k }: { role: "dashboard" | "overlay"; k?: string }) {
  latest = useLive(role, { key: k, WebSocketImpl: FakeWS as unknown as typeof WebSocket, baseDelayMs: 100, maxDelayMs: 1000 });
  return null;
}

describe("useLive", () => {
  beforeEach(() => {
    FakeWS.instances = [];
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("builds the overlay URL with the key", () => {
    render(<Probe role="overlay" k="abc" />);
    expect(FakeWS.instances[0]!.url).toMatch(/\/ws\?role=overlay&key=abc$/);
  });

  it("receives snapshots, ignores unknown messages, and reconnects with backoff", () => {
    render(<Probe role="dashboard" />);
    expect(FakeWS.instances).toHaveLength(1);
    const first = FakeWS.instances[0]!;
    expect(first.url).toMatch(/role=dashboard/);

    act(() => {
      first.open();
      first.send({ type: "hello", role: "dashboard", serverTime: Date.now() + 5000 });
      first.send({ type: "ping" });
      first.send({ type: "snapshot", state: makeState(null) });
    });
    expect(latest.status).toBe("open");
    expect(latest.state?.stats.rounds).toBe(3);
    expect(latest.clockOffset).toBeGreaterThan(4000);

    act(() => first.drop());
    expect(latest.status).toBe("reconnecting");
    expect(latest.state).not.toBeNull(); // keep showing the last snapshot

    act(() => vi.advanceTimersByTime(50));
    expect(FakeWS.instances).toHaveLength(1);
    act(() => vi.advanceTimersByTime(200));
    expect(FakeWS.instances).toHaveLength(2);

    // Second failure waits longer (exponential).
    act(() => FakeWS.instances[1]!.drop());
    act(() => vi.advanceTimersByTime(150));
    expect(FakeWS.instances).toHaveLength(2);
    act(() => vi.advanceTimersByTime(200));
    expect(FakeWS.instances).toHaveLength(3);

    act(() => {
      FakeWS.instances[2]!.open();
      FakeWS.instances[2]!.send({ type: "snapshot", state: makeState(null, { version: 2 }) });
    });
    expect(latest.status).toBe("open");
    expect(latest.attempts).toBe(0);
    expect(latest.state?.version).toBe(2);
  });

  it("closes the socket on unmount and does not reconnect", () => {
    const { unmount } = render(<Probe role="dashboard" />);
    unmount();
    expect(FakeWS.instances[0]!.closed).toBe(true);
    act(() => vi.advanceTimersByTime(5000));
    expect(FakeWS.instances).toHaveLength(1);
  });
});
