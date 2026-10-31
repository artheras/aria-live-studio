/**
 * Talks to the Aria Live server's coding-agent API with the agent token.
 * The token can read, claim an approved task, report progress and finish
 * it; it cannot approve, reject or vote — that stays with the streamer.
 */
import type { AgentStatus, AgentTask, ExecutionStepKind } from "@aria-live/shared";

export class LiveError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
  }
}

export interface LiveClientOptions {
  baseUrl: string;
  token: string;
  fetch?: typeof fetch;
}

export class LiveClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: LiveClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.token = options.token;
    this.fetchImpl = options.fetch ?? fetch;
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    body: unknown,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<{ status: number; data: T | null }> {
    const signals = [AbortSignal.timeout(timeoutMs)];
    if (signal) signals.push(signal);
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${this.token}`,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.any(signals),
      });
    } catch (error) {
      if (signal?.aborted) throw new LiveError("Request cancelled", 0, "aborted");
      const reason = error instanceof Error ? error.message : String(error);
      throw new LiveError(
        `Cannot reach Aria Live at ${this.baseUrl} (${reason}). Is the server running and ARIA_LIVE_URL correct?`,
        0,
        "unreachable",
      );
    }
    if (response.status === 204) return { status: 204, data: null };
    const text = await response.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }
    if (!response.ok) {
      const err = (parsed ?? {}) as { error?: string; code?: string };
      const code = err.code ?? `http_${response.status}`;
      const message =
        response.status === 401
          ? "Aria Live rejected the agent token. Copy it again from the dashboard (Connect a coding agent) into ARIA_LIVE_TOKEN."
          : (err.error ?? `Aria Live returned HTTP ${response.status}`);
      throw new LiveError(message, response.status, code);
    }
    return { status: response.status, data: parsed as T };
  }

  async status(): Promise<AgentStatus> {
    const { data } = await this.request<AgentStatus>("GET", "/api/agent/status", undefined, 10_000);
    if (!data) throw new LiveError("Empty status response", 502, "bad_response");
    return data;
  }

  /** One long-poll of up to `waitSeconds` (server caps it at 60). */
  async pollTask(waitSeconds: number, signal?: AbortSignal): Promise<AgentTask | null> {
    const wait = Math.max(0, Math.min(60, Math.floor(waitSeconds)));
    const { data } = await this.request<AgentTask>(
      "GET",
      `/api/agent/task?wait=${wait}`,
      undefined,
      (wait + 15) * 1000,
      signal,
    );
    return data;
  }

  /** Waits up to `totalSeconds` for the streamer to approve a task. */
  async waitForTask(totalSeconds: number, signal?: AbortSignal): Promise<AgentTask | null> {
    const deadline = Date.now() + totalSeconds * 1000;
    for (;;) {
      const remaining = Math.ceil((deadline - Date.now()) / 1000);
      const task = await this.pollTask(Math.max(0, Math.min(60, remaining)), signal);
      if (task || remaining <= 60 || signal?.aborted) return task;
    }
  }

  async claim(taskId: string, client: string): Promise<AgentTask> {
    const { data } = await this.request<AgentTask>("POST", "/api/agent/claim", { taskId, client }, 10_000);
    if (!data) throw new LiveError("Empty claim response", 502, "bad_response");
    return data;
  }

  async progress(taskId: string, kind: ExecutionStepKind, text: string): Promise<void> {
    await this.request("POST", "/api/agent/progress", { taskId, kind, text }, 10_000);
  }

  async complete(input: {
    taskId: string;
    status: "succeeded" | "failed" | "cancelled";
    summary?: string;
    changedFiles?: string[];
    branch?: string;
    error?: string;
  }): Promise<void> {
    await this.request("POST", "/api/agent/complete", input, 10_000);
  }
}
