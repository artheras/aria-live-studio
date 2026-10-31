/**
 * Coding-agent (MCP bridge) helpers. All command strings live here so the
 * package invocation can be changed in one place.
 */

/**
 * Fallback launch command when the server does not report one. The server
 * normally returns the absolute path of the bundled bridge
 * (plugin/mcp/aria-live-mcp.mjs) as `mcpCommand`.
 */
export const MCP_LAUNCH = {
  command: "node",
  args: ["/path/to/aria-live-studio/plugin/mcp/aria-live-mcp.mjs"],
} as const;

export const MCP_SERVER_NAME = "aria-live";

export interface AgentConnection {
  token: string;
  mcpUrl: string;
  /** Exact command to start the MCP bridge on this machine. */
  mcpCommand?: { command: string; args: string[] };
}

export interface AgentSnippet {
  id: "claude-code" | "codex" | "aria-code";
  client: string;
  where: string;
  note?: string;
  text: string;
}

const shellQuote = (a: string) => (/^[\w@%+=:,./-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`);

export function agentSnippets({ token, mcpUrl, mcpCommand }: AgentConnection): AgentSnippet[] {
  const cmd = mcpCommand ?? MCP_LAUNCH;
  const launch = [cmd.command, ...cmd.args].map(shellQuote).join(" ");
  const argsToml = `[${cmd.args.map((a) => JSON.stringify(a)).join(", ")}]`;
  return [
    {
      id: "claude-code",
      client: "Claude Code",
      where: "Run in your game's repository",
      note: "or install the plugin: claude plugin marketplace add artheras/aria-live-studio",
      text: `claude mcp add ${MCP_SERVER_NAME} -e ARIA_LIVE_URL=${mcpUrl} -e ARIA_LIVE_TOKEN=${token} -- ${launch}`,
    },
    {
      id: "codex",
      client: "Codex",
      where: "Add to ~/.codex/config.toml",
      text: [
        `[mcp_servers.${MCP_SERVER_NAME}]`,
        `command = ${JSON.stringify(cmd.command)}`,
        `args = ${argsToml}`,
        `env = { ARIA_LIVE_URL = ${JSON.stringify(mcpUrl)}, ARIA_LIVE_TOKEN = ${JSON.stringify(token)} }`,
        `tool_timeout_sec = 660`,
      ].join("\n"),
      note: "and copy plugin/skills/aria-live to ~/.codex/skills/",
    },
    {
      id: "aria-code",
      client: "Aria Code",
      where: "Add to ~/.aria-code/mcp_servers.json → servers",
      note: "and copy plugin/skills/aria-live into your Aria skills folder",
      text: JSON.stringify(
        {
          name: MCP_SERVER_NAME,
          command: cmd.command,
          args: cmd.args,
          env: { ARIA_LIVE_URL: mcpUrl, ARIA_LIVE_TOKEN: token },
          enabled: true,
        },
        null,
        2,
      ),
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

/** Known client from a host-reported name ("codex-mcp-client", "Claude Code", …). */
function knownClient(id: string): string | undefined {
  const n = id.toLowerCase();
  if (KNOWN[n]) return KNOWN[n];
  if (n.includes("codex")) return "Codex";
  if (n.includes("claude")) return "Claude Code";
  if (n.includes("aria")) return "Aria Code";
  return undefined;
}

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
    const client = knownClient(id) ?? (id ? titleCase(id) : "a coding agent");
    return { label: client, viaMcp: true, client };
  }
  const base = KNOWN[raw.toLowerCase()] ?? (raw ? titleCase(raw) : "Aria");
  return { label: `${base} (isolated)`, viaMcp: false, client: base };
}
