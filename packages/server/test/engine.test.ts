import { describe, expect, it } from "vitest";
import { ACTIVITY_LIMIT, EngineError, STEP_LIMIT, type EngineEvent } from "../src/live/engine.ts";
import { makeEngine, plan, user } from "./helpers.ts";

const A = user("alice");
const B = user("bob");
const C = user("carol");
const D = user("dave");

function collecting(settings: Record<string, unknown> = {}) {
  const ctx = makeEngine();
  ctx.engine.updateSettings({ ideaCooldownSec: 0, voteDurationSec: 0, ...settings });
  ctx.engine.openRound("theme");
  return ctx;
}

function expectCode(fn: () => unknown, code: string) {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(EngineError);
    expect((e as EngineError).code).toBe(code);
    return;
  }
  throw new Error(`expected ${code}`);
}

describe("round engine: ideas", () => {
  it("adds ideas with stable submission numbers and bumps version/stats", () => {
    const { engine } = collecting();
    const v0 = engine.state.version;
    const r1 = engine.submitIdea(A, "Add dark mode");
    const r2 = engine.submitIdea(B, "Add a leaderboard");
    expect(r1.ok && r1.kind).toBe("added");
    expect(engine.round!.ideas.map((i) => i.number)).toEqual([1, 2]);
    expect(engine.state.version).toBeGreaterThan(v0);
    expect(engine.state.stats.ideas).toBe(2);
    expect(engine.state.stats.participants).toBe(2);
    expect(r2.ok).toBe(true);
  });

  it("rejects ideas outside collecting with wrong_phase", () => {
    const { engine } = makeEngine();
    expectCode(() => engine.submitIdea(A, "x"), "no_round");
    engine.openRound();
    engine.submitIdea(A, "something");
    engine.startVote();
    expectCode(() => engine.submitIdea(B, "late idea"), "wrong_phase");
  });

  it("enforces per-user cooldown", () => {
    const { engine, clock } = collecting({ ideaCooldownSec: 30 });
    expect(engine.submitIdea(A, "first idea").ok).toBe(true);
    clock.advance(10_000);
    const r = engine.submitIdea(A, "second idea");
    expect(r).toMatchObject({ ok: false, code: "cooldown", retryInSec: 20 });
    expect(engine.submitIdea(B, "other user is fine").ok).toBe(true);
    clock.advance(20_000);
    expect(engine.submitIdea(A, "second idea").ok).toBe(true);
  });

  it("enforces maxIdeasPerRound, max length and links", () => {
    const { engine } = collecting({ maxIdeasPerRound: 1, maxIdeaLength: 20 });
    expect(engine.submitIdea(A, "one idea").ok).toBe(true);
    expect(engine.submitIdea(B, "another idea")).toMatchObject({ ok: false, code: "round_full" });
    expect(engine.submitIdea(C, "x".repeat(21))).toMatchObject({ ok: false, code: "too_long" });
    expect(engine.submitIdea(C, "see www.spam.com")).toMatchObject({ ok: false, code: "link" });
    expect(engine.state.activity.some((a) => a.kind === "rejected")).toBe(true);
  });

  it("dedupes exact (normalized) duplicates into +1 seconds", () => {
    const { engine } = collecting();
    engine.submitIdea(A, "Add Dark Mode!");
    const r = engine.submitIdea(B, "add   dark mode");
    expect(r).toMatchObject({ ok: true, kind: "duplicate", counted: true });
    expect(engine.round!.ideas).toHaveLength(1);
    expect(engine.round!.ideas[0]!.seconds).toBe(1);
    // same user again: not counted twice
    expect(engine.submitIdea(B, "ADD DARK MODE")).toMatchObject({ ok: true, counted: false });
    // author cannot +1 own
    expect(engine.submitIdea(A, "add dark mode.")).toMatchObject({ ok: true, counted: false });
    expect(engine.round!.ideas[0]!.seconds).toBe(1);
  });

  it("dedupes near duplicates by token Jaccard >= 0.8", () => {
    const { engine } = collecting();
    engine.submitIdea(A, "add a boss fight with lasers and music");
    // same tokens reordered + one extra of 9 → 8/9 ≈ 0.89
    const r = engine.submitIdea(B, "add a boss fight with music and lasers please");
    expect(r).toMatchObject({ ok: true, kind: "duplicate", counted: true });
    // clearly different
    expect(engine.submitIdea(C, "add a chat leaderboard")).toMatchObject({ ok: true, kind: "added" });
  });

  it("hidden duplicates are rejected", () => {
    const { engine } = collecting();
    const r = engine.submitIdea(A, "bad idea");
    engine.hideIdea(r.ok ? r.idea.id : "", true);
    expect(engine.submitIdea(B, "bad idea")).toMatchObject({ ok: false, code: "hidden_duplicate" });
  });
});

describe("round engine: voting", () => {
  function withIdeas() {
    const ctx = collecting({ maxCandidates: 3 });
    const { engine, clock } = ctx;
    engine.submitIdea(A, "idea one"); // #1
    clock.advance(1);
    engine.submitIdea(B, "idea two"); // #2
    clock.advance(1);
    engine.submitIdea(C, "idea three"); // #3
    clock.advance(1);
    engine.submitIdea(D, "idea four"); // #4
    engine.submitIdea(A, "idea four"); // +1 for #4
    engine.submitIdea(B, "idea three"); // +1 for #3
    engine.submitIdea(C, "idea four"); // +1 for #4 → 2
    return ctx;
  }

  it("freezes the ballot by seconds desc then age, renumbers 1..N, skips hidden", () => {
    const { engine } = withIdeas();
    const one = engine.round!.ideas[0]!;
    engine.hideIdea(one.id, true);
    engine.startVote();
    const r = engine.round!;
    const texts = r.candidates.map((id) => r.ideas.find((i) => i.id === id)!.text);
    expect(texts).toEqual(["idea four", "idea three", "idea two"]);
    expect(r.tallies.map((t) => t.number)).toEqual([1, 2, 3]);
    expect(r.phase).toBe("voting");
  });

  it("one vote per user, changing moves it, invalid numbers rejected", () => {
    const { engine } = withIdeas();
    engine.startVote();
    expect(engine.castVote(A, 1)).toMatchObject({ ok: true, changed: false });
    expect(engine.castVote(B, 1).ok).toBe(true);
    expect(engine.castVote(A, 2)).toMatchObject({ ok: true, changed: true });
    expect(engine.castVote(A, 2)).toMatchObject({ ok: true, unchanged: true });
    expect(engine.castVote(C, 9)).toMatchObject({ ok: false, code: "invalid_vote" });
    expect(engine.castVote(C, 0)).toMatchObject({ ok: false, code: "invalid_vote" });
    const r = engine.round!;
    expect(r.tallies.map((t) => t.votes)).toEqual([1, 1, 0]);
    expect(r.voters).toBe(2);
    expect(engine.state.stats.votes).toBe(2);
  });

  it("winner = most votes; tie → most seconds; then earliest", () => {
    const { engine } = withIdeas();
    engine.startVote(); // ballot: four(2 sec), three(1 sec), one(0)
    engine.castVote(A, 2);
    engine.castVote(B, 3);
    engine.closeVote();
    let r = engine.round!;
    // tie 1-1 between "idea three" (1 second) and "idea one" (0) → three
    expect(r.ideas.find((i) => i.id === r.winnerId)!.text).toBe("idea three");
    expect(r.phase).toBe("decided");

    const ctx = collecting();
    ctx.engine.submitIdea(A, "early");
    ctx.clock.advance(5);
    ctx.engine.submitIdea(B, "late");
    ctx.engine.startVote();
    ctx.engine.castVote(C, 1);
    ctx.engine.castVote(D, 2);
    ctx.engine.closeVote();
    r = ctx.engine.round!;
    expect(r.ideas.find((i) => i.id === r.winnerId)!.text).toBe("early");
  });

  it("zero votes → decided with no winner; vote can be re-opened", () => {
    const { engine } = withIdeas();
    engine.startVote();
    engine.closeVote();
    expect(engine.round!.phase).toBe("decided");
    expect(engine.round!.winnerId).toBeNull();
    expect(engine.state.activity.at(-1)!.text).toMatch(/no votes/);
    expectCode(() => engine.beginPlanning(), "no_winner");
    engine.startVote();
    expect(engine.round!.phase).toBe("voting");
  });

  it("cannot re-open a vote that has a winner", () => {
    const { engine } = withIdeas();
    engine.startVote();
    engine.castVote(A, 1);
    engine.closeVote();
    expectCode(() => engine.startVote(), "wrong_phase");
  });

  it("startVote with no ideas → no_ideas", () => {
    const { engine } = collecting();
    expectCode(() => engine.startVote(), "no_ideas");
  });

  it("auto-closes at votingEndsAt with the fake clock", () => {
    const { engine, clock } = collecting({ voteDurationSec: 30 });
    engine.submitIdea(A, "x idea");
    engine.startVote();
    expect(engine.round!.votingEndsAt).toBe(clock.t + 30_000);
    engine.castVote(B, 1);
    clock.advance(29_999);
    expect(engine.tick()).toBe(false);
    clock.advance(1);
    expect(engine.tick()).toBe(true);
    expect(engine.round!.phase).toBe("decided");
    expect(engine.round!.votingEndsAt).toBeNull();
  });

  it("a vote arriving after the deadline closes the vote and is wrong_phase", () => {
    const { engine, clock } = collecting({ voteDurationSec: 10 });
    engine.submitIdea(A, "x idea");
    engine.startVote();
    clock.advance(10_000);
    expectCode(() => engine.castVote(B, 1), "wrong_phase");
    expect(engine.round!.phase).toBe("decided");
  });

  it("hiding a candidate during voting removes it and its votes", () => {
    const { engine } = withIdeas();
    engine.startVote();
    engine.castVote(A, 1);
    engine.castVote(B, 2);
    const first = engine.round!.candidates[0]!;
    engine.hideIdea(first, true);
    const r = engine.round!;
    expect(r.tallies.map((t) => t.number)).toEqual([2, 3]);
    expect(r.voters).toBe(1);
    expect(engine.castVote(C, 1)).toMatchObject({ ok: false });
  });
});

describe("round engine: task and execution", () => {
  function decided() {
    const ctx = collecting();
    ctx.engine.submitIdea(A, "dark mode");
    ctx.engine.startVote();
    ctx.engine.castVote(B, 1);
    ctx.engine.closeVote();
    return ctx;
  }

  it("runs the full happy path", () => {
    const { engine } = decided();
    engine.beginPlanning();
    expect(engine.round!.phase).toBe("planning");
    const task = engine.setTask(plan);
    expect(task.status).toBe("draft");
    expect(engine.round!.phase).toBe("awaiting_approval");
    engine.editTask({ title: "Dark mode v2", steps: ["a", "b"] });
    expect(engine.round!.task!.title).toBe("Dark mode v2");
    expectCode(() => engine.beginExecution("x"), "not_approved");
    engine.approveTask("streamer");
    expect(engine.round!.task!.status).toBe("approved");
    expectCode(() => engine.editTask({ title: "nope" }), "wrong_phase");
    engine.beginExecution("aria-code");
    expect(engine.round!.phase).toBe("executing");
    for (let i = 0; i < STEP_LIMIT + 20; i++) engine.appendExecutionStep({ at: 1, kind: "status", text: `step ${i}\u0007` });
    const ex = engine.round!.execution!;
    expect(ex.steps).toHaveLength(STEP_LIMIT);
    expect(ex.steps.at(-1)!.text).toBe(`step ${STEP_LIMIT + 19}`);
    engine.finishExecution({ status: "succeeded", branch: "b", workdir: "/tmp/w", changedFiles: ["a.ts"], summary: "ok", error: null });
    expect(engine.round!.phase).toBe("done");
    expect(engine.round!.execution!.status).toBe("succeeded");
  });

  it("rejects bad edits", () => {
    const { engine } = decided();
    engine.beginPlanning();
    engine.setTask(plan);
    expectCode(() => engine.editTask({ size: "XL" }), "bad_input");
    expectCode(() => engine.editTask({ status: "approved" }), "bad_input");
    expectCode(() => engine.editTask({ steps: [1] }), "bad_input");
  });

  it("reject → rejected; can re-plan from rejected", () => {
    const { engine } = decided();
    engine.beginPlanning();
    engine.setTask(plan);
    engine.rejectTask("streamer", "too big");
    expect(engine.round!.phase).toBe("rejected");
    expect(engine.round!.task!.note).toBe("too big");
    engine.beginPlanning();
    expect(engine.round!.phase).toBe("planning");
    engine.planningFailed("boom");
    expect(engine.round!.phase).toBe("decided");
  });

  it("wrong-phase calls throw wrong_phase", () => {
    const { engine } = collecting();
    expectCode(() => engine.closeVote(), "wrong_phase");
    expectCode(() => engine.beginPlanning(), "wrong_phase");
    expectCode(() => engine.setTask(plan), "wrong_phase");
    expectCode(() => engine.approveTask("x"), "wrong_phase");
    expectCode(() => engine.rejectTask("x"), "wrong_phase");
    expectCode(() => engine.beginExecution("x"), "wrong_phase");
    expectCode(() => engine.appendExecutionStep({ at: 1, kind: "status", text: "x" }), "wrong_phase");
    expectCode(() => engine.finishExecution({ status: "failed", branch: null, workdir: null, changedFiles: [], summary: null, error: null }), "wrong_phase");
    expectCode(() => engine.openRound(), "wrong_phase");
    const err = (() => {
      try {
        engine.closeVote();
      } catch (e) {
        return e as EngineError;
      }
    })();
    expect(err!.status).toBe(409);
  });

  it("reset archives the round and emits a summary", () => {
    const { engine } = decided();
    const events: EngineEvent[] = [];
    engine.on((e) => events.push(e));
    const summary = engine.resetRound()!;
    expect(engine.round).toBeNull();
    expect(summary.winner).toMatchObject({ text: "dark mode", votes: 1, number: 1 });
    expect(events.some((e) => e.type === "archive")).toBe(true);
  });

  it("opening a new round over a finished one archives it", () => {
    const { engine } = decided();
    const events: EngineEvent[] = [];
    engine.on((e) => events.push(e));
    engine.openRound("next");
    expect(engine.round!.index).toBe(2);
    expect(engine.state.stats.rounds).toBe(2);
    expect(events.filter((e) => e.type === "archive")).toHaveLength(1);
  });

  it("restores executing → done/failed and planning → decided", () => {
    const { engine } = decided();
    engine.beginPlanning();
    const snapPlanning = engine.snapshot();
    const restored = makeEngine(snapPlanning).engine;
    expect(restored.round!.phase).toBe("decided");

    engine.setTask(plan);
    engine.approveTask("s");
    engine.beginExecution("aria-code");
    const r2 = makeEngine(engine.snapshot()).engine;
    expect(r2.round!.phase).toBe("done");
    expect(r2.round!.execution!.status).toBe("failed");
    expect(r2.round!.execution!.error).toBe("server restarted during execution");
    expect(r2.state.stats.participants).toBe(engine.state.stats.participants);
  });

  it("bounds the activity feed", () => {
    const { engine } = collecting({ maxIdeasPerRound: 500 });
    for (let i = 0; i < ACTIVITY_LIMIT + 50; i++) engine.submitIdea(user(`u${i}`), `distinct idea number ${i} ${"x".repeat(i % 7)}`);
    expect(engine.state.activity.length).toBe(ACTIVITY_LIMIT);
  });

  it("validates settings", () => {
    const { engine } = makeEngine();
    expectCode(() => engine.updateSettings({ maxCandidates: 1 }), "bad_input");
    expectCode(() => engine.updateSettings({ chatReplies: "yes" }), "bad_input");
    expectCode(() => engine.updateSettings({ bogus: 1 }), "bad_input");
    expect(engine.updateSettings({ maxCandidates: 4 }).maxCandidates).toBe(4);
  });
});
