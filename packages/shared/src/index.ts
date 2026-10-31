/**
 * The one contract between the server, the streamer dashboard and the OBS
 * overlay. The server owns all state; clients render snapshots of it and
 * change it only through the REST actions listed in `Api`.
 *
 * The loop this models: viewers propose (!idea) -> the community votes
 * (!vote) -> Aria turns the winner into a task -> the streamer approves ->
 * the task runs in an isolated workspace -> everyone sees the result.
 */

// ── People ───────────────────────────────────────────────────────────────

export interface TwitchUser {
  id: string;
  login: string;
  displayName: string;
}

export type ChatRole = "broadcaster" | "moderator" | "vip" | "subscriber" | "viewer";

// ── Ideas and votes ──────────────────────────────────────────────────────

export interface Idea {
  id: string;
  /** Number viewers vote with: `!vote 3`. Stable within a round. */
  number: number;
  text: string;
  author: TwitchUser;
  createdAt: number;
  /** Hidden by the streamer or a moderator; never shown on the overlay. */
  hidden: boolean;
  /** Viewers who sent the same idea again (+1s) — a signal, not a vote. */
  seconds: number;
}

export type RoundPhase =
  | "idle" // no round open
  | "collecting" // !idea accepted
  | "voting" // !vote accepted on the frozen candidate list
  | "decided" // voting closed, winner known
  | "planning" // Aria is turning the winner into a task
  | "awaiting_approval" // task drafted, streamer must approve or reject
  | "executing" // approved task is running
  | "done" // execution finished (any outcome) — see execution.status
  | "rejected"; // streamer rejected the task

export interface Tally {
  ideaId: string;
  number: number;
  votes: number;
}

export interface Round {
  id: string;
  index: number;
  phase: RoundPhase;
  openedAt: number;
  /** Optional theme the streamer gives the round ("features for the boss fight"). */
  prompt: string;
  ideas: Idea[];
  /** Idea ids frozen into the ballot when voting starts, in ballot order. */
  candidates: string[];
  tallies: Tally[];
  voters: number;
  votingEndsAt: number | null;
  winnerId: string | null;
  task: Task | null;
  execution: Execution | null;
}

// ── Tasks (Aria's structured interpretation of the winning idea) ─────────

export type TaskStatus = "draft" | "approved" | "rejected";

export interface Task {
  id: string;
  ideaId: string;
  title: string;
  summary: string;
  userStory: string;
  acceptanceCriteria: string[];
  steps: string[];
  risks: string[];
  /** Rough size so the streamer can judge if it fits the stream. */
  size: "S" | "M" | "L";
  /** Where the plan came from: a model, or the built-in fallback template. */
  source: "model" | "template";
  model: string | null;
  status: TaskStatus;
  createdAt: number;
  decidedAt: number | null;
  decidedBy: string | null;
  /** Why the streamer rejected it, if they said. */
  note: string | null;
}

// ── Execution (only after the streamer approves) ─────────────────────────

export type ExecutionStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export type ExecutionStepKind = "status" | "tool" | "answer" | "output" | "error";

export interface ExecutionStep {
  at: number;
  kind: ExecutionStepKind;
  /** One line, already safe to show on stream (no secrets, no control chars). */
  text: string;
  ok?: boolean;
}

export interface Execution {
  id: string;
  taskId: string;
  status: ExecutionStatus;
  executor: string; // e.g. "aria-code", "disabled"
  startedAt: number;
  endedAt: number | null;
  /** Isolated git worktree / branch the change was made on, if any. */
  branch: string | null;
  workdir: string | null;
  steps: ExecutionStep[];
  changedFiles: string[];
  summary: string | null;
  error: string | null;
}

// ── Connection and settings ──────────────────────────────────────────────

export type TwitchConnectionState =
  | "signed_out"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "error";

export interface Connection {
  state: TwitchConnectionState;
  channel: TwitchUser | null;
  /** EventSub WebSocket session id while connected. */
  sessionId: string | null;
  lastEventAt: number | null;
  reconnects: number;
  error: string | null;
  /** Whether the bot can reply in chat (user:write:chat granted). */
  canReply: boolean;
}

export interface Settings {
  /** Seconds a viewer waits between two !idea submissions. */
  ideaCooldownSec: number;
  maxIdeaLength: number;
  maxIdeasPerRound: number;
  /** How many ideas go on the ballot (most +1'd first, then oldest). */
  maxCandidates: number;
  /** 0 = streamer closes the vote by hand. */
  voteDurationSec: number;
  /** Reply in chat to acknowledge ideas/votes (rate limited). */
  chatReplies: boolean;
  /** Execution adapter is configured and allowed to run. */
  executorEnabled: boolean;
}

// ── Activity feed (what scrolls on the dashboard) ────────────────────────

export type ActivityKind =
  | "idea"
  | "idea_duplicate"
  | "vote"
  | "rejected"
  | "round"
  | "task"
  | "execution"
  | "system";

export interface Activity {
  id: string;
  at: number;
  kind: ActivityKind;
  text: string;
  user?: TwitchUser;
}

// ── What clients receive ─────────────────────────────────────────────────

export interface LiveState {
  version: number;
  connection: Connection;
  settings: Settings;
  round: Round | null;
  /** Newest last, bounded. Overlay snapshots omit it. */
  activity: Activity[];
  stats: {
    rounds: number;
    ideas: number;
    votes: number;
    participants: number;
  };
}

export type ServerMessage =
  | { type: "snapshot"; state: LiveState }
  | { type: "hello"; role: ClientRole; serverTime: number };

export type ClientRole = "dashboard" | "overlay";

// ── History ──────────────────────────────────────────────────────────────

export interface RoundSummary {
  id: string;
  index: number;
  openedAt: number;
  closedAt: number | null;
  prompt: string;
  ideaCount: number;
  voters: number;
  winner: { number: number; text: string; author: TwitchUser; votes: number } | null;
  task: Pick<Task, "title" | "status" | "size" | "source"> | null;
  execution: Pick<Execution, "status" | "branch" | "changedFiles" | "summary"> | null;
}

// ── REST actions (dashboard only; all require the broadcaster session) ───

export const Api = {
  state: "GET /api/state",
  me: "GET /api/me",
  history: "GET /api/history",
  overlayUrl: "GET /api/overlay-url",
  settings: "PATCH /api/settings", // Partial<Settings>
  openRound: "POST /api/round/open", // { prompt?: string }
  startVote: "POST /api/round/vote", // {}
  closeVote: "POST /api/round/close", // {}
  resetRound: "POST /api/round/reset", // {}
  hideIdea: "POST /api/ideas/:id/hide", // { hidden: boolean }
  planTask: "POST /api/task/plan", // {} — (re)generate the task for the winner
  editTask: "PATCH /api/task", // Partial<Pick<Task,"title"|"summary"|"userStory"|"acceptanceCriteria"|"steps"|"risks"|"size">>
  approveTask: "POST /api/task/approve", // {}
  rejectTask: "POST /api/task/reject", // { note?: string }
  startExecution: "POST /api/execution/start", // {}
  cancelExecution: "POST /api/execution/cancel", // {}
  login: "GET /auth/twitch/login",
  callback: "GET /auth/twitch/callback",
  logout: "POST /auth/logout",
  ws: "GET /ws?role=dashboard | /ws?role=overlay&key=OVERLAY_KEY",
} as const;

export interface ApiError {
  error: string;
  /** Machine-readable reason, e.g. "wrong_phase", "not_broadcaster". */
  code: string;
}

// ── Chat commands ────────────────────────────────────────────────────────

export const COMMANDS = {
  idea: "!idea",
  vote: "!vote",
  ideas: "!ideas",
  help: "!aria",
} as const;
