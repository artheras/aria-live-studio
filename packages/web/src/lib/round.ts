import type { Idea, Round, RoundPhase } from "@aria-live/shared";

export interface BallotRow {
  idea: Idea;
  number: number;
  votes: number;
  /** Whole-number percentage of all votes cast (0 when nobody voted). */
  percent: number;
  /** Bar width relative to the leader, 0..100. */
  share: number;
  isWinner: boolean;
  isLeader: boolean;
}

/**
 * Ballot rows in ballot order (round.candidates). Hidden ideas are dropped when
 * `includeHidden` is false (the overlay never shows them).
 */
export function computeBallot(round: Round, includeHidden = true): BallotRow[] {
  const byId = new Map(round.ideas.map((i) => [i.id, i]));
  const votesById = new Map(round.tallies.map((t) => [t.ideaId, t.votes]));
  const ids = round.candidates.length ? round.candidates : round.tallies.map((t) => t.ideaId);
  const ideas = ids.map((id) => byId.get(id)).filter((i): i is Idea => !!i && (includeHidden || !i.hidden));
  const total = ideas.reduce((sum, i) => sum + (votesById.get(i.id) ?? 0), 0);
  const top = ideas.reduce((m, i) => Math.max(m, votesById.get(i.id) ?? 0), 0);
  return ideas.map((idea) => {
    const votes = votesById.get(idea.id) ?? 0;
    return {
      idea,
      number: round.tallies.find((t) => t.ideaId === idea.id)?.number ?? idea.number,
      votes,
      percent: total ? Math.round((votes / total) * 100) : 0,
      share: top ? (votes / top) * 100 : 0,
      isWinner: round.winnerId === idea.id,
      isLeader: top > 0 && votes === top,
    };
  });
}

export function totalVotes(round: Round): number {
  return round.tallies.reduce((s, t) => s + t.votes, 0);
}

export function winnerIdea(round: Round | null): Idea | null {
  if (!round?.winnerId) return null;
  return round.ideas.find((i) => i.id === round.winnerId) ?? null;
}

export const STEPS = [
  { key: "collect", label: "Collect ideas" },
  { key: "vote", label: "Vote" },
  { key: "plan", label: "Plan" },
  { key: "approve", label: "Approve" },
  { key: "build", label: "Build" },
  { key: "done", label: "Done" },
] as const;

/** Index into STEPS for the current phase; -1 when idle. */
export function stepIndex(round: Round | null): number {
  const phase: RoundPhase = round?.phase ?? "idle";
  switch (phase) {
    case "idle":
      return -1;
    case "collecting":
      return 0;
    case "voting":
      return 1;
    case "decided":
    case "planning":
      return 2;
    case "awaiting_approval":
    case "rejected":
      return round?.task?.status === "approved" ? 4 : 3;
    case "executing":
      return 4;
    case "done":
      return 5;
  }
}

export const PHASE_LABEL: Record<RoundPhase, string> = {
  idle: "Idle",
  collecting: "Collecting ideas",
  voting: "Voting",
  decided: "Winner decided",
  planning: "Aria is planning",
  awaiting_approval: "Awaiting approval",
  executing: "Building",
  done: "Done",
  rejected: "Rejected",
};

export function isExecutionActive(round: Round | null): boolean {
  const s = round?.execution?.status;
  return s === "queued" || s === "running";
}
