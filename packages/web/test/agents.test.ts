import { describe, expect, it, vi } from "vitest";
import { createApi } from "../src/lib/api";
import { agentSnippets, executorInfo } from "../src/lib/agents";

describe("agent connection", () => {
  it("keeps the bridge command the server reports, so snippets carry the real path", async () => {
    const body = {
      token: "tok",
      mcpUrl: "http://localhost:3000",
      mcpCommand: { command: "node", args: ["/srv/aria/plugin/mcp/aria-live-mcp.mjs"] },
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));
    const conn = await createApi(() => null).agentConnection();
    expect(conn.mcpCommand).toEqual(body.mcpCommand);
    const claude = agentSnippets(conn).find((s) => s.id === "claude-code")!;
    expect(claude.text).toContain("-- node /srv/aria/plugin/mcp/aria-live-mcp.mjs");
    expect(claude.text).not.toContain("/path/to/");
  });
});

describe("executorInfo", () => {
  it("names agents from the ids MCP hosts report", () => {
    expect(executorInfo("mcp:codex").client).toBe("Codex");
    expect(executorInfo("mcp:codex-mcp-client").client).toBe("Codex");
    expect(executorInfo("mcp:Claude Code").client).toBe("Claude Code");
    expect(executorInfo("mcp:my-bot")).toEqual({ label: "My Bot", viaMcp: true, client: "My Bot" });
    expect(executorInfo("aria-code").label).toBe("Aria Code (isolated)");
  });
});
