/**
 * In-process implementations of the MCP tool back ends for the remote MCP
 * endpoint: the agent tools call the AgentBridge directly (no loopback
 * HTTP) with the same rules and errors as /api/agent/*; the co-host tools
 * read the engine state and the history file; the streamer tools call the
 * same LiveService / engine operations as the dashboard's REST routes, with
 * activity attributed to the chat app.
 */
import type { AgentTask } from "@aria-live/shared";
import {
  LiveError,
  type AgentApi,
  type CohostApi,
  type CohostIdea,
  type CohostStatus,
  type StreamerApi,
} from "@aria-live/mcp/server";
import { AgentError } from "../live/agent.ts";
import { CHAT_APP, EngineError } from "../live/engine.ts";
import { ServiceError, type LiveService } from "../live/service.ts";
import type { Store } from "../live/store.ts";

function asLive(err: unknown): unknown {
  if (err instanceof AgentError || err instanceof EngineError || err instanceof ServiceError) {
    return new LiveError(err.message, err.status, err.code);
  }
  return err;
}

async function wrap<T>(fn: () => T | Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    throw asLive(err);
  }
}

/** Resolves with the approved, unclaimed task as soon as there is one, or null after `seconds`. */
export function waitForAgentTask(service: LiveService, seconds: number, signal?: AbortSignal): Promise<AgentTask | null> {
  const now = service.agent.available();
  if (now || seconds <= 0) return Promise.resolve(now);
  if (signal?.aborted) return Promise.reject(new LiveError("Request cancelled", 0, "aborted"));
  return new Promise((resolve, reject) => {
    const finish = (fn: () => void) => {
      off();
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      fn();
    };
    const off = service.engine.on((e) => {
      if (e.type !== "change") return;
      const t = service.agent.available();
      if (t) finish(() => resolve(t));
    });
    const timer = setTimeout(() => finish(() => resolve(null)), seconds * 1000);
    const onAbort = () => finish(() => reject(new LiveError("Request cancelled", 0, "aborted")));
    signal?.addEventListener("abort", onAbort);
  });
}

export function agentApi(service: LiveService, takeProgress: () => boolean): AgentApi {
  const agent = service.agent;
  return {
    status: () => wrap(() => agent.status()),
    waitForTask: (seconds, signal) => waitForAgentTask(service, seconds, signal),
    claim: (taskId, client) => wrap(() => agent.claim(taskId, client)),
    progress: (taskId, kind, text) =>
      wrap(() => {
        if (!takeProgress()) throw new LiveError("Too many progress reports; max 5 per second", 429, "rate_limited");
        agent.progress(taskId, kind, text);
      }),
    complete: (input) => wrap(() => agent.complete({ ...input })),
  };
}

export function cohostApi(service: LiveService, store: Store): CohostApi {
  const engine = service.engine;
  const visibleIdeas = (): CohostIdea[] => {
    const r = engine.round;
    if (!r) return [];
    const tally = new Map(r.tallies.map((t) => [t.ideaId, t]));
    return r.ideas
      .filter((i) => !i.hidden)
      .map((i) => {
        const t = tally.get(i.id);
        return {
          number: i.number,
          ballotNumber: t?.number ?? null,
          text: i.text,
          author: i.author.displayName || i.author.login,
          plusOnes: i.seconds,
          votes: t ? t.votes : null,
        };
      });
  };
  return {
    status: () => wrap(() => roundStatus(service)),
    ideas: () =>
      wrap(() => {
        const r = engine.round;
        return { roundIndex: r?.index ?? null, phase: r?.phase ?? "none", prompt: r?.prompt || null, ideas: visibleIdeas() };
      }),
    history: async (limit) => {
      const rounds = await store.readHistory(Math.max(1, Math.min(20, limit)));
      return rounds.map((r) => ({
        index: r.index,
        openedAt: r.openedAt,
        closedAt: r.closedAt,
        prompt: r.prompt,
        ideaCount: r.ideaCount,
        voters: r.voters,
        winner: r.winner
          ? { number: r.winner.number, text: r.winner.text, author: r.winner.author.displayName || r.winner.author.login, votes: r.winner.votes }
          : null,
        task: r.task ? { title: r.task.title, status: r.task.status } : null,
        execution: r.execution ? { status: r.execution.status, summary: r.execution.summary } : null,
      }));
    },
    digest: () =>
      wrap(() => {
        const st = engine.state;
        const r = st.round;
        const ideas = visibleIdeas();
        const top = [...ideas].sort((a, b) => b.plusOnes - a.plusOnes || (b.votes ?? 0) - (a.votes ?? 0) || a.number - b.number).slice(0, 5);
        return {
          roundIndex: r?.index ?? null,
          phase: r?.phase ?? "none",
          ideas: ideas.length,
          hiddenIdeas: (r?.ideas.length ?? 0) - ideas.length,
          plusOnes: ideas.reduce((n, i) => n + i.plusOnes, 0),
          ideaAuthors: new Set((r?.ideas ?? []).filter((i) => !i.hidden).map((i) => i.author.id)).size,
          voters: r?.voters ?? 0,
          topIdeas: top.map(({ number, text, plusOnes, votes }) => ({ number, text, plusOnes, votes })),
          totals: { ...st.stats },
        };
      }),
  };
}

/** Agent status plus what the round card needs (voters, vote timer, idea count). */
export function roundStatus(service: LiveService): CohostStatus {
  const r = service.engine.round;
  return {
    ...service.agent.status(),
    voters: r?.voters ?? 0,
    votingEndsAt: r?.phase === "voting" ? r.votingEndsAt : null,
    ideaCount: r ? r.ideas.filter((i) => !i.hidden).length : 0,
  };
}

/**
 * Round control for the streamer MCP role. Each call is the dashboard's REST
 * action (same engine / service method, same validation and errors); there is
 * no approve, reject, run or cancel.
 */
export function streamerApi(service: LiveService, store: Store): StreamerApi {
  const engine = service.engine;
  return {
    ...cohostApi(service, store),
    openRound: (prompt) => wrap(() => service.openRound(prompt, CHAT_APP)),
    startVote: () => wrap(() => void engine.startVote(CHAT_APP)),
    closeVote: () => wrap(() => void engine.closeVote(CHAT_APP)),
    extendVote: (seconds) => wrap(() => void engine.extendVote(seconds, CHAT_APP)),
    hideIdea: (number, hidden) =>
      wrap(() => {
        const r = engine.round;
        if (!r) throw new EngineError("no_round", "No round is open");
        const idea = r.ideas.find((i) => i.number === number);
        if (!idea) throw new EngineError("not_found", `No idea #${number} in this round (use the idea number from live_ideas)`);
        engine.hideIdea(idea.id, hidden, CHAT_APP);
      }),
    planTask: () =>
      wrap(async () => {
        const t = await service.planTask(CHAT_APP);
        return {
          title: t.title,
          summary: t.summary,
          userStory: t.userStory,
          acceptanceCriteria: t.acceptanceCriteria,
          steps: t.steps,
          risks: t.risks,
          size: t.size,
          source: t.source,
          model: t.model,
          status: t.status,
        };
      }),
  };
}
