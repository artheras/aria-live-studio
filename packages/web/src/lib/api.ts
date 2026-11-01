import type { AgentConnection } from "./agents";
import type { ApiError, LiveState, RoundSummary, Settings, Task, TwitchUser } from "@aria-live/shared";

/** Shape of `GET /api/me`. */
export interface Me {
  user: TwitchUser | null;
  csrf: string;
  configured: boolean;
  executor: { kind: string; ok: boolean; reason?: string };
  planner: { kind: "model" | "template"; model: string | null };
}

export type TaskEdit = Partial<
  Pick<Task, "title" | "summary" | "userStory" | "acceptanceCriteria" | "steps" | "risks" | "size">
>;

/** Error thrown for any non-2xx response, carrying the server's ApiError. */
export class ApiRequestError extends Error implements ApiError {
  readonly error: string;
  readonly code: string;
  readonly status: number;
  /** Raw JSON body, when there was one (e.g. a 401 that still says `configured`). */
  readonly body: unknown;
  constructor(status: number, error: string, code: string, body: unknown) {
    super(error);
    this.name = "ApiRequestError";
    this.status = status;
    this.error = error;
    this.code = code;
    this.body = body;
  }
}

type Method = "GET" | "POST" | "PATCH";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export async function request<T>(method: Method, path: string, body?: unknown, csrf?: string | null): Promise<T> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (method !== "GET" && csrf) headers["x-aria-csrf"] = csrf;

  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: "include",
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiRequestError(0, "Can't reach the Aria server. Is it running?", "network", null);
  }

  const data = await readBody(res);
  if (!res.ok) {
    const error =
      isRecord(data) && typeof data.error === "string"
        ? data.error
        : typeof data === "string" && data.length < 200 && data
          ? data
          : `Request failed (${res.status})`;
    const code = isRecord(data) && typeof data.code === "string" ? data.code : `http_${res.status}`;
    throw new ApiRequestError(res.status, error, code, data);
  }
  return data as T;
}

/** Dashboard client. Every mutating call sends the CSRF token from /api/me. */
export function createApi(getCsrf: () => string | null) {
  const post = <T = unknown>(path: string, body: unknown = {}) => request<T>("POST", path, body, getCsrf());
  const patch = <T = unknown>(path: string, body: unknown) => request<T>("PATCH", path, body, getCsrf());
  return {
    me: () => request<Me>("GET", "/api/me"),
    state: () => request<LiveState>("GET", "/api/state"),
    history: async (): Promise<RoundSummary[]> => {
      const data = await request<unknown>("GET", "/api/history");
      if (Array.isArray(data)) return data as RoundSummary[];
      if (isRecord(data) && Array.isArray(data.rounds)) return data.rounds as RoundSummary[];
      return [];
    },
    overlayUrl: async (): Promise<string> => {
      const data = await request<unknown>("GET", "/api/overlay-url");
      const raw = typeof data === "string" ? data : isRecord(data) && typeof data.url === "string" ? data.url : "";
      if (!raw) throw new ApiRequestError(200, "Server did not return an overlay URL", "bad_response", data);
      return new URL(raw, window.location.origin).toString();
    },
    agentConnection: async (): Promise<AgentConnection> => {
      const data = await request<unknown>("GET", "/api/agent-connection");
      if (isRecord(data) && typeof data.token === "string" && typeof data.mcpUrl === "string") {
        const conn: AgentConnection = {
          token: data.token,
          mcpUrl: data.mcpUrl.startsWith("/") ? window.location.origin + data.mcpUrl : data.mcpUrl,
        };
        const cmd = data.mcpCommand;
        if (
          isRecord(cmd) &&
          typeof cmd.command === "string" &&
          Array.isArray(cmd.args) &&
          cmd.args.every((a) => typeof a === "string")
        ) {
          conn.mcpCommand = { command: cmd.command, args: cmd.args as string[] };
        }
        const remote = data.remote;
        if (isRecord(remote) && typeof remote.agentUrl === "string" && typeof remote.cohostUrl === "string") {
          const abs = (u: string) => (u.startsWith("/") ? window.location.origin + u : u);
          conn.remote = { agentUrl: abs(remote.agentUrl), cohostUrl: abs(remote.cohostUrl) };
        }
        return conn;
      }
      throw new ApiRequestError(200, "Server did not return agent connection details", "bad_response", data);
    },
    settings: (patchBody: Partial<Settings>) => patch("/api/settings", patchBody),
    openRound: (prompt?: string) => post("/api/round/open", prompt ? { prompt } : {}),
    startVote: () => post("/api/round/vote"),
    closeVote: () => post("/api/round/close"),
    resetRound: () => post("/api/round/reset"),
    hideIdea: (id: string, hidden: boolean) => post(`/api/ideas/${encodeURIComponent(id)}/hide`, { hidden }),
    planTask: () => post("/api/task/plan"),
    editTask: (edit: TaskEdit) => patch("/api/task", edit),
    approveTask: () => post("/api/task/approve"),
    rejectTask: (note?: string) => post("/api/task/reject", note ? { note } : {}),
    startExecution: () => post("/api/execution/start"),
    cancelExecution: () => post("/api/execution/cancel"),
    logout: () => post("/auth/logout"),
  };
}

export type AriaApi = ReturnType<typeof createApi>;

export function errorMessage(err: unknown): string {
  if (err instanceof ApiRequestError) return err.error;
  if (err instanceof Error) return err.message;
  return String(err);
}
