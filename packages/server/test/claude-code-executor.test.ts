import { describe, expect, it } from "vitest";
import type { ExecutionStep } from "@aria-live/shared";
import { loadConfig } from "../src/config.ts";
import { ClaudeCodeEventMapper, ClaudeCodeExecutor, claudeCodeArgs, createExecutor, StepSink } from "../src/executor/index.ts";

describe("ClaudeCodeExecutor", () => {
  it("builds non-interactive stream-json args with -- separator", () => {
    const args = claudeCodeArgs("--flag-like-prompt", "/tmp/wt");
    expect(args).toEqual([
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--permission-mode",
      "acceptEdits",
      "--",
      "--flag-like-prompt",
    ]);
  });

  it("maps system, assistant tool_use/text, user tool_result, and result events", () => {
    const steps: ExecutionStep[] = [];
    const mapper = new ClaudeCodeEventMapper(new StepSink((s) => steps.push(s)));

    mapper.onEvent({ type: "system", subtype: "init" });
    mapper.onEvent({
      type: "assistant",
      message: {
        content: [
          { type: "tool_use", id: "tu-1", name: "Edit", input: { file_path: "src/boss.ts" } },
          { type: "text", text: "Added DragonBoss fire-breath attack" },
        ],
      },
    });
    mapper.onEvent({
      type: "user",
      message: {
        content: [{ type: "tool_result", tool_use_id: "tu-1", is_error: false }],
      },
    });
    mapper.onEvent({ type: "result", subtype: "success", is_error: false, result: "Done" });

    const out = mapper.finish();
    expect(out.success).toBe(true);
    expect(out.error).toBeNull();
    expect(out.response).toBe("Added DragonBoss fire-breath attack");
    expect(steps.some((s) => s.kind === "status" && s.text.includes("Claude Code session started"))).toBe(true);
    expect(steps.some((s) => s.kind === "tool" && s.text.includes("Edit src/boss.ts"))).toBe(true);
    expect(steps.some((s) => s.kind === "tool" && s.ok === true)).toBe(true);
  });

  it("reports failure on error result or missing result event", () => {
    const mapperErr = new ClaudeCodeEventMapper(new StepSink(() => {}));
    mapperErr.onEvent({ type: "result", subtype: "error_during_execution", is_error: true, result: "Tests failed" });
    expect(mapperErr.finish()).toEqual({ success: false, response: "Tests failed", error: "Tests failed" });

    const mapperIncomplete = new ClaudeCodeEventMapper(new StepSink(() => {}));
    mapperIncomplete.onEvent({ type: "system", subtype: "init" });
    expect(mapperIncomplete.finish().success).toBe(false);
  });

  it("instantiates ClaudeCodeExecutor via createExecutor when ARIA_LIVE_EXECUTOR=claude-code", () => {
    const cfg = loadConfig({ ARIA_LIVE_EXECUTOR: "claude-code", CLAUDE_BIN: "/usr/local/bin/claude" });
    expect(cfg.executor.kind).toBe("claude-code");
    expect(cfg.executor.claudeBin).toBe("/usr/local/bin/claude");
    const exec = createExecutor(cfg);
    expect(exec).toBeInstanceOf(ClaudeCodeExecutor);
    expect(exec.name).toBe("claude-code");
  });
});
