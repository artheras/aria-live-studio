import type { Task } from "@aria-live/shared";
import type { ExecutionHooks, ExecutionResult, Executor } from "../contracts.ts";
import { AriaCodeExecutor } from "./aria-code.ts";
import type { ExecutorConfig } from "./cli.ts";
import { CodexExecutor } from "./codex.ts";

export { AriaCodeExecutor, AriaCodeEventMapper, ariaCodeArgs } from "./aria-code.ts";
export { CodexExecutor, CodexEventMapper, codexArgs } from "./codex.ts";
export { StepSink, type ExecutorConfig } from "./cli.ts";
export { buildExecutionPrompt } from "./prompt.ts";
export { redact, streamSafe } from "./safe-text.ts";

export class DisabledExecutor implements Executor {
  readonly name = "disabled";
  async check() {
    return { ok: false, reason: "Execution is disabled (set ARIA_LIVE_EXECUTOR and TARGET_REPO)" };
  }
  async run(_task: Task, _hooks: ExecutionHooks): Promise<ExecutionResult> {
    return {
      status: "failed",
      branch: null,
      workdir: null,
      changedFiles: [],
      summary: null,
      error: "Execution is disabled (set ARIA_LIVE_EXECUTOR and TARGET_REPO)",
    };
  }
}

export function createExecutor(config: ExecutorConfig): Executor {
  switch (config.executor.kind) {
    case "aria-code":
      return new AriaCodeExecutor(config);
    case "codex":
      return new CodexExecutor(config);
    default:
      return new DisabledExecutor();
  }
}
