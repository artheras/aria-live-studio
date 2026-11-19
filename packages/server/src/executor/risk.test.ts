import { describe, expect, it } from "vitest";
import { assessDiffRisk } from "./risk.ts";

describe("assessDiffRisk", () => {
  it("returns empty array for normal application source files", () => {
    expect(assessDiffRisk(["src/game/boss.ts", "packages/web/src/App.tsx", "README.md"])).toEqual([]);
  });

  it("flags secrets, CI workflows, dependency manifests, and auth modules", () => {
    const warnings = assessDiffRisk([
      ".env.local",
      ".github/workflows/ci.yml",
      "package-lock.json",
      "packages/server/src/twitch/auth.ts",
      "src/index.ts",
    ]);

    expect(warnings).toEqual([
      {
        file: ".env.local",
        category: "secrets",
        reason: "Environment, key, or secret file modified",
      },
      {
        file: ".github/workflows/ci.yml",
        category: "ci",
        reason: "CI workflow or container definition modified",
      },
      {
        file: "package-lock.json",
        category: "dependencies",
        reason: "Package manifest or lockfile modified",
      },
      {
        file: "packages/server/src/twitch/auth.ts",
        category: "auth",
        reason: "Authentication or security module modified",
      },
    ]);
  });
});
