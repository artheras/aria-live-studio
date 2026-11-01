/**
 * Wires the round engine to Twitch chat (EventSub in, chat replies out),
 * the planner, the executor and the coding-agent bridge.
 */
import { randomUUID } from "node:crypto";
import { EXTEND_MAX_SEC, EXTEND_MIN_SEC, isModRole, type RoundSummary, type Task } from "@aria-live/shared";
import type { Config } from "../config.ts";
import type { Executor, Planner } from "../contracts.ts";
import type { TwitchAuth } from "../twitch/auth.ts";
import { EventSubClient } from "../twitch/eventsub.ts";
import type { HelixClient } from "../twitch/helix.ts";
import { AgentBridge, AGENT_EXECUTOR_PREFIX } from "./agent.ts";
import { parseChatMessage, REPLY_PREFIX, type ChatMessageEvent, type ModAction, type ParsedChat } from "./commands.ts";
import { EngineError, RoundEngine, type Actor, type EngineDeps } from "./engine.ts";
import type { Store } from "./store.ts";

export const VIEWER_HELP =
  "Propose with !idea <your idea>, +1 an idea with !idea +<n> (or !+1 <n>), vote with !vote <number> once voting opens, !ideas lists them. The streamer approves what gets built.";
export const MOD_HELP = `Mods: !aria open [theme] · !aria vote · !aria close · !aria extend <${EXTEND_MIN_SEC}-${EXTEND_MAX_SEC}s> · !aria hide <n> (idea # while collecting, ballot # while voting). Planning, approvals and builds stay on the dashboard.`;
export const DASHBOARD_ONLY_REPLY = "Approvals happen on the dashboard — planning, approving and running builds are the streamer's call.";

export class ServiceError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ServiceError";
  }
}

/** At most 1 message per `minGapMs` and `max` per `windowMs`; extras are dropped. */
export class ReplyLimiter {
  private sent: number[] = [];
  constructor(
    private readonly now: () => number = Date.now,
    private readonly minGapMs = 2000,
    private readonly max = 15,
    private readonly windowMs = 30_000,
  ) {}

  tryTake(): boolean {
    const now = this.now();
    this.sent = this.sent.filter((t) => now - t < this.windowMs);
    const last = this.sent[this.sent.length - 1];
    if (last !== undefined && now - last < this.minGapMs) return false;
    if (this.sent.length >= this.max) return false;
    this.sent.push(now);
    return true;
  }
}

class BoundedSet {
  private s = new Set<string>();
  constructor(private readonly max: number) {}
  add(v: string): void {
    this.s.add(v);
    if (this.s.size > this.max) this.s.delete(this.s.values().next().value as string);
  }
  has(v: string): boolean {
    return this.s.has(v);
  }
}

export interface LiveServiceDeps {
  config: Config;
  store: Store;
  auth: TwitchAuth;
  helix: HelixClient;
  planner: Planner;
  executor: Executor;
  engineDeps?: EngineDeps;
  /** Override for tests. */
  createEventSub?: (svc: LiveService) => EventSubClient | null;
  tickMs?: number;
  voteReplyDelayMs?: number;
}

export class LiveService {
  readonly engine: RoundEngine;
  readonly agent: AgentBridge;
  private eventsub: EventSubClient | null = null;
  private planAbort: AbortController | null = null;
  private execAbort: AbortController | null = null;
  private execRun: Promise<void> | null = null;
  private tickTimer: NodeJS.Timeout | null = null;
  private voteReplyTimer: NodeJS.Timeout | null = null;
  private readonly limiter = new ReplyLimiter();
  private readonly ownMessages = new BoundedSet(500);
  private executorCheck: { ok: boolean; reason?: string; at: number } | null = null;

  constructor(private readonly deps: LiveServiceDeps) {
    const engineDeps = deps.engineDeps ?? { now: Date.now, id: randomUUID };
    this.engine = new RoundEngine(engineDeps, deps.store.loadState());
    this.agent = new AgentBridge(this.engine, deps.config.projectBrief);
    this.engine.on((e) => {
      if (e.type === "change") deps.store.scheduleSave(() => this.engine.snapshot());
      else void deps.store.appendHistory(e.summary).catch((err) => console.error(`[history] ${err.message}`));
    });
    deps.auth.onSignedOut((reason) => {
      this.stopChat();
      this.engine.setConnection({ state: "signed_out", channel: null, sessionId: null, error: reason, canReply: false });
    });
  }

  get config(): Config {
    return this.deps.config;
  }

  start(): void {
    this.tickTimer = setInterval(() => {
      try {
        this.engine.tick();
      } catch (err) {
        console.error(`[tick] ${(err as Error).message}`);
      }
    }, this.deps.tickMs ?? 250);
    this.tickTimer.unref?.();
    if (this.deps.auth.user) this.connectChat();
  }

  async stop(): Promise<void> {
    if (this.tickTimer) clearInterval(this.tickTimer);
    if (this.voteReplyTimer) clearTimeout(this.voteReplyTimer);
    this.tickTimer = null;
    this.stopChat();
    this.planAbort?.abort();
    if (this.execAbort) {
      this.execAbort.abort();
      await Promise.race([this.execRun, new Promise((r) => setTimeout(r, 3000))]);
    }
    this.deps.auth.stopValidation();
    this.deps.store.flush();
  }

  // ── Twitch chat ──────────────────────────────────────────────────────

  /** Start (or restart) EventSub for the signed-in broadcaster. */
  connectChat(): void {
    const user = this.deps.auth.user;
    if (!user) return;
    this.stopChat();
    this.engine.setConnection({
      state: "connecting",
      channel: user,
      sessionId: null,
      error: null,
      canReply: this.deps.auth.canReply,
    });
    this.eventsub = this.deps.createEventSub
      ? this.deps.createEventSub(this)
      : new EventSubClient({
          url: this.deps.config.twitch.eventsubUrl,
          api: this.deps.helix,
          broadcasterUserId: user.id,
          userId: user.id,
          handlers: {
            onChatMessage: (ev) => this.handleChat(ev),
            onState: (u) =>
              this.engine.setConnection({ ...u, channel: this.deps.auth.user, canReply: this.deps.auth.canReply }),
          },
        });
    this.deps.auth.startValidation();
    this.eventsub?.start();
  }

  stopChat(): void {
    this.eventsub?.stop();
    this.eventsub = null;
  }

  async logout(): Promise<void> {
    this.stopChat();
    await this.deps.auth.logout();
    this.engine.setConnection({ state: "signed_out", channel: null, sessionId: null, error: null, canReply: false });
  }

  /** Handle one channel.chat.message event. Exposed for tests and the mock flow. */
  handleChat(ev: ChatMessageEvent): void {
    const parsed = parseChatMessage(ev, {
      maxIdeaLength: this.engine.state.settings.maxIdeaLength,
      ownMessageIds: this.ownMessages,
    });
    if (!parsed) return;
    try {
      this.runCommand(parsed);
    } catch (err) {
      if (!(err instanceof EngineError)) console.error(`[chat] ${(err as Error).message}`);
      // wrong phase etc: viewers get no reply, the dashboard shows the phase
    }
  }

  private runCommand(p: ParsedChat): void {
    const { command: c, user } = p;
    const r = this.engine.round;
    switch (c.kind) {
      case "invalid": {
        if (c.command === "aria") {
          // Only moderators get "invalid aria" (the parser drops viewers' mod commands).
          if (isModRole(p.role)) this.reply(`@${user.login} ${c.reason}`, p.messageId);
          return;
        }
        // Only answer while the command could have counted; otherwise stay quiet like for valid commands.
        const live = c.command === "idea" ? r?.phase === "collecting" : r?.phase === "voting";
        if (!live) return;
        if (c.command === "idea") {
          // Refused before reaching the engine (link, too long): still show it to the streamer.
          this.engine.note("rejected", `Idea from @${user.login} rejected: ${c.reason}`, user);
        }
        this.reply(`@${user.login} ${c.reason}`, p.messageId);
        return;
      }
      case "help":
        this.reply(isModRole(p.role) ? `${VIEWER_HELP} ${MOD_HELP}` : VIEWER_HELP, p.messageId);
        return;
      case "mod":
        if (!isModRole(p.role)) return; // defence in depth: viewers are ignored silently
        this.runModCommand(p, c);
        return;
      case "ideas": {
        if (!r) return this.reply("No round open right now.", p.messageId);
        if (r.phase === "voting") {
          return this.reply(`Vote with !vote <n>: ${this.ballotLine()}`, p.messageId);
        }
        const latest = r.ideas.filter((i) => !i.hidden).slice(-5);
        return this.reply(
          latest.length ? `Latest ideas: ${latest.map((i) => `#${i.number} ${i.text}`).join(" · ")}` : "No ideas yet — !idea <your idea>",
          p.messageId,
        );
      }
      case "idea": {
        if (r?.phase !== "collecting") return;
        const res = this.engine.submitIdea(user, c.text, p.role);
        if (res.ok && res.kind === "added") this.reply(`Idea #${res.idea.number} from @${user.login} added`);
        else if (res.ok && res.counted) this.reply(`@${user.login} +1 on idea #${res.idea.number} (${res.idea.seconds})`);
        else if (!res.ok) this.replyRejection(p, res);
        return;
      }
      case "plus_one": {
        if (r?.phase !== "collecting") return;
        const res = this.engine.plusOneIdea(user, c.number, p.role);
        if (res.ok && res.kind === "duplicate" && res.counted) this.reply(`@${user.login} +1 on idea #${res.idea.number} (${res.idea.seconds})`);
        else if (!res.ok) this.replyRejection(p, res);
        return;
      }
      case "vote": {
        if (r?.phase !== "voting") return;
        const res = this.engine.castVote(user, c.number, p.role);
        if (!res.ok) this.replyRejection(p, res);
        else if (!res.unchanged) this.scheduleVoteReply();
        return;
      }
    }
  }

  /** Cooldowns stay quiet; ineligible users hear it once per round. */
  private replyRejection(p: ParsedChat, res: { code: string; reason: string; notify?: boolean }): void {
    if (res.code === "cooldown") return;
    if (res.code === "ineligible" && !res.notify) return;
    this.reply(`@${p.user.login} ${res.reason}`, p.messageId);
  }

  /**
   * Moderator / broadcaster commands from chat. They drive the round
   * (open, vote, close, extend, hide) but never plan, approve or run.
   */
  private runModCommand(p: ParsedChat, c: ModAction): void {
    const { user: mod } = p;
    const say = (text: string) => this.reply(`@${mod.login} ${text}`, p.messageId);
    const r = this.engine.round;
    const phase = r?.phase ?? "idle";
    try {
      switch (c.action) {
        case "dashboard_only":
          return say(DASHBOARD_ONLY_REPLY);
        case "open": {
          if (r && (phase === "collecting" || phase === "voting")) {
            return say(`round ${r.index} is already running (${phase === "voting" ? "voting" : "collecting ideas"})`);
          }
          if (!["idle", "decided", "done", "rejected"].includes(phase)) {
            return say("a task is in progress; the streamer finishes it on the dashboard first");
          }
          const nr = this.engine.openRound(c.prompt, mod);
          return this.reply(`Round ${nr.index} is open${nr.prompt ? `: ${nr.prompt}` : ""}. Propose with !idea <your idea>`);
        }
        case "vote": {
          const reopen = phase === "decided" && r?.winnerId === null;
          if (phase !== "collecting" && !reopen) return say("voting can only start while ideas are open");
          this.engine.startVote(mod);
          return this.reply(`Voting is open! !vote <n>: ${this.ballotLine()}`);
        }
        case "close": {
          if (phase !== "voting") return say("no vote is running");
          const done = this.engine.closeVote(mod);
          const w = this.engine.winner();
          const t = w ? done.tallies.find((x) => x.ideaId === w.id) : undefined;
          return this.reply(w && t ? `Vote closed. Winner: #${t.number} ${w.text} (${t.votes} votes)` : "Vote closed with no votes.");
        }
        case "extend": {
          if (phase !== "voting") return say("no vote is running");
          if (r?.votingEndsAt === null) return say("this vote has no timer; close it with !aria close");
          this.engine.extendVote(c.seconds, mod);
          return this.reply(`Voting extended by ${c.seconds}s`);
        }
        case "hide": {
          if (phase !== "collecting" && phase !== "voting") return say("ideas can only be hidden while collecting or voting");
          const idea = this.engine.hideIdeaByNumber(c.number, mod);
          return say(`${phase === "voting" ? `ballot #${c.number}` : `idea #${idea.number}`} hidden`);
        }
      }
    } catch (err) {
      if (err instanceof EngineError) return say(err.message.charAt(0).toLowerCase() + err.message.slice(1));
      throw err;
    }
  }

  private ballotLine(): string {
    const r = this.engine.round;
    if (!r) return "";
    const ideas = new Map(r.ideas.map((i) => [i.id, i]));
    return r.tallies.map((t) => `${t.number}) ${ideas.get(t.ideaId)?.text ?? "?"} [${t.votes}]`).join(" · ");
  }

  private scheduleVoteReply(): void {
    if (this.voteReplyTimer) return;
    this.voteReplyTimer = setTimeout(() => {
      this.voteReplyTimer = null;
      const r = this.engine.round;
      if (r?.phase === "voting") this.reply(`${r.voters} votes so far: ${this.ballotLine()}`);
    }, this.deps.voteReplyDelayMs ?? 5000);
    this.voteReplyTimer.unref?.();
  }

  /** Rate-limited chat reply; silently dropped when not allowed. */
  reply(text: string, replyTo?: string): void {
    const st = this.engine.state;
    const me = this.deps.auth.user;
    if (!st.settings.chatReplies || !st.connection.canReply || !me) return;
    if (!this.limiter.tryTake()) return;
    let msg = `${REPLY_PREFIX} ${text}`;
    if (msg.length > 480) msg = `${msg.slice(0, 479)}…`;
    this.deps.helix
      .sendChatMessage(me.id, me.id, msg, replyTo)
      .then((sent) => {
        if (sent.message_id) this.ownMessages.add(sent.message_id);
        if (!sent.is_sent) console.warn(`[chat] message dropped: ${sent.drop_reason?.message ?? "unknown"}`);
      })
      .catch((err) => console.warn(`[chat] reply failed: ${(err as Error).message}`));
  }

  // ── rounds (streamer actions) ────────────────────────────────────────

  openRound(prompt: string, by?: Actor): void {
    this.engine.openRound(prompt, by);
  }

  resetRound(): RoundSummary | null {
    const r = this.engine.round;
    if (r?.phase === "planning") {
      this.planAbort?.abort();
      this.planAbort = null;
      this.engine.planningFailed("cancelled because the round was reset");
    }
    return this.engine.resetRound();
  }

  // ── planning ─────────────────────────────────────────────────────────

  async planTask(by?: Actor): Promise<Task> {
    const { idea, round } = this.engine.beginPlanning(by);
    const roundId = round.id;
    const ac = new AbortController();
    this.planAbort = ac;
    const signal = AbortSignal.any([ac.signal, AbortSignal.timeout(this.deps.config.planner.timeoutMs + 5000)]);
    const otherIdeas = round.candidates
      .filter((id) => id !== idea.id)
      .map((id) => round.ideas.find((i) => i.id === id)?.text)
      .filter((t): t is string => Boolean(t));
    try {
      const draft = await this.deps.planner.plan({
        idea,
        round: { prompt: round.prompt, index: round.index },
        projectBrief: this.deps.config.projectBrief,
        otherIdeas,
        signal,
      });
      if (!this.stillPlanning(roundId, ac)) throw new ServiceError(409, "cancelled", "Planning was cancelled");
      return this.engine.setTask(draft);
    } catch (err) {
      if (err instanceof ServiceError) throw err;
      const msg = (err as Error).message || "planner failed";
      if (this.stillPlanning(roundId, ac)) this.engine.planningFailed(msg);
      throw new ServiceError(502, "planner_failed", `Planner failed: ${msg}`);
    } finally {
      if (this.planAbort === ac) this.planAbort = null;
    }
  }

  private stillPlanning(roundId: string, ac: AbortController): boolean {
    const r = this.engine.round;
    return !ac.signal.aborted && r?.id === roundId && r.phase === "planning";
  }

  // ── execution ────────────────────────────────────────────────────────

  async executorStatus(force = false): Promise<{ ok: boolean; reason?: string }> {
    if (this.deps.config.executor.kind === "disabled") return { ok: false, reason: "executor disabled (ARIA_LIVE_EXECUTOR)" };
    const now = Date.now();
    if (!force && this.executorCheck && now - this.executorCheck.at < 30_000) return this.executorCheck;
    try {
      const res = await this.deps.executor.check();
      this.executorCheck = { ...res, at: now };
    } catch (err) {
      this.executorCheck = { ok: false, reason: (err as Error).message, at: now };
    }
    const { at: _at, ...out } = this.executorCheck;
    return out;
  }

  async startExecution(): Promise<void> {
    const r = this.engine.round;
    if (!r) throw new EngineError("no_round", "No round is open");
    if (r.phase !== "awaiting_approval") throw new EngineError("wrong_phase", `Not allowed while the round is ${r.phase}`);
    if (r.task?.status !== "approved") throw new EngineError("not_approved", "The task must be approved first");
    if (!this.engine.state.settings.executorEnabled) {
      throw new ServiceError(409, "executor_disabled", "Enable the executor in settings first");
    }
    const check = await this.executorStatus(true);
    if (!check.ok) throw new ServiceError(502, "executor_unavailable", `Executor unavailable: ${check.reason ?? "unknown"}`);
    const task = r.task;
    const ex = this.engine.beginExecution(this.deps.executor.name);
    const ac = new AbortController();
    this.execAbort = ac;
    const same = () => this.engine.round?.execution?.id === ex.id && this.engine.round.phase === "executing";
    this.execRun = (async () => {
      try {
        const result = await this.deps.executor.run(task, {
          signal: ac.signal,
          onStep: (step) => {
            if (same()) this.engine.appendExecutionStep(step);
          },
        });
        if (same()) this.engine.finishExecution(result);
      } catch (err) {
        if (same()) {
          this.engine.finishExecution({
            status: ac.signal.aborted ? "cancelled" : "failed",
            branch: null,
            workdir: null,
            changedFiles: [],
            summary: null,
            error: (err as Error).message || "executor failed",
          });
        }
      } finally {
        if (this.execAbort === ac) this.execAbort = null;
      }
    })();
  }

  cancelExecution(): void {
    const r = this.engine.round;
    if (r?.phase !== "executing" || !r.execution) throw new EngineError("wrong_phase", "Nothing is executing");
    if (r.execution.executor.startsWith(AGENT_EXECUTOR_PREFIX)) {
      this.agent.cancelHeld();
      return;
    }
    const ac = this.execAbort;
    if (!ac) {
      this.engine.finishExecution({
        status: "cancelled",
        branch: null,
        workdir: null,
        changedFiles: [],
        summary: null,
        error: "Cancelled by the streamer",
      });
      return;
    }
    ac.abort();
    const exId = r.execution.id;
    // If the executor does not stop on its own, close the execution anyway.
    setTimeout(() => {
      const cur = this.engine.round;
      if (cur?.phase === "executing" && cur.execution?.id === exId) {
        this.engine.finishExecution({
          status: "cancelled",
          branch: null,
          workdir: null,
          changedFiles: [],
          summary: null,
          error: "Cancelled by the streamer",
        });
      }
    }, 10_000).unref?.();
  }
}
