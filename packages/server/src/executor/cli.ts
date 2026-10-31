/** Shared run loop for agent CLIs: worktree -> spawn -> map JSONL events -> result. */
import { randomUUID } from "node:crypto";
import type { ExecutionStepKind, Task } from "@aria-live/shared";
import type { Config } from "../config.ts";
import type { ExecutionHooks, ExecutionResult, Executor } from "../contracts.ts";
import { changedFiles, createWorktree, repoProblem } from "./git.ts";
import { binaryWorks, childEnv, runProcess } from "./process.ts";
import { buildExecutionPrompt } from "./prompt.ts";
import { streamSafe } from "./safe-text.ts";

export type ExecutorConfig = Pick<Config, "executor" | "dataDir">;

/** Turns agent output into stream-safe steps; answer deltas are coalesced into ~1-line steps. */
export class StepSink {
  private answer = "";
  private lastStatus = "";

  constructor(private readonly onStep: ExecutionHooks["onStep"]) {}

  emit(kind: ExecutionStepKind, text: unknown, ok?: boolean): void {
    if (kind !== "answer") this.flush();
    const safe = streamSafe(text);
    if (!safe) return;
    if (kind === "status") {
      if (safe === this.lastStatus) return;
      this.lastStatus = safe;
    }
    this.onStep(ok === undefined ? { at: Date.now(), kind, text: safe } : { at: Date.now(), kind, text: safe, ok });
  }

  answerDelta(text: unknown): void {
    if (typeof text !== "string") return;
    this.answer += text;
    let idx: number;
    while ((idx = this.answer.indexOf("\n")) >= 0) {
      this.emitAnswer(this.answer.slice(0, idx));
      this.answer = this.answer.slice(idx + 1);
    }
    if (this.answer.length >= 160) {
      const cut = this.answer.lastIndexOf(" ", 160);
      const at = cut > 80 ? cut : 160;
      this.emitAnswer(this.answer.slice(0, at));
      this.answer = this.answer.slice(at);
    }
  }

  /** A whole message: one answer step per non-empty line. */
  answerText(text: unknown): void {
    if (typeof text !== "string") return;
    this.flush();
    for (const line of text.split("\n")) this.emitAnswer(line);
  }

  flush(): void {
    const rest = this.answer;
    this.answer = "";
    this.emitAnswer(rest);
  }

  private emitAnswer(line: string): void {
    const safe = streamSafe(line);
    if (safe) this.onStep({ at: Date.now(), kind: "answer", text: safe });
  }
}

export interface AgentOutcome {
  /** Whether the agent reported that its turn finished successfully. */
  success: boolean;
  response: string | null;
  error: string | null;
}

export interface EventMapper {
  onEvent(event: Record<string, unknown> & { type: string }): void;
  finish(): AgentOutcome;
}

export abstract class CliExecutor implements Executor {
  abstract readonly name: string;
  protected abstract readonly bin: string;

  constructor(protected readonly config: ExecutorConfig) {}

  protected abstract args(prompt: string, workdir: string): string[];
  protected abstract mapper(sink: StepSink): EventMapper;
  protected env(): NodeJS.ProcessEnv {
    return childEnv();
  }

  async check(): Promise<{ ok: boolean; reason?: string }> {
    const bin = await binaryWorks(this.bin);
    if (!bin.ok) return bin;
    const problem = await repoProblem(this.config.executor.targetRepo);
    return problem ? { ok: false, reason: problem } : { ok: true };
  }

  async run(task: Task, hooks: ExecutionHooks): Promise<ExecutionResult> {
    const sink = new StepSink(hooks.onStep);
    const result = (r: Partial<ExecutionResult> & Pick<ExecutionResult, "status">): ExecutionResult => ({
      branch: null,
      workdir: null,
      changedFiles: [],
      summary: null,
      error: null,
      ...r,
    });
    if (hooks.signal.aborted) return result({ status: "cancelled", error: "Cancelled before start" });

    const repo = this.config.executor.targetRepo;
    if (!repo) return result({ status: "failed", error: "TARGET_REPO is not set" });
    let wt;
    try {
      wt = await createWorktree(repo, this.config.dataDir, `${task.id}-${randomUUID().slice(0, 8)}`, task.title);
    } catch (err) {
      const error = streamSafe((err as Error).message, 300);
      sink.emit("error", error, false);
      return result({ status: "failed", error });
    }
    sink.emit("status", `Isolated worktree ready on branch ${wt.branch}`);
    if (hooks.signal.aborted) {
      return result({ status: "cancelled", branch: wt.branch, workdir: wt.dir, error: "Cancelled by the streamer" });
    }

    const mapper = this.mapper(sink);
    sink.emit("status", `Starting ${this.name}`);
    const proc = await runProcess({
      bin: this.bin,
      args: this.args(buildExecutionPrompt(task, wt.branch), wt.dir),
      cwd: wt.dir,
      env: this.env(),
      signal: hooks.signal,
      timeoutMs: Math.max(1, this.config.executor.timeoutSec) * 1000,
      onLine: (line) => {
        const event = parseEvent(line);
        if (event) mapper.onEvent(event);
        else sink.emit("output", line);
      },
    });
    sink.flush();
    const agent = mapper.finish();

    let files: string[] = [];
    try {
      files = await changedFiles(wt.dir);
    } catch (err) {
      sink.emit("error", `Could not list changed files: ${(err as Error).message}`, false);
    }

    let status: ExecutionResult["status"];
    let error: string | null = null;
    if (proc.cancelled) {
      status = "cancelled";
      error = "Cancelled by the streamer";
    } else if (proc.timedOut) {
      status = "failed";
      error = "timed out";
    } else if (proc.spawnError) {
      status = "failed";
      error = `Could not start ${this.bin}: ${proc.spawnError}`;
    } else if (agent.success && proc.code === 0) {
      status = "succeeded";
    } else {
      status = "failed";
      error =
        agent.error ??
        (proc.code !== 0
          ? `${this.name} exited with ${proc.code ?? proc.signal}${proc.stderrTail ? `: ${proc.stderrTail.trim().split("\n").pop()}` : ""}`
          : `${this.name} did not report success`);
    }
    error = error ? streamSafe(error, 300) : null;

    const response = agent.response ? streamSafe(agent.response, 300) : "";
    const summary = `Branch ${wt.branch}: ${files.length} file${files.length === 1 ? "" : "s"} changed.${response ? ` ${response}` : ""}`;
    if (error) sink.emit("error", error, false);
    sink.emit("status", `Finished: ${status} — ${files.length} file(s) changed on ${wt.branch}`, status === "succeeded");
    return result({ status, branch: wt.branch, workdir: wt.dir, changedFiles: files, summary, error });
  }
}

function parseEvent(line: string): (Record<string, unknown> & { type: string }) | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const value = JSON.parse(trimmed);
    if (value && typeof value === "object" && !Array.isArray(value) && typeof value.type === "string") return value;
  } catch {
    // not JSON: shown as output
  }
  return null;
}
