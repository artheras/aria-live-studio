/** Runs Aria Code headless: `aria-code -p <prompt> --format jsonl …` in the worktree. */
import type { AgentOutcome, EventMapper, StepSink } from "./cli.ts";
import { CliExecutor } from "./cli.ts";
import { childEnv } from "./process.ts";

/** Builds the argv. Never --dangerously-skip-permissions; only the configured tools are auto-allowed. */
export function ariaCodeArgs(prompt: string, allowTools: string): string[] {
  const tools = allowTools
    .split(",")
    .map((t) => t.trim())
    .filter((t) => /^[A-Za-z0-9_.-]+$/.test(t));
  const args = ["-p", prompt, "--format", "jsonl", "--quiet", "--no-banner"];
  if (tools.length) args.push("--allow-tools", tools.join(","));
  return args;
}

const PARAM_KEYS = ["path", "file_path", "command", "pattern", "query", "url", "directory"];

function toolLabel(event: Record<string, unknown>): string {
  const tool = typeof event.tool === "string" ? event.tool : "tool";
  const params = event.params && typeof event.params === "object" ? (event.params as Record<string, unknown>) : {};
  for (const key of PARAM_KEYS) {
    const v = params[key];
    if (typeof v === "string" && v) return `${tool} ${v}`;
  }
  return tool;
}

export class AriaCodeEventMapper implements EventMapper {
  private outcome: AgentOutcome = { success: false, response: null, error: null };
  private completed = false;

  constructor(private readonly sink: StepSink) {}

  onEvent(e: Record<string, unknown> & { type: string }): void {
    switch (e.type) {
      case "turn.started":
        this.sink.emit("status", "Aria started working");
        break;
      case "answer.delta":
        this.sink.answerDelta(e.text);
        break;
      case "turn.status":
        this.sink.emit("status", typeof e.message === "string" && e.message ? e.message : e.state);
        break;
      case "tool.started":
        this.sink.emit("tool", `▶ ${toolLabel(e)}`);
        break;
      case "tool.completed": {
        const ok = e.success !== false;
        const secs = typeof e.elapsed_s === "number" ? ` (${e.elapsed_s.toFixed(1)}s)` : "";
        const err = !ok && typeof e.error === "string" && e.error ? `: ${e.error}` : "";
        this.sink.emit("tool", `${ok ? "✓" : "✗"} ${typeof e.tool === "string" ? e.tool : "tool"}${secs}${err}`, ok);
        break;
      }
      case "turn.completed":
        this.completed = true;
        this.outcome = {
          success: e.success === true,
          response: typeof e.response === "string" ? e.response : null,
          error: e.success === true ? null : typeof e.error === "string" && e.error ? e.error : "Aria reported a failure",
        };
        this.sink.emit("status", e.success === true ? "Aria finished the turn" : "Aria could not finish", e.success === true);
        break;
      default:
        break; // unknown event types are ignored
    }
  }

  finish(): AgentOutcome {
    return this.completed ? this.outcome : { success: false, response: null, error: "Aria Code ended without turn.completed" };
  }
}

export class AriaCodeExecutor extends CliExecutor {
  readonly name = "aria-code";
  protected get bin(): string {
    return this.config.executor.ariaCodeBin;
  }
  protected args(prompt: string): string[] {
    return ariaCodeArgs(prompt, this.config.executor.allowTools);
  }
  protected mapper(sink: StepSink): EventMapper {
    return new AriaCodeEventMapper(sink);
  }
  protected override env(): NodeJS.ProcessEnv {
    return childEnv({ ARIA_EVENTS_STREAM: "1" });
  }
}
