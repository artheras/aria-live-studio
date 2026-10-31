/** Runs OpenAI Codex CLI headless: `codex exec --json --sandbox workspace-write --cd <wt> <prompt>`. */
import type { AgentOutcome, EventMapper, StepSink } from "./cli.ts";
import { CliExecutor } from "./cli.ts";

export function codexArgs(prompt: string, workdir: string): string[] {
  // "--" so a prompt can never be parsed as a flag.
  return ["exec", "--json", "--sandbox", "workspace-write", "--cd", workdir, "--", prompt];
}

type Item = Record<string, unknown> & { type?: unknown };

const str = (v: unknown): string => (typeof v === "string" ? v : "");

export class CodexEventMapper implements EventMapper {
  private turnCompleted = false;
  private failed: string | null = null;
  private lastError: string | null = null;
  private lastMessage: string | null = null;

  constructor(private readonly sink: StepSink) {}

  onEvent(e: Record<string, unknown> & { type: string }): void {
    const item: Item = e.item && typeof e.item === "object" ? (e.item as Item) : {};
    switch (e.type) {
      case "thread.started":
        this.sink.emit("status", "Codex session started");
        break;
      case "turn.started":
        this.sink.emit("status", "Codex started working");
        break;
      case "item.started":
        this.itemStarted(item);
        break;
      case "item.completed":
        this.itemCompleted(item);
        break;
      case "turn.completed":
        this.turnCompleted = true;
        this.sink.emit("status", "Codex finished the turn", true);
        break;
      case "turn.failed": {
        const err = e.error && typeof e.error === "object" ? str((e.error as Record<string, unknown>).message) : str(e.error);
        this.failed = err || "Codex turn failed";
        this.sink.emit("error", this.failed, false);
        break;
      }
      case "error":
        this.lastError = str(e.message) || "Codex error";
        this.sink.emit("error", this.lastError, false);
        break;
      default:
        break; // item.updated, reasoning, unknown types: ignored
    }
  }

  private itemStarted(item: Item): void {
    switch (item.type) {
      case "command_execution":
        this.sink.emit("tool", `▶ $ ${str(item.command)}`);
        break;
      case "mcp_tool_call":
        this.sink.emit("tool", `▶ ${[str(item.server), str(item.tool)].filter(Boolean).join(".") || "tool"}`);
        break;
      case "web_search":
        this.sink.emit("tool", `▶ search ${str(item.query)}`);
        break;
    }
  }

  private itemCompleted(item: Item): void {
    switch (item.type) {
      case "agent_message": {
        const text = str(item.text);
        if (text) {
          this.lastMessage = text;
          this.sink.answerText(text);
        }
        break;
      }
      case "command_execution": {
        const code = typeof item.exit_code === "number" ? item.exit_code : null;
        const ok = item.status !== "failed" && (code === null || code === 0);
        this.sink.emit("tool", `${ok ? "✓" : "✗"} $ ${str(item.command)}${code !== null ? ` (exit ${code})` : ""}`, ok);
        break;
      }
      case "file_change": {
        const changes = Array.isArray(item.changes) ? item.changes : [];
        const paths = changes.map((c) => (c && typeof c === "object" ? str((c as Record<string, unknown>).path) : "")).filter(Boolean);
        const ok = item.status !== "failed";
        this.sink.emit("tool", `${ok ? "✓" : "✗"} edit ${paths.join(", ") || "files"}`, ok);
        break;
      }
      case "mcp_tool_call": {
        const ok = item.status !== "failed";
        this.sink.emit("tool", `${ok ? "✓" : "✗"} ${[str(item.server), str(item.tool)].filter(Boolean).join(".") || "tool"}`, ok);
        break;
      }
      case "error":
        this.lastError = str(item.message) || "Codex error";
        this.sink.emit("error", this.lastError, false);
        break;
    }
  }

  finish(): AgentOutcome {
    const success = this.turnCompleted && !this.failed;
    return {
      success,
      response: this.lastMessage,
      error: success ? null : this.failed ?? this.lastError ?? "Codex ended without turn.completed",
    };
  }
}

export class CodexExecutor extends CliExecutor {
  readonly name = "codex";
  protected get bin(): string {
    return this.config.executor.codexBin;
  }
  protected args(prompt: string, workdir: string): string[] {
    return codexArgs(prompt, workdir);
  }
  protected mapper(sink: StepSink): EventMapper {
    return new CodexEventMapper(sink);
  }
}
