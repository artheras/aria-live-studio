/**
 * stdio entry point. Configure in the host with:
 *   ARIA_LIVE_URL   Aria Live server (default http://localhost:3000)
 *   ARIA_LIVE_TOKEN agent token from the dashboard ("Connect a coding agent")
 *   ARIA_LIVE_CLIENT optional label shown on stream if the host doesn't name itself
 * stdout carries MCP messages only; diagnostics go to stderr.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { LiveClient } from "./client.ts";
import { createServer } from "./server.ts";

const token = process.env.ARIA_LIVE_TOKEN ?? "";
if (!token) {
  process.stderr.write(
    "aria-live-mcp: ARIA_LIVE_TOKEN is not set. Copy the agent token from the Aria Live dashboard (Connect a coding agent).\n",
  );
}

const client = new LiveClient({
  baseUrl: process.env.ARIA_LIVE_URL ?? "http://localhost:3000",
  token,
});
const server = createServer({ client, clientName: process.env.ARIA_LIVE_CLIENT });
await server.connect(new StdioServerTransport());
