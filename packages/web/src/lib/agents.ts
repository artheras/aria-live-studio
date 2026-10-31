/**
 * Coding-agent (MCP bridge) helpers. All command strings live here so the
 * package invocation can be changed in one place.
 */

/** How agents launch the Aria Live MCP bridge. Change here if it moves (e.g. a local path). */
export const MCP_LAUNCH = {
  command: "npx",
  args: ["-y", "@aria-live/mcp"],
} as const;

export const MCP_SERVER_NAME = "aria-live";

export interface AgentConnection {
  token: string;
  mcpUrl: string;
}

export interface AgentSnippet {
  id: "claude-code" | "codex" | "aria-code";
  client: string;
  where: string;
  note?: string;
  text: string;
}

const launch = () => [MCP_LAUNCH.command, ...MCP_LAUNCH.args].join(" ");

export function agentSnippets({ token, mcpUrl }: AgentConnection): AgentSnippet[] {
  const argsToml = `[${MCP_LAUNCH.args.map((a) => JSON.stringify(a)).join(", ")}]`;
  return [
    {
      id: "claude-code",
      client: "Claude Code",
      where: "Run in your project terminal",
      note: "or use the .mcp.json in the repo",
      text: `claude mcp add ${MCP_SERVER_NAME} --env ARIA_LIVE_URL=${mcpUrl} --env ARIA_LIVE_TOKEN=${token} -- ${launch()}`,
    },
    {
      id: "codex",
      client: "Codex",
      where: "Add to ~/.codex/config.toml",
      text: [
        `[mcp_servers.${MCP_SERVER_NAME}]`,
        `command = ${JSON.stringify(MCP_LAUNCH.command)}`,
        `args = ${argsToml}`,
        `env = { ARIA_LIVE_URL = ${JSON.stringify(mcpUrl)}, ARIA_LIVE_TOKEN = ${JSON.stringify(token)} }`,
      ].join("\n"),
    },
    {
      id: "aria-code",
      client: "Aria Code",
      where: "Run inside Aria Code",
      text: `/mcp add ${MCP_SERVER_NAME} ${launch()}\n# env: ARIA_LIVE_URL=${mcpUrl}  ARIA_LIVE_TOKEN=${token}`,
    },
  ];
}

export function maskToken(token: string): string {
  if (token.length <= 8) return "•".repeat(Math.max(4, token.length));
  return `${token.slice(0, 4)}${"•".repeat(12)}${token.slice(-2)}`;
}

const KNOWN: Record<string, string> = {
  codex: "Codex",
  "claude-code": "Claude Code",
  claude: "Claude Code",
  claudecode: "Claude Code",
  "aria-code": "Aria Code",
  aria: "Aria Code",
  ariacode: "Aria Code",
};

function titleCase(s: string): string {
  return s
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(" ");
}

/** "mcp:codex" -> Codex via MCP; "aria-code" -> Aria Code (isolated). */
export function executorInfo(executor: string | null | undefined): { label: string; viaMcp: boolean; client: string } {
  const raw = (executor ?? "").trim();
  if (raw.toLowerCase().startsWith("mcp:")) {
    const id = raw.slice(4).trim();
    const client = KNOWN[id.toLowerCase()] ?? (id ? titleCase(id) : "a coding agent");
    return { label: client, viaMcp: true, client };
  }
  const base = KNOWN[raw.toLowerCase()] ?? (raw ? titleCase(raw) : "Aria");
  return { label: `${base} (isolated)`, viaMcp: false, client: base };
}
