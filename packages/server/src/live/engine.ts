/**
 * The round engine: a pure, deterministic state machine over LiveState.
 * No I/O, no timers — the clock and the id generator are injected, and the
 * service calls `tick()` to auto-close timed votes.
 *
 * Numbering: `Idea.number` is the submission number within the round
 * ("Idea #7 added"). When voting starts the ballot is frozen and numbered
 * 1..N in ballot order (`Round.candidates`, `Tally.number`). `!vote n`
 * refers to the BALLOT number n, which is what the overlay shows.
 */
import {
  EXTEND_MAX_SEC,
  EXTEND_MIN_SEC,
  isEligible,
  type Activity,
  type ActivityKind,
  type ChatRole,
  type Connection,
  type Eligibility,
  type Execution,
  type ExecutionStep,
  type Idea,
  type LiveState,
  type Round,
  type RoundSummary,
  type Settings,
  type StreamMarker,
  type Task,
  type TwitchUser,
} from "@aria-live/shared";
import type { ExecutionResult, PlannedTask } from "../contracts.ts";
import { cleanText, containsLink, jaccard, normalizeIdea, streamSafeLine, tokenSet } from "./text.ts";

export type EngineErrorCode =
  | "wrong_phase"
  | "bad_input"
  | "no_round"
  | "no_ideas"
  | "no_winner"
  | "not_found"
  | "not_approved";

const STATUS: Record<EngineErrorCode, number> = {
  wrong_phase: 409,
  bad_input: 400,
  no_round: 409,
  no_ideas: 409,
  no_winner: 409,
  not_found: 404,
  not_approved: 409,
};

export class EngineError extends Error {
  readonly status: number;
  constructor(
    readonly code: EngineErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "EngineError";
    this.status = STATUS[code];
  }
}

export interface EngineDeps {
  now(): number;
  id(): string;
}

export const DEFAULT_SETTINGS: Settings = {
  ideaCooldownSec: 30,
  maxIdeaLength: 140,
  maxIdeasPerRound: 50,
  maxCandidates: 5,
  voteDurationSec: 60,
  chatReplies: true,
  executorEnabled: false,
  voteEligibility: "everyone",
  ideaEligibility: "everyone",
  autoTitle: true,
  streamMarkers: true,
  autoClip: true,
};

const BOOLEAN_SETTINGS = ["chatReplies", "executorEnabled", "autoTitle", "streamMarkers", "autoClip"] as const;

const ELIGIBILITIES: readonly Eligibility[] = ["everyone", "subscribers", "vip_mod"];

export const SIGNED_OUT: Connection = {
  state: "signed_out",
  channel: null,
  sessionId: null,
  lastEventAt: null,
  reconnects: 0,
  error: null,
  canReply: false,
  scopes: [],
  missingScopes: [],
};

export const ACTIVITY_LIMIT = 200;
export const STEP_LIMIT = 300;
const NEAR_DUP = 0.8;

/** Why a viewer's !idea or !vote was not accepted. */
export type ViewerRejection =
  | "empty"
  | "too_long"
  | "link"
  | "cooldown"
  | "round_full"
  | "hidden_duplicate"
  | "invalid_vote"
  | "no_such_idea"
  /** Blocked by voteEligibility / ideaEligibility. */
  | "ineligible";

/** `notify` (ineligible only): first refusal for this user this round, so reply once. */
type Rejection = { ok: false; code: ViewerRejection; reason: string; retryInSec?: number; notify?: boolean };

export type IdeaResult =
  | { ok: true; kind: "added"; idea: Idea }
  /** Same idea as an existing one; `counted` = this user's +1 was added. */
  | { ok: true; kind: "duplicate"; idea: Idea; counted: boolean }
  | Rejection;

export type VoteResult = { ok: true; ballotNumber: number; ideaId: string; changed: boolean; unchanged: boolean } | Rejection;

/** Data the engine needs that is not part of the public LiveState. */
export interface EngineInternals {
  /** userId -> ideaId voted for in the current round. */
  votes: Record<string, string>;
  /** ideaId -> userIds who +1'd it. */
  seconders: Record<string, string[]>;
  /** userId -> last !idea timestamp (current round). */
  lastIdeaAt: Record<string, number>;
  /** All-time distinct participants. */
  participants: string[];
  /** userIds already told they are not eligible this round. */
  ineligibleNotified?: string[];
  /** The stream title before Aria changed it, kept so a restart can still restore it. */
  streamTitle?: StreamTitleMemo | null;
}

export interface StreamTitleMemo {
  /** Title before Aria changed it. */
  original: string;
  /** Title Aria set (restore only while Twitch still shows this one). */
  ours: string;
}

/** Moments of the round other parts of the server react to (stream markers, title, clip). */
export type Milestone =
  | { kind: "round_opened"; round: Round }
  | { kind: "vote_started"; round: Round }
  | { kind: "winner"; round: Round; idea: Idea }
  | { kind: "task_approved"; round: Round; task: Task }
  | { kind: "build_started"; round: Round; execution: Execution }
  | { kind: "build_finished"; round: Round; execution: Execution };

export interface EngineSnapshot {
  state: Omit<LiveState, "activity"> & { activity?: Activity[] };
  internals: EngineInternals;
}

export type EngineEvent =
  | { type: "change"; state: LiveState }
  | { type: "archive"; summary: RoundSummary }
  | { type: "milestone"; milestone: Milestone };

const EDITABLE_TASK_FIELDS = ["title", "summary", "userStory", "acceptanceCriteria", "steps", "risks", "size"] as const;
export type TaskPatch = Partial<Pick<Task, (typeof EDITABLE_TASK_FIELDS)[number]>>;

export class RoundEngine {
  private s: LiveState;
  private votes = new Map<string, string>();
  private seconders = new Map<string, Set<string>>();
  private lastIdeaAt = new Map<string, number>();
  private participants = new Set<string>();
  private ineligibleNotified = new Set<string>();
  private titleMemo: StreamTitleMemo | null = null;
  private listeners = new Set<(e: EngineEvent) => void>();

  constructor(
    private readonly deps: EngineDeps,
    snapshot?: EngineSnapshot,
  ) {
    this.s = {
      version: 0,
      connection: { ...SIGNED_OUT },
      settings: { ...DEFAULT_SETTINGS },
      round: null,
      activity: [],
      stats: { rounds: 0, ideas: 0, votes: 0, participants: 0 },
    };
    if (snapshot) this.restore(snapshot);
  }

  // ── observation ────────────────────────────────────────────────────────

  get state(): LiveState {
    return this.s;
  }

  get round(): Round | null {
    return this.s.round;
  }

  on(fn: (e: EngineEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(e: EngineEvent): void {
    for (const fn of this.listeners) fn(e);
  }

  private changed(): void {
    this.s.version++;
    this.s.stats.participants = this.participants.size;
    this.emit({ type: "change", state: this.s });
  }

  snapshot(): EngineSnapshot {
    const { activity: _a, ...rest } = this.s;
    const seconders: Record<string, string[]> = {};
    for (const [k, v] of this.seconders) seconders[k] = [...v];
    return {
      state: structuredClone(rest),
      internals: {
        votes: Object.fromEntries(this.votes),
        seconders,
        lastIdeaAt: Object.fromEntries(this.lastIdeaAt),
        participants: [...this.participants],
        ineligibleNotified: [...this.ineligibleNotified],
        streamTitle: this.titleMemo ? { ...this.titleMemo } : null,
      },
    };
  }

  private restore(snap: EngineSnapshot): void {
    const st = structuredClone(snap.state);
    this.s = {
      version: st.version ?? 0,
      connection: { ...SIGNED_OUT },
      settings: { ...DEFAULT_SETTINGS, ...st.settings },
      round: st.round ?? null,
      activity: st.activity ?? [],
      stats: { ...{ rounds: 0, ideas: 0, votes: 0, participants: 0 }, ...st.stats },
    };
    const i = snap.internals;
    this.votes = new Map(Object.entries(i?.votes ?? {}));
    this.seconders = new Map(Object.entries(i?.seconders ?? {}).map(([k, v]) => [k, new Set(v)]));
    this.lastIdeaAt = new Map(Object.entries(i?.lastIdeaAt ?? {}));
    this.participants = new Set(i?.participants ?? []);
    this.ineligibleNotified = new Set(i?.ineligibleNotified ?? []);
    const memo = i?.streamTitle;
    this.titleMemo = memo && typeof memo.original === "string" && memo.ours ? { original: memo.original, ours: memo.ours } : null;
    this.s.stats.participants = this.participants.size;

    const r = this.s.round;
    if (r && typeof r.ineligible !== "number") r.ineligible = 0; // snapshots from before eligibility
    if (r && !Array.isArray(r.markers)) r.markers = []; // snapshots from before stream markers
    if (r?.phase === "executing") {
      const now = this.deps.now();
      r.phase = "done";
      if (r.execution) {
        r.execution.status = "failed";
        r.execution.endedAt = now;
        r.execution.error = "server restarted during execution";
      }
      this.activity("execution", "Execution interrupted: server restarted during execution");
    } else if (r?.phase === "planning") {
      r.phase = "decided";
      this.activity("task", "Planning interrupted by a server restart");
    }
  }

  // ── helpers ────────────────────────────────────────────────────────────

  private activity(kind: ActivityKind, text: string, user?: Actor): void {
    const a: Activity = { id: this.deps.id(), at: this.deps.now(), kind, text: streamSafeLine(text, 300) };
    if (user && !isApp(user)) a.user = user;
    this.s.activity.push(a);
    if (this.s.activity.length > ACTIVITY_LIMIT) this.s.activity.splice(0, this.s.activity.length - ACTIVITY_LIMIT);
  }

  private requireRound(): Round {
    const r = this.s.round;
    if (!r) throw new EngineError("no_round", "No round is open");
    return r;
  }

  private requirePhase(...phases: Round["phase"][]): Round {
    const r = this.requireRound();
    if (!phases.includes(r.phase)) {
      throw new EngineError("wrong_phase", `Not allowed while the round is ${r.phase} (needs ${phases.join(" or ")})`);
    }
    return r;
  }

  private ideaById(r: Round, id: string): Idea | undefined {
    return r.ideas.find((i) => i.id === id);
  }

  private participate(user: TwitchUser): void {
    this.participants.add(user.id);
  }

  winner(): Idea | null {
    const r = this.s.round;
    if (!r?.winnerId) return null;
    return this.ideaById(r, r.winnerId) ?? null;
  }

  // ── connection & settings ──────────────────────────────────────────────

  setConnection(patch: Partial<Connection>): void {
    this.s.connection = { ...this.s.connection, ...patch };
    this.changed();
  }

  updateSettings(patch: Record<string, unknown>): Settings {
    const next = { ...this.s.settings };
    const ints: Record<string, [number, number]> = {
      ideaCooldownSec: [0, 3600],
      maxIdeaLength: [10, 500],
      maxIdeasPerRound: [1, 500],
      maxCandidates: [2, 20],
      voteDurationSec: [0, 3600],
    };
    for (const [k, v] of Object.entries(patch)) {
      if (k in ints) {
        const [min, max] = ints[k]!;
        if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) {
          throw new EngineError("bad_input", `${k} must be an integer between ${min} and ${max}`);
        }
        (next as unknown as Record<string, number>)[k] = v;
      } else if ((BOOLEAN_SETTINGS as readonly string[]).includes(k)) {
        if (typeof v !== "boolean") throw new EngineError("bad_input", `${k} must be a boolean`);
        next[k as (typeof BOOLEAN_SETTINGS)[number]] = v;
      } else if (k === "voteEligibility" || k === "ideaEligibility") {
        if (!ELIGIBILITIES.includes(v as Eligibility)) {
          throw new EngineError("bad_input", `${k} must be one of ${ELIGIBILITIES.join(", ")}`);
        }
        next[k] = v as Eligibility;
      } else {
        throw new EngineError("bad_input", `Unknown setting: ${k}`);
      }
    }
    this.s.settings = next;
    this.activity("system", "Settings updated");
    this.changed();
    return next;
  }

  // ── rounds ─────────────────────────────────────────────────────────────

  /** `by`: the moderator who opened it from chat (dashboard actions pass nothing). */
  openRound(prompt = "", by?: Actor): Round {
    const cur = this.s.round;
    if (cur && ["collecting", "voting", "planning", "executing"].includes(cur.phase)) {
      throw new EngineError("wrong_phase", `Cannot open a new round while the current one is ${cur.phase}`);
    }
    if (cur) this.archive(cur);
    const p = streamSafeLine(prompt, 200);
    const round: Round = {
      id: this.deps.id(),
      index: this.s.stats.rounds + 1,
      phase: "collecting",
      openedAt: this.deps.now(),
      prompt: p,
      ideas: [],
      candidates: [],
      tallies: [],
      voters: 0,
      votingEndsAt: null,
      ineligible: 0,
      winnerId: null,
      task: null,
      execution: null,
      markers: [],
    };
    this.s.round = round;
    this.s.stats.rounds++;
    this.votes.clear();
    this.seconders.clear();
    this.lastIdeaAt.clear();
    this.ineligibleNotified.clear();
    this.activity("round", `Round ${round.index} opened${byMod(by)}${p ? `: ${p}` : ""}`, by);
    this.changed();
    this.milestone({ kind: "round_opened", round });
    return round;
  }

  resetRound(): RoundSummary | null {
    const r = this.s.round;
    if (!r) return null;
    if (r.phase === "executing" || r.phase === "planning") {
      throw new EngineError("wrong_phase", `Cannot reset while ${r.phase}; cancel it first`);
    }
    const summary = this.archive(r);
    this.s.round = null;
    this.votes.clear();
    this.seconders.clear();
    this.lastIdeaAt.clear();
    this.ineligibleNotified.clear();
    this.activity("round", `Round ${r.index} closed`);
    this.changed();
    return summary;
  }

  summarize(r: Round): RoundSummary {
    const w = r.winnerId ? this.ideaById(r, r.winnerId) : undefined;
    const wt = w ? r.tallies.find((t) => t.ideaId === w.id) : undefined;
    return {
      id: r.id,
      index: r.index,
      openedAt: r.openedAt,
      closedAt: this.deps.now(),
      prompt: r.prompt,
      ideaCount: r.ideas.length,
      voters: r.voters,
      winner: w ? { number: wt?.number ?? w.number, text: w.text, author: w.author, votes: wt?.votes ?? 0 } : null,
      task: r.task ? { title: r.task.title, status: r.task.status, size: r.task.size, source: r.task.source } : null,
      execution: r.execution
        ? {
            status: r.execution.status,
            branch: r.execution.branch,
            changedFiles: r.execution.changedFiles,
            summary: r.execution.summary,
            clipUrl: r.execution.clipUrl ?? null,
          }
        : null,
      markers: (r.markers ?? []).map((m) => ({ ...m })),
    };
  }

  private archive(r: Round): RoundSummary {
    const summary = this.summarize(r);
    this.emit({ type: "archive", summary });
    return summary;
  }

  // ── ideas ──────────────────────────────────────────────────────────────

  /**
   * Count an attempt blocked by the eligibility settings. Returns the
   * rejection, with `notify` true only the first time for this user this round.
   */
  private ineligible(r: Round, user: TwitchUser, rule: Eligibility, what: "vote" | "submit ideas"): Rejection {
    r.ineligible++;
    const notify = !this.ineligibleNotified.has(user.id);
    this.ineligibleNotified.add(user.id);
    this.changed();
    const who = rule === "subscribers" ? "subscribers" : "VIPs and moderators";
    return { ok: false, code: "ineligible", reason: `only ${who} can ${what} this round`, notify };
  }

  /** `role` comes from chat badges; omitted = a plain viewer. */
  submitIdea(user: TwitchUser, rawText: string, role: ChatRole = "viewer"): IdeaResult {
    const r = this.requirePhase("collecting");
    const now = this.deps.now();
    const st = this.s.settings;
    const text = cleanText(rawText);
    if (!isEligible(role, st.ideaEligibility)) return this.ineligible(r, user, st.ideaEligibility, "submit ideas");

    const reject = (code: ViewerRejection, reason: string, retryInSec?: number): IdeaResult => {
      this.activity("rejected", `Idea from @${user.login} rejected: ${reason}`, user);
      this.changed();
      return retryInSec === undefined ? { ok: false, code, reason } : { ok: false, code, reason, retryInSec };
    };

    if (!text) return reject("empty", "empty idea");
    if (text.length > st.maxIdeaLength) return reject("too_long", `longer than ${st.maxIdeaLength} characters`);
    if (containsLink(text)) return reject("link", "links are not allowed");

    const last = this.lastIdeaAt.get(user.id);
    if (last !== undefined && st.ideaCooldownSec > 0 && now - last < st.ideaCooldownSec * 1000) {
      const retry = Math.ceil((st.ideaCooldownSec * 1000 - (now - last)) / 1000);
      return reject("cooldown", `cooldown, try again in ${retry}s`, retry);
    }

    const norm = normalizeIdea(text);
    const tokens = tokenSet(norm);
    const dup = r.ideas.find((i) => {
      const n = normalizeIdea(i.text);
      return n === norm || jaccard(tokenSet(n), tokens) >= NEAR_DUP;
    });

    if (dup) {
      if (dup.hidden) return reject("hidden_duplicate", "that idea was removed by the streamer");
      this.lastIdeaAt.set(user.id, now);
      return this.second(dup, user, "re-sent");
    }

    if (r.ideas.length >= st.maxIdeasPerRound) return reject("round_full", "this round is full");

    const idea: Idea = {
      id: this.deps.id(),
      number: r.ideas.length + 1,
      text,
      author: { ...user },
      createdAt: now,
      hidden: false,
      seconds: 0,
    };
    r.ideas.push(idea);
    this.lastIdeaAt.set(user.id, now);
    this.participate(user);
    this.s.stats.ideas++;
    this.activity("idea", `Idea #${idea.number}: ${text}`, user);
    this.changed();
    return { ok: true, kind: "added", idea };
  }

  /** One +1 per user per idea; never on your own idea. */
  private second(idea: Idea, user: TwitchUser, verb: string): IdeaResult {
    this.participate(user);
    let set = this.seconders.get(idea.id);
    if (!set) this.seconders.set(idea.id, (set = new Set()));
    const counted = idea.author.id !== user.id && !set.has(user.id);
    if (counted) {
      set.add(user.id);
      idea.seconds++;
      this.activity("idea_duplicate", `@${user.login} +1'd idea #${idea.number} (${idea.seconds})`, user);
    } else {
      this.activity("idea_duplicate", `@${user.login} ${verb} idea #${idea.number} (not counted)`, user);
    }
    this.changed();
    return { ok: true, kind: "duplicate", idea, counted };
  }

  /**
   * `!idea +3` / `!+1 3`: +1 idea #3 (submission number) while collecting.
   * Same rules as a typed duplicate: one per user per idea, not your own.
   */
  plusOneIdea(user: TwitchUser, ideaNumber: number, role: ChatRole = "viewer"): IdeaResult {
    const r = this.requirePhase("collecting");
    const st = this.s.settings;
    if (!isEligible(role, st.ideaEligibility)) return this.ineligible(r, user, st.ideaEligibility, "submit ideas");
    const idea = r.ideas.find((i) => i.number === ideaNumber && !i.hidden);
    if (!idea) return { ok: false, code: "no_such_idea", reason: `there is no idea #${ideaNumber}` };
    return this.second(idea, user, "+1'd");
  }

  /**
   * Hide by the number chat sees: the submission number while collecting,
   * the ballot number while voting.
   */
  hideIdeaByNumber(n: number, by?: Actor): Idea {
    const r = this.requirePhase("collecting", "voting");
    const id =
      r.phase === "voting"
        ? r.tallies.find((t) => t.number === n)?.ideaId
        : r.ideas.find((i) => i.number === n)?.id;
    const idea = id ? this.ideaById(r, id) : undefined;
    if (!idea || idea.hidden) {
      throw new EngineError("not_found", `No ${r.phase === "voting" ? "ballot entry" : "idea"} #${n}`);
    }
    return this.hideIdea(idea.id, true, by);
  }

  hideIdea(id: string, hidden: boolean, by?: Actor): Idea {
    const r = this.requireRound();
    const idea = this.ideaById(r, id);
    if (!idea) throw new EngineError("not_found", "No such idea in this round");
    if (idea.hidden === hidden) return idea;
    if (hidden && r.winnerId === id) {
      throw new EngineError("wrong_phase", "Cannot hide the winning idea");
    }
    idea.hidden = hidden;
    if (hidden && r.phase === "voting" && r.candidates.includes(id)) {
      // Pull it off the ballot; other ballot numbers stay stable.
      r.candidates = r.candidates.filter((c) => c !== id);
      r.tallies = r.tallies.filter((t) => t.ideaId !== id);
      for (const [u, v] of this.votes) if (v === id) this.votes.delete(u);
      this.recount(r);
    }
    this.activity("system", `Idea #${idea.number} ${hidden ? "hidden" : "unhidden"}${byMod(by)}`, by);
    this.changed();
    return idea;
  }

  // ── voting ─────────────────────────────────────────────────────────────

  /** Freeze the ballot. Also re-opens a vote that ended with no votes. */
  startVote(by?: Actor): Round {
    const r = this.requireRound();
    const reopen = r.phase === "decided" && r.winnerId === null;
    if (r.phase !== "collecting" && !reopen) {
      throw new EngineError("wrong_phase", `Not allowed while the round is ${r.phase} (needs collecting)`);
    }
    const ballot = r.ideas
      .filter((i) => !i.hidden)
      .sort((a, b) => b.seconds - a.seconds || a.createdAt - b.createdAt || a.number - b.number)
      .slice(0, this.s.settings.maxCandidates);
    if (ballot.length === 0) throw new EngineError("no_ideas", "No ideas to vote on yet");
    r.candidates = ballot.map((i) => i.id);
    r.tallies = ballot.map((i, n) => ({ ideaId: i.id, number: n + 1, votes: 0 }));
    r.voters = 0;
    this.votes.clear();
    r.phase = "voting";
    const dur = this.s.settings.voteDurationSec;
    r.votingEndsAt = dur > 0 ? this.deps.now() + dur * 1000 : null;
    this.activity(
      "round",
      `Voting ${reopen ? "re-opened" : "open"}${byMod(by)}: ${ballot.map((i, n) => `${n + 1}) ${i.text}`).join(" · ")}`,
      by,
    );
    this.changed();
    this.milestone({ kind: "vote_started", round: r });
    return r;
  }

  private recount(r: Round): void {
    const counts = new Map<string, number>();
    for (const v of this.votes.values()) counts.set(v, (counts.get(v) ?? 0) + 1);
    for (const t of r.tallies) t.votes = counts.get(t.ideaId) ?? 0;
    r.voters = this.votes.size;
  }

  castVote(user: TwitchUser, ballotNumber: number, role: ChatRole = "viewer"): VoteResult {
    this.tick();
    const r = this.requirePhase("voting");
    const rule = this.s.settings.voteEligibility;
    if (!isEligible(role, rule)) return this.ineligible(r, user, rule, "vote");
    const tally = Number.isInteger(ballotNumber) ? r.tallies.find((t) => t.number === ballotNumber) : undefined;
    if (!tally) {
      const nums = r.tallies.map((t) => t.number).join(", ");
      return { ok: false, code: "invalid_vote", reason: `pick one of: ${nums}` };
    }
    const prev = this.votes.get(user.id);
    if (prev === tally.ideaId) return { ok: true, ballotNumber, ideaId: tally.ideaId, changed: false, unchanged: true };
    this.votes.set(user.id, tally.ideaId);
    if (prev === undefined) this.s.stats.votes++;
    this.participate(user);
    this.recount(r);
    this.activity("vote", `${prev ? "changed vote to" : "voted"} #${ballotNumber}`, user);
    this.changed();
    return { ok: true, ballotNumber, ideaId: tally.ideaId, changed: prev !== undefined, unchanged: false };
  }

  /** Auto-close a timed vote whose time is up. Returns true if it closed. */
  tick(): boolean {
    const r = this.s.round;
    if (r?.phase === "voting" && r.votingEndsAt !== null && this.deps.now() >= r.votingEndsAt) {
      this.closeVote();
      return true;
    }
    return false;
  }

  /** Add time to a timed vote (a moderator's `!aria extend 30`). */
  extendVote(seconds: number, by?: Actor): Round {
    if (!Number.isInteger(seconds) || seconds < EXTEND_MIN_SEC || seconds > EXTEND_MAX_SEC) {
      throw new EngineError("bad_input", `seconds must be an integer between ${EXTEND_MIN_SEC} and ${EXTEND_MAX_SEC}`);
    }
    this.tick();
    const r = this.requirePhase("voting");
    if (r.votingEndsAt === null) throw new EngineError("wrong_phase", "This vote has no timer");
    r.votingEndsAt += seconds * 1000;
    this.activity("round", `Voting extended by ${seconds}s${byMod(by)}`, by);
    this.changed();
    return r;
  }

  closeVote(by?: Actor): Round {
    const r = this.requirePhase("voting");
    this.recount(r);
    const ideas = new Map(r.ideas.map((i) => [i.id, i]));
    const ranked = r.tallies
      .filter((t) => t.votes > 0 && ideas.has(t.ideaId))
      .sort((a, b) => {
        const ia = ideas.get(a.ideaId)!;
        const ib = ideas.get(b.ideaId)!;
        return b.votes - a.votes || ib.seconds - ia.seconds || ia.createdAt - ib.createdAt || ia.number - ib.number;
      });
    r.phase = "decided";
    r.votingEndsAt = null;
    const top = ranked[0];
    if (!top) {
      r.winnerId = null;
      this.activity("round", `Voting closed${byMod(by)} with no votes — re-open the vote or reset the round`, by);
    } else {
      r.winnerId = top.ideaId;
      const w = ideas.get(top.ideaId)!;
      if (by) this.activity("round", `Voting closed${byMod(by)}`, by);
      this.activity("round", `Winner: #${top.number} "${w.text}" by @${w.author.login} (${top.votes} votes)`, w.author);
    }
    this.changed();
    if (r.winnerId) this.milestone({ kind: "winner", round: r, idea: ideas.get(r.winnerId)! });
    return r;
  }

  // ── task ───────────────────────────────────────────────────────────────

  beginPlanning(by?: Actor): { idea: Idea; round: Round } {
    const r = this.requirePhase("decided", "awaiting_approval", "rejected");
    const idea = r.winnerId ? this.ideaById(r, r.winnerId) : undefined;
    if (!idea) throw new EngineError("no_winner", "There is no winning idea to plan");
    r.phase = "planning";
    this.activity("task", `Aria is planning idea #${idea.number}${byMod(by)}`, by);
    this.changed();
    return { idea, round: r };
  }

  planningFailed(message: string): void {
    const r = this.requirePhase("planning");
    r.phase = "decided";
    this.activity("task", `Planning failed: ${message}`);
    this.changed();
  }

  setTask(draft: PlannedTask): Task {
    const r = this.requirePhase("planning");
    const task: Task = {
      id: this.deps.id(),
      ideaId: r.winnerId!,
      title: streamSafeLine(draft.title, 120) || "Untitled task",
      summary: cleanMulti(draft.summary, 2000),
      userStory: cleanMulti(draft.userStory, 1000),
      acceptanceCriteria: cleanList(draft.acceptanceCriteria),
      steps: cleanList(draft.steps),
      risks: cleanList(draft.risks),
      size: draft.size === "S" || draft.size === "M" || draft.size === "L" ? draft.size : "M",
      source: draft.source === "model" ? "model" : "template",
      model: draft.model ?? null,
      status: "draft",
      createdAt: this.deps.now(),
      decidedAt: null,
      decidedBy: null,
      note: null,
    };
    r.task = task;
    r.execution = null;
    r.phase = "awaiting_approval";
    this.activity("task", `Task drafted: ${task.title}`);
    this.changed();
    return task;
  }

  editTask(patch: Record<string, unknown>): Task {
    const r = this.requirePhase("awaiting_approval");
    const t = r.task;
    if (!t || t.status !== "draft") throw new EngineError("wrong_phase", "Only a draft task can be edited");
    const next = { ...t };
    for (const [k, v] of Object.entries(patch)) {
      switch (k) {
        case "title":
        case "summary":
        case "userStory": {
          if (typeof v !== "string") throw new EngineError("bad_input", `${k} must be a string`);
          if (k === "title") {
            next.title = streamSafeLine(v, 120);
            if (!next.title) throw new EngineError("bad_input", "title cannot be empty");
          } else next[k] = cleanMulti(v, k === "summary" ? 2000 : 1000);
          break;
        }
        case "acceptanceCriteria":
        case "steps":
        case "risks":
          if (!Array.isArray(v) || !v.every((x) => typeof x === "string")) {
            throw new EngineError("bad_input", `${k} must be an array of strings`);
          }
          next[k] = cleanList(v);
          break;
        case "size":
          if (v !== "S" && v !== "M" && v !== "L") throw new EngineError("bad_input", "size must be S, M or L");
          next.size = v;
          break;
        default:
          throw new EngineError("bad_input", `Field not editable: ${k}`);
      }
    }
    r.task = next;
    this.activity("task", "Task edited");
    this.changed();
    return next;
  }

  approveTask(by: string): Task {
    const r = this.requirePhase("awaiting_approval");
    const t = r.task;
    if (!t || t.status !== "draft") throw new EngineError("wrong_phase", "No draft task to approve");
    t.status = "approved";
    t.decidedAt = this.deps.now();
    t.decidedBy = by;
    this.activity("task", `Task approved by ${by}`);
    this.changed();
    this.milestone({ kind: "task_approved", round: r, task: t });
    return t;
  }

  rejectTask(by: string, note?: string | null): Task {
    const r = this.requirePhase("awaiting_approval");
    const t = r.task;
    if (!t || t.status !== "draft") throw new EngineError("wrong_phase", "No draft task to reject");
    t.status = "rejected";
    t.decidedAt = this.deps.now();
    t.decidedBy = by;
    t.note = note ? streamSafeLine(note, 500) : null;
    r.phase = "rejected";
    this.activity("task", `Task rejected by ${by}${t.note ? `: ${t.note}` : ""}`);
    this.changed();
    return t;
  }

  // ── execution ──────────────────────────────────────────────────────────

  beginExecution(executor: string): Execution {
    const r = this.requirePhase("awaiting_approval");
    const t = r.task;
    if (!t || t.status !== "approved") throw new EngineError("not_approved", "The task must be approved first");
    const ex: Execution = {
      id: this.deps.id(),
      taskId: t.id,
      status: "running",
      executor,
      startedAt: this.deps.now(),
      endedAt: null,
      branch: null,
      workdir: null,
      steps: [],
      changedFiles: [],
      summary: null,
      error: null,
      clipUrl: null,
    };
    r.execution = ex;
    r.phase = "executing";
    this.activity("execution", `Build started: ${executorLabel(executor)}`);
    this.changed();
    this.milestone({ kind: "build_started", round: r, execution: ex });
    return ex;
  }

  appendExecutionStep(step: ExecutionStep): void {
    const r = this.requirePhase("executing");
    const ex = r.execution!;
    const s: ExecutionStep = { at: step.at || this.deps.now(), kind: step.kind, text: streamSafeLine(step.text, 500) };
    if (step.ok !== undefined) s.ok = step.ok;
    ex.steps.push(s);
    if (ex.steps.length > STEP_LIMIT) ex.steps.splice(0, ex.steps.length - STEP_LIMIT);
    this.changed();
  }

  finishExecution(result: ExecutionResult): Execution {
    const r = this.requirePhase("executing");
    const ex = r.execution!;
    ex.status = result.status;
    ex.endedAt = this.deps.now();
    ex.branch = result.branch;
    ex.workdir = result.workdir;
    ex.changedFiles = result.changedFiles.map((f) => streamSafeLine(f, 300)).slice(0, 500);
    ex.summary = result.summary ? cleanMulti(result.summary, 4000) : null;
    ex.error = result.error ? streamSafeLine(result.error, 1000) : null;
    r.phase = "done";
    this.activity("execution", `Execution ${result.status}${ex.error ? `: ${ex.error}` : ""}`);
    this.changed();
    this.milestone({ kind: "build_finished", round: r, execution: ex });
    return ex;
  }

  // ── Twitch extras (written back by the service after Helix answered) ──

  private milestone(m: Milestone): void {
    this.emit({ type: "milestone", milestone: m });
  }

  /** The remembered stream title (see StreamTitleMemo). */
  get streamTitle(): StreamTitleMemo | null {
    return this.titleMemo ? { ...this.titleMemo } : null;
  }

  setStreamTitle(memo: StreamTitleMemo | null): void {
    this.titleMemo = memo ? { ...memo } : null;
    this.changed();
  }

  /** Record a marker on the round it was made for; false if that round is gone. */
  addMarker(roundId: string, marker: StreamMarker): boolean {
    const r = this.s.round;
    if (r?.id !== roundId) return false;
    r.markers.push({
      label: streamSafeLine(marker.label, 140),
      positionSeconds: Math.max(0, Math.floor(marker.positionSeconds)),
      createdAt: marker.createdAt,
    });
    this.changed();
    return true;
  }

  /** Attach a confirmed clip URL to the execution it was made for; false if that execution is gone. */
  setClipUrl(executionId: string, url: string): boolean {
    const ex = this.s.round?.execution;
    if (ex?.id !== executionId) return false;
    ex.clipUrl = url;
    this.changed();
    return true;
  }

  /** Log a system note (e.g. "Twitch connected"). */
  note(kind: ActivityKind, text: string, user?: TwitchUser): void {
    this.activity(kind, text, user);
    this.changed();
  }
}

/**
 * Who took an action that is not the dashboard's: a moderator in Twitch chat,
 * or a chat app (ChatGPT / Claude) on the streamer MCP connection.
 */
export type Actor = TwitchUser | { app: string };

/** The streamer MCP connection (ChatGPT / Claude): " from the chat app" in activity lines. */
export const CHAT_APP: Actor = { app: "chat app" };

function isApp(a: Actor): a is { app: string } {
  return "app" in a;
}

/** " by @mod" / " from the chat app" for activity lines of actions not taken on the dashboard. */
function byMod(by?: Actor): string {
  if (!by) return "";
  return isApp(by) ? ` from the ${by.app}` : ` by @${by.login}`;
}

function cleanMulti(s: unknown, max: number): string {
  if (typeof s !== "string") return "";
  const lines = s
    .split(/\r?\n/)
    .map((l) => cleanText(l))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return lines.length > max ? lines.slice(0, max) : lines;
}

function cleanList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === "string")
    .map((x) => streamSafeLine(x, 400))
    .filter(Boolean)
    .slice(0, 20);
}

/** "mcp:codex" → "Codex via MCP", "aria-code" → "Aria Code in an isolated worktree". */
export function executorLabel(executor: string): string {
  const names: Record<string, string> = { codex: "Codex", "claude-code": "Claude Code", "aria-code": "Aria Code" };
  if (executor.startsWith("mcp:")) {
    const id = executor.slice(4);
    return `${names[id] ?? id} via MCP`;
  }
  return `${names[executor] ?? executor} in an isolated worktree`;
}
