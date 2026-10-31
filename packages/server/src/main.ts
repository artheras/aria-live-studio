/** Entry point: load config, build everything, start, shut down cleanly. */
import { join } from "node:path";
import { loadConfig, REPO_ROOT, twitchConfigured, type Config } from "./config.ts";
import type { Executor, Planner } from "./contracts.ts";
import { createApp } from "./http/server.ts";
import { LiveService } from "./live/service.ts";
import { Store } from "./live/store.ts";
import { TwitchAuth } from "./twitch/auth.ts";
import { HelixClient } from "./twitch/helix.ts";

async function loadPlanner(config: Config): Promise<Planner> {
  const mod = (await import("./planner/index.ts")) as { createPlanner(c: Config): Planner };
  return mod.createPlanner(config);
}

async function loadExecutor(config: Config): Promise<Executor> {
  try {
    const mod = (await import("./executor/index.ts" as string)) as { createExecutor(c: Config): Executor };
    return mod.createExecutor(config);
  } catch (err) {
    console.warn(`[main] executor module unavailable: ${(err as Error).message}`);
    return {
      name: "disabled",
      check: async () => ({ ok: false, reason: "executor module not available" }),
      run: async () => ({
        status: "failed",
        branch: null,
        workdir: null,
        changedFiles: [],
        summary: null,
        error: "executor module not available",
      }),
    };
  }
}

async function main(): Promise<void> {
  const config = loadConfig();
  const store = new Store(config.dataDir);
  const auth = new TwitchAuth(config);
  const helix = new HelixClient(config.twitch.apiBase, auth);
  const [planner, executor] = await Promise.all([loadPlanner(config), loadExecutor(config)]);
  const service = new LiveService({ config, store, auth, helix, planner, executor });
  const app = createApp({ config, auth, service, store, webDist: join(REPO_ROOT, "packages/web/dist") });

  const port = await app.listen(config.port);
  console.log(`Aria Live Studio server on http://localhost:${port} (public URL ${config.publicUrl})`);
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
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
