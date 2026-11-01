/**
 * stdio entry point of the remote proxy (bundled into the Claude Desktop .mcpb
 * as server/aria-live-proxy.mjs). Configure with:
 *   ARIA_LIVE_URL    Aria Live server (default http://localhost:3000), or the
 *                    full remote MCP URL from the dashboard
 *   ARIA_LIVE_ROLE   agent | cohost | streamer (default: agent if a token is set, else cohost)
 *   ARIA_LIVE_TOKEN  agent token (agent role)
 *   ARIA_LIVE_KEY    co-host or streamer key
 * stdout carries MCP messages only; diagnostics go to stderr.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createProxyServer, resolveProxyConfig } from "./proxy.ts";

const log = (line: string) => process.stderr.write(`aria-live-proxy: ${line}\n`);
const config = resolveProxyConfig(process.env);
if ("error" in config) log(config.error);
else log(`role ${config.role} → ${config.safeUrl}`);

const server = createProxyServer(config, { log, clientName: process.env.ARIA_LIVE_CLIENT });
await server.connect(new StdioServerTransport());
