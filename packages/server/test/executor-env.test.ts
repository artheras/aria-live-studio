import { afterEach, expect, it, vi } from "vitest";
import { childEnv } from "../src/executor/process.ts";

afterEach(() => vi.unstubAllEnvs());

it("removes studio credentials from both inherited and explicit executor variables", () => {
  const secrets = ["TWITCH_CLIENT_SECRET", "TWITCH_ACCESS_TOKEN", "SESSION_SECRET", "OVERLAY_KEY", "AGENT_TOKEN", "COHOST_KEY", "STREAMER_KEY", "ARIA_LIVE_TOKEN", "agent_token"];
  for (const name of secrets) vi.stubEnv(name, "synthetic-test-secret");
  vi.stubEnv("PATH", "/usr/bin");
  vi.stubEnv("OPENAI_API_KEY", "executor-model-key");
  const env = childEnv({ AGENT_TOKEN: "override", STREAMER_KEY: "override", ARIA_EVENTS_STREAM: "1" });
  for (const name of secrets) expect(env[name]).toBeUndefined();
  expect(env.PATH).toBe("/usr/bin");
  expect(env.OPENAI_API_KEY).toBe("executor-model-key");
  expect(env.ARIA_EVENTS_STREAM).toBe("1");
  expect(env.NO_COLOR).toBe("1");
});
