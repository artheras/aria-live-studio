/**
 * Seams between the live loop (rounds, chat, votes) and the two pieces that
 * act on a winning idea. The server core depends only on these interfaces;
 * planner/ and executor/ implement them.
 */
import type { ExecutionStatus, ExecutionStep, Idea, Round, Task } from "@aria-live/shared";

/** What a planner returns: the Task fields it is responsible for. */
export type PlannedTask = Pick<
  Task,
  "title" | "summary" | "userStory" | "acceptanceCriteria" | "steps" | "risks" | "size" | "source" | "model"
>;

export interface PlanInput {
  idea: Idea;
  round: Pick<Round, "prompt" | "index">;
  /** Free-text description of the project being built on stream (PROJECT_BRIEF). */
  projectBrief: string;
  /** Other ballot ideas, for context only (so the plan does not duplicate them). */
  otherIdeas: string[];
  signal: AbortSignal;
}

export interface Planner {
  readonly name: string;
  plan(input: PlanInput): Promise<PlannedTask>;
}

export interface ExecutionResult {
  status: Exclude<ExecutionStatus, "queued" | "running">;
  branch: string | null;
  workdir: string | null;
  changedFiles: string[];
  summary: string | null;
  error: string | null;
}

export interface ExecutionHooks {
  /** Called for every progress step; text must already be stream-safe. */
  onStep(step: ExecutionStep): void;
  /** Aborted when the streamer cancels. The executor must stop its child processes. */
  signal: AbortSignal;
}

export interface Executor {
  readonly name: string;
  /** Whether this executor can run here (binary present, target repo is a git repo …). */
  check(): Promise<{ ok: boolean; reason?: string }>;
  run(task: Task, hooks: ExecutionHooks): Promise<ExecutionResult>;
}
