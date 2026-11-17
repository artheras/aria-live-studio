/** Runs Claude Code CLI headless: `claude -p --output-format stream-json --verbose --permission-mode acceptEdits -- <prompt>`. */
import type { AgentOutcome, EventMapper, StepSink } from "./cli.ts";
import { CliExecutor } from "./cli.ts";

export function claudeCodeArgs(prompt: string, _workdir: string): string[] {
  return [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--permission-mode",
    "acceptEdits",
    "--",
    prompt,
  ];
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

function summarizeToolInput(name: string, input: Record<string, unknown>): string {
  const filePath = str(input.file_path) || str(input.path);
  if (filePath) return `${name} ${filePath}`;
  const cmd = str(input.command);
  if (cmd) return `$ ${cmd}`;
  const pattern = str(input.pattern) || str(input.query);
  if (pattern) return `${name} ${pattern}`;
  return name;
}

export class ClaudeCodeEventMapper implements EventMapper {
  private completed = false;
  private failed: string | null = null;
  private lastMessage: string | null = null;
  private readonly toolNames = new Map<string, string>();

  constructor(private readonly sink: StepSink) {}

  onEvent(e: Record<string, unknown> & { type: string }): void {
    switch (e.type) {
      case "system": {
        if (str(e.subtype) === "init") {
          this.sink.emit("status", "Claude Code session started");
        }
        break;
      }
      case "assistant": {
        const msg = e.message && typeof e.message === "object" ? (e.message as Record<string, unknown>) : {};
        const content = Array.isArray(msg.content) ? msg.content : [];
        for (const block of content) {
          if (!block || typeof block !== "object") continue;
          const b = block as Record<string, unknown>;
          if (b.type === "text") {
            const text = str(b.text);
            if (text) {
              this.lastMessage = text;
              this.sink.answerText(text);
            }
          } else if (b.type === "tool_use") {
            const id = str(b.id);
            const name = str(b.name) || "tool";
            const input = b.input && typeof b.input === "object" ? (b.input as Record<string, unknown>) : {};
            const label = summarizeToolInput(name, input);
            if (id) this.toolNames.set(id, label);
            this.sink.emit("tool", `▶ ${label}`);
          }
        }
        break;
      }
      case "user": {
        const msg = e.message && typeof e.message === "object" ? (e.message as Record<string, unknown>) : {};
        const content = Array.isArray(msg.content) ? msg.content : [];
        for (const block of content) {
          if (!block || typeof block !== "object") continue;
          const b = block as Record<string, unknown>;
          if (b.type === "tool_result") {
            const id = str(b.tool_use_id);
            const label = (id ? this.toolNames.get(id) : undefined) ?? "tool";
            const ok = b.is_error !== true;
            this.sink.emit("tool", `${ok ? "✓" : "✗"} ${label}`, ok);
          }
        }
        break;
      }
      case "result": {
        this.completed = true;
        const isErr = e.is_error === true || str(e.subtype) === "error_during_execution";
        const resultText = str(e.result);
        if (resultText && !this.lastMessage) this.lastMessage = resultText;
        if (isErr) {
          this.failed = resultText || "Claude Code execution failed";
          this.sink.emit("error", this.failed, false);
        } else {
          this.sink.emit("status", "Claude Code finished the turn", true);
        }
        break;
      }
      case "error": {
        const err = e.error && typeof e.error === "object" ? str((e.error as Record<string, unknown>).message) : str(e.message);
        this.failed = err || "Claude Code error";
        this.sink.emit("error", this.failed, false);
        break;
      }
      default:
        break;
    }
  }

  finish(): AgentOutcome {
    const success = this.completed && !this.failed;
    return {
      success,
      response: this.lastMessage,
      error: success ? null : this.failed ?? "Claude Code ended without result event",
    };
  }
}

export class ClaudeCodeExecutor extends CliExecutor {
  readonly name = "claude-code";
  protected get bin(): string {
    return this.config.executor.claudeBin ?? "claude";
  }
  protected args(prompt: string, workdir: string): string[] {
    return claudeCodeArgs(prompt, workdir);
  }
  protected mapper(sink: StepSink): EventMapper {
    return new ClaudeCodeEventMapper(sink);
  }
}
