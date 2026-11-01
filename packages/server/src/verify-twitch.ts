/**
 * npm run verify:twitch [-- --write [--chat]]
 *
 * Read-only by default. --write changes the stream title and restores it,
 * creates a "Aria Live self-test" marker and a clip; --chat posts one line.
 * Writes data/verify-twitch-report.json (no secrets) to share when asking for help.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "./config.ts";
import { formatReport, verifyTwitch } from "./twitch/verify.ts";

const args = new Set(process.argv.slice(2));
const config = loadConfig();
const tokenFile = join(config.dataDir, "tokens.json");
let accessToken: string | null = null;
if (existsSync(tokenFile)) {
  try {
    accessToken = (JSON.parse(readFileSync(tokenFile, "utf8")) as { accessToken?: string }).accessToken ?? null;
  } catch {
    accessToken = null;
  }
}

const report = await verifyTwitch({
  clientId: config.twitch.clientId,
  accessToken,
  authBase: config.twitch.authBase,
  apiBase: config.twitch.apiBase,
  write: args.has("--write"),
  chat: args.has("--chat"),
});
console.log(formatReport(report));
const out = join(config.dataDir, "verify-twitch-report.json");
writeFileSync(out, JSON.stringify(report, null, 2));
console.log(`\nReport: ${out}`);
process.exitCode = report.results.some((r) => r.outcome === "fail") ? 1 : 0;
