import type { Execution, Idea, LiveState, Round, RoundPhase, Task } from "@aria-live/shared";
import type { Me } from "../src/lib/api";

const user = (login: string) => ({ id: `u-${login}`, login, displayName: login });

export function idea(n: number, text: string, extra: Partial<Idea> = {}): Idea {
  return {
    id: `i${n}`,
    number: n,
    text,
    author: user(`viewer${n}`),
    createdAt: 1_000 + n,
    hidden: false,
    seconds: 0,
    ...extra,
  };
}

export const task: Task = {
  id: "t1",
  ideaId: "i2",
  title: "Add a boss rage meter",
  summary: "Show a meter that fills as the boss takes damage.",
  userStory: "As a viewer I want to see the boss getting angry.",
  acceptanceCriteria: ["Meter visible", "Fills with damage"],
  steps: ["Add component", "Wire damage events"],
  risks: ["Might clash with HUD"],
  size: "M",
  source: "model",
  model: "claude-test",
  status: "draft",
  createdAt: 2_000,
  decidedAt: null,
  decidedBy: null,
  note: null,
};

export const execution: Execution = {
  id: "e1",
  taskId: "t1",
  status: "running",
  executor: "aria-code",
  startedAt: Date.now() - 30_000,
  endedAt: null,
  branch: "aria/round-3",
  workdir: "/tmp/secret/path",
  steps: [
    { at: Date.now() - 20_000, kind: "status", text: "Creating worktree" },
    { at: Date.now() - 10_000, kind: "tool", text: "edit src/Boss.tsx" },
  ],
  changedFiles: [],
  summary: null,
  error: null,
};

export function makeRound(phase: RoundPhase, extra: Partial<Round> = {}): Round {
  const ideas = [idea(1, "Double jump"), idea(2, "Boss rage meter"), idea(3, "Secret hat", { hidden: true })];
  const voting = phase !== "collecting";
  return {
    id: "r3",
    index: 3,
    phase,
    openedAt: 1_000,
    prompt: "features for the boss fight",
    ideas,
    candidates: voting ? ["i1", "i2", "i3"] : [],
    tallies: voting
      ? [
          { ideaId: "i1", number: 1, votes: 1 },
          { ideaId: "i2", number: 2, votes: 3 },
          { ideaId: "i3", number: 3, votes: 0 },
        ]
      : [],
    voters: voting ? 4 : 0,
    votingEndsAt: phase === "voting" ? Date.now() + 45_000 : null,
    ineligible: 0,
    winnerId: ["voting", "collecting"].includes(phase) ? null : "i2",
    task: ["awaiting_approval", "executing", "done", "rejected"].includes(phase) ? { ...task } : null,
    execution: null,
    ...extra,
  };
}

export function makeState(round: Round | null, extra: Partial<LiveState> = {}): LiveState {
  return {
    version: 1,
    connection: {
      state: "connected",
      channel: user("streamer"),
      sessionId: "sess-1",
      lastEventAt: Date.now() - 3_000,
      reconnects: 0,
      error: null,
      canReply: true,
    },
    settings: {
      ideaCooldownSec: 30,
      maxIdeaLength: 140,
      maxIdeasPerRound: 50,
      maxCandidates: 5,
      voteDurationSec: 60,
      chatReplies: true,
      executorEnabled: true,
      voteEligibility: "everyone",
      ideaEligibility: "everyone",
    },
    round,
    activity: [
      { id: "a1", at: 1_000, kind: "idea", text: "SECRET_ACTIVITY_TEXT", user: user("viewer1") },
      { id: "a2", at: 2_000, kind: "rejected", text: "Too long", user: user("viewer9") },
    ],
    stats: { rounds: 3, ideas: 12, votes: 30, participants: 9 },
    ...extra,
  };
}

export const me: Me = {
  user: user("streamer"),
  csrf: "csrf-token-123",
  configured: true,
  executor: { kind: "aria-code", ok: true },
  planner: { kind: "model", model: "claude-test" },
};
