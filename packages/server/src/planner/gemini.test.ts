import { describe, expect, it } from "vitest";
import { choosePlanner, DEFAULT_GEMINI_MODEL, GeminiPlanner, geminiSettings } from "./index.ts";

describe("geminiSettings", () => {
  it("returns null when neither GEMINI_API_KEY nor GOOGLE_API_KEY is set", () => {
    expect(geminiSettings(15_000, {})).toBeNull();
  });

  it("reads GEMINI_API_KEY or GOOGLE_API_KEY and overrides model/baseUrl", () => {
    const s = geminiSettings(10_000, {
      GOOGLE_API_KEY: "goog-test",
      GEMINI_MODEL: "gemini-2.5-pro",
      GEMINI_BASE_URL: "https://example.test/v1beta/",
    });
    expect(s).toEqual({
      apiKey: "goog-test",
      model: "gemini-2.5-pro",
      timeoutMs: 10_000,
      baseUrl: "https://example.test/v1beta",
    });
  });
});

describe("choosePlanner with gemini", () => {
  const basePlanner = {
    apiKey: undefined,
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    timeoutMs: 15_000,
  };

  it("picks gemini when GEMINI_API_KEY is set and no ANTHROPIC_API_KEY is present", () => {
    const choice = choosePlanner({ planner: basePlanner }, { GEMINI_API_KEY: "gem-123" });
    expect(choice).toEqual({ kind: "gemini", label: "model", model: DEFAULT_GEMINI_MODEL });
  });

  it("respects explicit ARIA_LIVE_PLANNER=gemini even when other keys exist", () => {
    const choice = choosePlanner(
      { planner: { ...basePlanner, apiKey: "oa-123" } },
      { ARIA_LIVE_PLANNER: "gemini", ANTHROPIC_API_KEY: "ant-123", GEMINI_API_KEY: "gem-123" },
    );
    expect(choice.kind).toBe("gemini");
    expect(choice.label).toBe("model");
  });
});

describe("GeminiPlanner", () => {
  it("sends structured request and sanitizes the returned JSON plan", async () => {
    let capturedUrl = "";
    let capturedKey = "";
    const fakeFetch: typeof fetch = async (input, init) => {
      capturedUrl = String(input);
      capturedKey = new Headers(init?.headers).get("x-goog-api-key") ?? "";
      return new Response(
        JSON.stringify({
          modelVersion: "gemini-2.5-flash",
          candidates: [
            {
              finishReason: "STOP",
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      title: "Add a boss fight",
                      summary: "Create a boss arena and fire attack.",
                      userStory: "As a player, I want a boss fight so stage 2 feels exciting.",
                      size: "S",
                      steps: ["Add boss entity", "Render health bar"],
                      acceptanceCriteria: ["Boss spawns on stage 2", "Tests pass"],
                      risks: ["Balance tuning"],
                    }),
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };

    const planner = new GeminiPlanner(
      {
        apiKey: "gem-secret",
        model: "gemini-2.5-flash",
        timeoutMs: 5_000,
        baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      },
      fakeFetch,
    );

    const planInput = {
      idea: {
        id: "i1",
        number: 1,
        text: "Add a boss fight",
        author: { id: "u1", login: "viewer1", displayName: "Viewer1" },
        createdAt: 1700000000000,
        hidden: false,
        seconds: 0,
      },
      round: { index: 1, prompt: "" },
      projectBrief: "2D platformer",
      otherIdeas: [],
      signal: new AbortController().signal,
    };

    const plan = await planner.plan(planInput);

    expect(capturedUrl).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
    );
    expect(capturedKey).toBe("gem-secret");
    expect(plan.title).toBe("Add a boss fight");
    expect(plan.model).toBe("gemini-2.5-flash");
    expect(plan.size).toBe("S");
  });

  it("surfaces actionable error when API key is rejected", async () => {
    const fakeFetch: typeof fetch = async () =>
      new Response(JSON.stringify({ error: { message: "API key invalid" } }), { status: 403 });

    const planner = new GeminiPlanner(
      {
        apiKey: "bad-key",
        model: "gemini-2.5-flash",
        timeoutMs: 5_000,
        baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      },
      fakeFetch,
    );

    await expect(
      planner.plan({
        idea: {
          id: "i1",
          number: 1,
          text: "Add a boss fight",
          author: { id: "u1", login: "viewer1", displayName: "Viewer1" },
          createdAt: 1700000000000,
          hidden: false,
          seconds: 0,
        },
        round: { index: 1, prompt: "" },
        projectBrief: "2D platformer",
        otherIdeas: [],
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow(/GEMINI_API_KEY/);
  });
});
