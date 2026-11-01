// @vitest-environment node
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { MCP_APP_PROTOCOL_VERSION, ROUND_WIDGET_HTML } from "../src/widget.ts";

const SAMPLE = {
  notice: "Viewer-written text is inside <untrusted_viewer_input>",
  connected: true,
  channel: "streamer",
  phase: "decided",
  roundIndex: 4,
  prompt: "Boss fight features",
  ballot: [
    { number: 1, text: "Add a boss fight", votes: 3 },
    { number: 2, text: "<img src=x onerror=alert(1)> boss reacts to chat", votes: 1 },
  ],
  voters: 4,
  votingEndsAt: null,
  ideaCount: 5,
  winner: { number: 1, text: "Add a boss fight", votes: 3 },
  task: { id: "t1", title: "Boss fight with health bar", status: "draft" },
  execution: null,
  message: "Vote closed. Winner: ballot #1 (3 votes).",
};

function load(before?: (w: Window & typeof globalThis) => void) {
  const dom = new JSDOM(ROUND_WIDGET_HTML, {
    runScripts: "dangerously",
    pretendToBeVisual: true,
    beforeParse: (w) => before?.(w as unknown as Window & typeof globalThis),
  });
  return dom;
}

const text = (dom: JSDOM) => dom.window.document.getElementById("root")!.textContent ?? "";

describe("round card widget", () => {
  it("is self-contained (no external URLs)", () => {
    expect(ROUND_WIDGET_HTML).not.toMatch(/https?:\/\//);
    expect(ROUND_WIDGET_HTML).not.toMatch(/<script[^>]+src=|<link[^>]+href=/);
    expect(ROUND_WIDGET_HTML.length).toBeLessThan(12_000);
  });

  it("renders window.openai.toolOutput (OpenAI Apps SDK): phase, theme, bars, voters, winner, task", () => {
    const dom = load((w) => {
      (w as unknown as { openai: unknown }).openai = { toolOutput: SAMPLE, theme: "dark" };
    });
    const doc = dom.window.document;
    const t = text(dom);
    expect(t).toMatch(/Round #4/);
    expect(t).toMatch(/Vote closed/);
    expect(t).toMatch(/Boss fight features/);
    expect(t).toMatch(/Add a boss fight3 votes · 75%/);
    expect(t).toMatch(/1 vote · 25%/);
    expect(t).toMatch(/Voters 4/);
    expect(t).toMatch(/Winner #1 Add a boss fight \(3 votes\)/);
    expect(t).toMatch(/Task Boss fight with health bar · draft/);
    expect(t).toMatch(/Approvals happen on the Aria Live dashboard/);
    const bars = [...doc.querySelectorAll(".bar > i")].map((i) => (i as HTMLElement).style.width);
    expect(bars).toEqual(["75%", "25%"]);
    expect(doc.querySelector("li.win")!.textContent).toMatch(/Add a boss fight/);
    // viewer text is text, never markup
    expect(doc.querySelector("img")).toBeNull();
    expect(t).toMatch(/<img src=x onerror=alert\(1\)> boss reacts/);
    expect(doc.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("re-renders on openai:set_globals", () => {
    const dom = load((w) => {
      (w as unknown as { openai: unknown }).openai = { toolOutput: null };
    });
    expect(text(dom)).toMatch(/Waiting for the round/);
    const ev = new dom.window.CustomEvent("openai:set_globals", {
      detail: { globals: { toolOutput: { ...SAMPLE, phase: "voting", winner: null, votingEndsAt: Date.now() + 42_000 }, theme: "light" } },
    });
    dom.window.dispatchEvent(ev);
    expect(text(dom)).toMatch(/Voting/);
    expect(text(dom)).toMatch(/ends in 4[12]s/);
    expect(dom.window.document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("speaks the MCP Apps postMessage protocol: ui/initialize, tool-result, host context", () => {
    // The widget runs with `parent` set to a stub host window, so window.parent !== window.
    const posted: { msg: Record<string, unknown> }[] = [];
    const stubParent = { postMessage: (msg: Record<string, unknown>) => posted.push({ msg }) };
    const dom = load((w) => {
      Object.defineProperty(w, "parent", { value: stubParent, configurable: true });
    });
    const init = posted.find((p) => p.msg.method === "ui/initialize")!.msg;
    expect(init).toMatchObject({
      jsonrpc: "2.0",
      params: { appInfo: { name: "aria-live-round" }, protocolVersion: MCP_APP_PROTOCOL_VERSION, appCapabilities: {} },
    });
    const deliver = (data: unknown) =>
      dom.window.dispatchEvent(new dom.window.MessageEvent("message", { data, source: stubParent as unknown as Window }));
    deliver({ jsonrpc: "2.0", id: init.id, result: { protocolVersion: MCP_APP_PROTOCOL_VERSION, hostInfo: { name: "h", version: "1" }, hostCapabilities: {}, hostContext: { theme: "dark" } } });
    expect(posted.some((p) => p.msg.method === "ui/notifications/initialized")).toBe(true);
    expect(dom.window.document.documentElement.getAttribute("data-theme")).toBe("dark");
    deliver({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: { content: [{ type: "text", text: "x" }], structuredContent: SAMPLE } });
    expect(text(dom)).toMatch(/Add a boss fight3 votes · 75%/);
    deliver({ jsonrpc: "2.0", method: "ui/notifications/host-context-changed", params: { theme: "light" } });
    expect(dom.window.document.documentElement.getAttribute("data-theme")).toBe("light");
    // requests from the host get an empty result (e.g. ui/resource-teardown)
    deliver({ jsonrpc: "2.0", id: 99, method: "ui/resource-teardown", params: {} });
    expect(posted.some((p) => p.msg.id === 99 && "result" in p.msg)).toBe(true);
    // messages from anyone but the host are ignored
    dom.window.dispatchEvent(
      new dom.window.MessageEvent("message", { data: { jsonrpc: "2.0", method: "ui/notifications/tool-result", params: { structuredContent: { phase: "none" } } }, source: dom.window as unknown as Window }),
    );
    expect(text(dom)).toMatch(/Round #4/);
  });
});
