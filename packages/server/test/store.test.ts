import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/live/store.ts";
import { loadConfig } from "../src/config.ts";
import { makeEngine, user } from "./helpers.ts";

describe("store", () => {
  it("saves debounced and atomically without activity, and restores", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aria-store-"));
    const store = new Store(dir, 20);
    const { engine } = makeEngine();
    engine.openRound("p");
    engine.submitIdea(user("a"), "idea");
    store.scheduleSave(() => engine.snapshot());
    store.scheduleSave(() => engine.snapshot());
    expect(existsSync(store.statePath)).toBe(false);
    await new Promise((r) => setTimeout(r, 60));
    const raw = JSON.parse(readFileSync(store.statePath, "utf8"));
    expect(raw.state.activity).toBeUndefined();
    expect(raw.state.round.ideas).toHaveLength(1);
    const restored = makeEngine(store.loadState()).engine;
    expect(restored.round!.ideas[0]!.text).toBe("idea");
    expect(restored.state.stats.participants).toBe(1);
  });

  it("history is newest first and limited", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aria-store-"));
    const store = new Store(dir);
    const { engine } = makeEngine();
    for (let i = 0; i < 3; i++) {
      engine.openRound(`r${i}`);
      await store.appendHistory(engine.resetRound()!);
    }
    const h = await store.readHistory(2);
    expect(h.map((x) => x.prompt)).toEqual(["r2", "r1"]);
  });

  it("config persists generated secrets with 0600", () => {
    const dir = mkdtempSync(join(tmpdir(), "aria-cfg-"));
    const a = loadConfig({ DATA_DIR: dir });
    const b = loadConfig({ DATA_DIR: dir });
    expect(a.sessionSecret).toBe(b.sessionSecret);
    expect(a.overlayKey).toBe(b.overlayKey);
    expect(a.agentToken).toBe(b.agentToken);
    expect(statSync(join(dir, "secrets.json")).mode & 0o777).toBe(0o600);
    const c = loadConfig({ DATA_DIR: dir, AGENT_TOKEN: "tok", PORT: "4000" });
    expect(c.agentToken).toBe("tok");
    expect(c.publicUrl).toBe("http://localhost:4000");
    expect(c.twitch.redirectUri).toBe("http://localhost:4000/auth/twitch/callback");
    expect(c.executor.kind).toBe("disabled");
  });
});
