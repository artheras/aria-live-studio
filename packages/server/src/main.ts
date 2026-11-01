/** Entry point: load config, build everything, start, shut down cleanly. */
import { join } from "node:path";
import { loadConfig, REPO_ROOT, twitchConfigured } from "./config.ts";
import { createExecutor } from "./executor/index.ts";
import { createApp } from "./http/server.ts";
import { LiveService } from "./live/service.ts";
import { Store } from "./live/store.ts";
import { TwitchAuth } from "./twitch/auth.ts";
import { HelixClient } from "./twitch/helix.ts";
import { createPlanner } from "./planner/index.ts";

async function main(): Promise<void> {
  const config = loadConfig();
  const store = new Store(config.dataDir);
  const auth = new TwitchAuth(config);
  const helix = new HelixClient(config.twitch.apiBase, auth);
  const planner = createPlanner(config);
  const executor = createExecutor(config);
  const service = new LiveService({ config, store, auth, helix, planner, executor });
  const app = createApp({ config, auth, service, store, webDist: join(REPO_ROOT, "packages/web/dist") });

  const port = await app.listen(config.port);
  console.log(`Aria Live Studio server on http://localhost:${port} (public URL ${config.publicUrl})`);
  const pub = new URL(config.publicUrl);
  if (pub.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(pub.hostname)) {
    console.warn(`PUBLIC_URL ${config.publicUrl} is not HTTPS: ChatGPT and Claude connectors need a public https:// URL (see "Hosting for ChatGPT and Claude" in the README).`);
  }
  if (!twitchConfigured(config)) console.log("Twitch is not configured: set TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET.");
  console.log(`Planner: ${planner.name} · Executor: ${config.executor.kind}`);
  if (auth.user) {
    console.log(`Restoring Twitch session for ${auth.user.login}`);
    void auth.validateNow();
  }
  service.start();

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`${signal}: shutting down`);
    const force = setTimeout(() => process.exit(1), 8000);
    force.unref();
    await service.stop();
    await app.close();
    await store.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
