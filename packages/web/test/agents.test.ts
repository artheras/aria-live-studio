import { describe, expect, it, vi } from "vitest";
import { createApi } from "../src/lib/api";
import { agentSnippets, executorInfo, maskCohostUrl, remoteSnippets } from "../src/lib/agents";

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

describe("remote MCP", () => {
  it("parses the remote URLs and builds the URL snippets", async () => {
    const body = {
      token: "tok",
      mcpUrl: "https://live.example",
      remote: { agentUrl: "https://live.example/mcp", cohostUrl: "https://live.example/mcp/cohost/KEY123456789" },
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));
    const conn = await createApi(() => null).agentConnection();
    expect(conn.remote).toEqual(body.remote);
    const [claude, codex] = remoteSnippets(conn.token, conn.remote!.agentUrl);
    expect(claude!.text).toBe(`claude mcp add --transport http aria-live https://live.example/mcp --header 'Authorization: Bearer tok'`);
    expect(codex!.text).toContain(`url = "https://live.example/mcp"`);
    expect(codex!.text).toContain(`bearer_token_env_var = "ARIA_LIVE_TOKEN"`);
    expect(maskCohostUrl(body.remote.cohostUrl)).not.toContain("KEY123456789");
    expect(maskCohostUrl(body.remote.cohostUrl)).toMatch(/^https:\/\/live\.example\/mcp\/cohost\/KEY1•+89$/);
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
