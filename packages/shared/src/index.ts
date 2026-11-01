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

/** Who may take part in a round, from chat badges. VIPs, moderators and the
 *  broadcaster are always eligible; "subscribers" also counts founders. */
export type Eligibility = "everyone" | "subscribers" | "vip_mod";

export const ELIGIBILITY_LABEL: Record<Eligibility, string> = {
  everyone: "Everyone",
  subscribers: "Subscribers",
  vip_mod: "VIPs & mods",
};

export function isEligible(role: ChatRole, rule: Eligibility): boolean {
  if (rule === "everyone") return true;
  if (role === "broadcaster" || role === "moderator" || role === "vip") return true;
  return rule === "subscribers" && role === "subscriber";
}

/** Roles that may drive the round from chat with `!aria open|vote|close|extend|hide`. */
export function isModRole(role: ChatRole): boolean {
  return role === "broadcaster" || role === "moderator";
}

// ── Ideas and votes ──────────────────────────────────────────────────────

export interface Idea {
  id: string;
  /** Submission order within the round (#1, #2 …). Votes use the ballot
   *  number instead (`Tally.number`), assigned when voting starts. */
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
  /** !idea / !vote attempts refused by the eligibility settings this round. */
  ineligible: number;
  winnerId: string | null;
  task: Task | null;
  execution: Execution | null;
  /** Twitch stream markers created this round (only while the channel is live). */
  markers: StreamMarker[];
}

/** A Twitch stream marker as returned by Helix (POST /streams/markers). */
export interface StreamMarker {
  label: string;
  /** Offset into the broadcast (and its VOD) reported by Twitch. */
  positionSeconds: number;
  /** epoch ms, from Twitch's created_at */
  createdAt: number;
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
  /** Twitch clip of the finished build (https://clips.twitch.tv/<id>), once Twitch confirmed it exists. */
  clipUrl?: string | null;
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
  /** OAuth scopes granted to the current token. */
  scopes: string[];
  /** Scopes from `TWITCH_SCOPES` the token lacks (reconnect to grant them). */
  missingScopes: string[];
}

/** Everything the studio asks for at login, and what each one is for. */
export const TWITCH_SCOPES = ["user:read:chat", "user:write:chat", "channel:manage:broadcast", "clips:edit"] as const;
export type TwitchScope = (typeof TWITCH_SCOPES)[number];

/** Scopes each optional Twitch feature needs. */
export const FEATURE_SCOPE = {
  autoTitle: "channel:manage:broadcast",
  streamMarkers: "channel:manage:broadcast",
  autoClip: "clips:edit",
} as const satisfies Record<string, TwitchScope>;

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
  /** Who may !vote. */
  voteEligibility: Eligibility;
  /** Who may !idea (and +1 an idea). */
  ideaEligibility: Eligibility;
  /** Set the Twitch stream title to the approved task, restore it afterwards (channel:manage:broadcast). */
  autoTitle: boolean;
  /** Add Twitch stream markers at the round's key moments (channel:manage:broadcast). */
  streamMarkers: boolean;
  /** Clip the last ~30 s when a build succeeds (clips:edit). */
  autoClip: boolean;
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
  execution: (Pick<Execution, "status" | "branch" | "changedFiles" | "summary"> & { clipUrl?: string | null }) | null;
  /** Stream markers of the round; `url` deep-links into the VOD when it was found. */
  markers?: (StreamMarker & { url?: string })[];
  /** The past-broadcast VOD the markers belong to (Helix GET /videos). */
  vodUrl?: string | null;
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
  // Coding-agent API (MCP bridge for Codex / Claude Code / Aria Code).
  // Authorization: Bearer AGENT_TOKEN. Agents can read, claim an APPROVED
  // task, report progress and finish it — never approve, reject or vote.
  agentStatus: "GET /api/agent/status", // -> AgentStatus
  agentWait: "GET /api/agent/task?wait=SECONDS", // long-poll (<= 60s) until a task is approved and unclaimed -> AgentTask | 204
  agentClaim: "POST /api/agent/claim", // { taskId, client } -> AgentTask (409 if not approved / already running)
  agentProgress: "POST /api/agent/progress", // { taskId, kind: ExecutionStepKind, text } -> 204
  agentComplete: "POST /api/agent/complete", // { taskId, status: "succeeded"|"failed"|"cancelled", summary?, changedFiles?, branch?, error? } -> 204
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

// ── Coding-agent API payloads ─────────────────────────────────────────────

export interface AgentStatus {
  connected: boolean; // Twitch EventSub connected
  channel: string | null;
  phase: RoundPhase | "none";
  roundIndex: number | null;
  prompt: string | null;
  ballot: { number: number; text: string; votes: number }[];
  winner: { number: number; text: string; votes: number } | null;
  task: { id: string; title: string; status: TaskStatus } | null;
  execution: { status: ExecutionStatus; executor: string } | null;
}

/** An approved task as handed to a coding agent. Viewer text is untrusted. */
export interface AgentTask {
  taskId: string;
  roundIndex: number;
  idea: { text: string; author: string; votes: number };
  task: Pick<Task, "title" | "summary" | "userStory" | "acceptanceCriteria" | "steps" | "risks" | "size">;
  projectBrief: string;
  /** Ready-to-use instructions; the idea is quoted inside an untrusted block. */
  instructions: string;
  claimed: boolean;
}

// ── Chat commands ────────────────────────────────────────────────────────

export const COMMANDS = {
  idea: "!idea",
  vote: "!vote",
  ideas: "!ideas",
  help: "!aria",
  /** `!+1 <n>` is the same as `!idea +<n>`: +1 idea #n while ideas are open. */
  plusOne: "!+1",
} as const;

/** Moderator / broadcaster sub-commands of `!aria`. Planning, approving and
 *  running builds are dashboard-only and have no chat command. */
export const MOD_COMMANDS = {
  open: "!aria open",
  vote: "!aria vote",
  close: "!aria close",
  extend: "!aria extend",
  hide: "!aria hide",
} as const;

export const EXTEND_MIN_SEC = 5;
export const EXTEND_MAX_SEC = 300;
