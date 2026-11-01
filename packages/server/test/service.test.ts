import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DASHBOARD_ONLY_REPLY, MOD_HELP, VIEWER_HELP } from "../src/live/service.ts";
import { chatEvent } from "./helpers.ts";
import { startHarness, waitFor, type Harness } from "./harness.ts";

let h: Harness;
const MOD = { login: "mod_marta", badges: ["moderator"] };

beforeEach(async () => {
  h = await startHarness();
  // Every reply is observable in these tests (the limiter has its own tests).
  (h.service as unknown as { limiter: { tryTake(): boolean } }).limiter = { tryTake: () => true };
  h.service.engine.updateSettings({ ideaCooldownSec: 0, voteDurationSec: 60 });
});
afterEach(async () => {
  await h.close();
});

const chat = (text: string, opts: Parameters<typeof chatEvent>[1] = {}) => h.service.handleChat(chatEvent(text, opts));
const replies = async (n: number) => {
  await waitFor(() => h.twitch.chatMessages().length >= n);
  return h.twitch.chatMessages();
};
const settle = () => new Promise((r) => setTimeout(r, 50));

describe("moderator chat commands", () => {
  it("a viewer's !aria close/open/vote does nothing and gets no reply; a mod's works", async () => {
    chat("!aria open", { login: "viewer1" });
    chat("!aria open", { login: "sub1", badges: ["subscriber"] });
    chat("!aria open", { login: "vip1", badges: ["vip"] });
    await settle();
    expect(h.service.engine.round).toBeNull();
    expect(h.twitch.chatMessages()).toEqual([]);

    chat("!aria open boss fight", MOD);
    expect(h.service.engine.round).toMatchObject({ phase: "collecting", prompt: "boss fight" });
    expect((await replies(1))[0]).toBe("[Aria] Round 1 is open: boss fight. Propose with !idea <your idea>");
    expect(h.service.engine.state.activity.at(-1)).toMatchObject({ text: "Round 1 opened by @mod_marta: boss fight", user: { login: "mod_marta" } });

    chat("!idea add dark mode", { login: "alice" });
    chat("!aria vote", { login: "viewer1" });
    expect(h.service.engine.round!.phase).toBe("collecting");
    chat("!aria vote", MOD);
    expect(h.service.engine.round!.phase).toBe("voting");
    chat("!vote 1", { login: "bob" });
    await settle(); // let earlier replies and the vote summary go out

    const before = h.twitch.chatMessages().length;
    chat("!aria close", { login: "viewer1" });
    chat("!aria extend 30", { login: "viewer1" });
    await settle();
    expect(h.service.engine.round!.phase).toBe("voting");
    expect(h.twitch.chatMessages().length).toBe(before);

    const end = h.service.engine.round!.votingEndsAt!;
    chat("!aria extend 30", MOD);
    expect(h.service.engine.round!.votingEndsAt).toBe(end + 30_000);
    chat("!aria close", { login: "streamer", userId: "1337", badges: ["broadcaster"] });
    expect(h.service.engine.round!.phase).toBe("decided");
    const msgs = await replies(before + 2);
    expect(msgs).toContain("[Aria] Voting extended by 30s");
    expect(msgs).toContain("[Aria] Vote closed. Winner: #1 add dark mode (1 votes)");
    expect(h.service.engine.state.activity.some((a) => a.text === "Voting closed by @streamer")).toBe(true);
  });

  it("a mod's !aria approve/run does not approve or run; it points to the dashboard", async () => {
    chat("!aria open", MOD);
    chat("!idea add dark mode", { login: "alice" });
    chat("!aria vote", MOD);
    chat("!vote 1", { login: "bob" });
    chat("!aria close", MOD);
    expect((await h.api("POST", "/api/task/plan", {})).status).toBe(200);
    expect(h.service.engine.round!.phase).toBe("awaiting_approval");
    await settle();
    const before = h.twitch.chatMessages().length;
    for (const verb of ["approve", "run", "reject", "cancel"]) chat(`!aria ${verb}`, MOD);
    chat("!aria approve", { login: "streamer", userId: "1337", badges: ["broadcaster"] });
    const msgs = (await replies(before + 5)).slice(before);
    expect(msgs.every((m) => m === `[Aria] @${m.includes("@streamer") ? "streamer" : "mod_marta"} ${DASHBOARD_ONLY_REPLY}`)).toBe(true);
    expect(msgs[0]).toContain("Approvals happen on the dashboard");
    const r = h.service.engine.round!;
    expect(r.phase).toBe("awaiting_approval");
    expect(r.task!.status).toBe("draft");
    expect(r.execution).toBeNull();
    // a viewer's attempt is silent
    chat("!aria approve", { login: "viewer1" });
    await settle();
    expect(h.twitch.chatMessages().length).toBe(before + 5);
    // and open is refused while a task is in progress
    chat("!aria open", MOD);
    expect(h.service.engine.round!.phase).toBe("awaiting_approval");
  });

  it("mod open while a round runs, hide by number, malformed commands, mod help", async () => {
    chat("!aria open", MOD);
    chat("!idea add dark mode", { login: "alice" });
    chat("!idea add a leaderboard", { login: "bob" });
    chat("!aria open", MOD);
    expect(h.service.engine.round!.index).toBe(1);
    chat("!aria hide 2", MOD);
    expect(h.service.engine.round!.ideas[1]!.hidden).toBe(true);
    chat("!aria hide 7", MOD);
    chat("!aria extend lots", MOD);
    chat("!aria", MOD);
    chat("!aria", { login: "viewer1" });
    const msgs = await replies(7);
    expect(msgs).toContain("[Aria] @mod_marta round 1 is already running (collecting ideas)");
    expect(msgs).toContain("[Aria] @mod_marta idea #2 hidden");
    expect(msgs).toContain("[Aria] @mod_marta no idea #7");
    expect(msgs.some((m) => m.startsWith("[Aria] @mod_marta usage: !aria extend"))).toBe(true);
    expect(msgs).toContain(`[Aria] ${VIEWER_HELP} ${MOD_HELP}`);
    expect(msgs.at(-1)).toBe(`[Aria] ${VIEWER_HELP}`);
    expect(MOD_HELP).toMatch(/idea # while collecting, ballot # while voting/);
  });
});

describe("eligibility and +1 by number through chat", () => {
  it("subscriber-only vote: one reply per non-sub per round; subs and mods count", async () => {
    h.service.engine.updateSettings({ voteEligibility: "subscribers" });
    chat("!aria open", MOD);
    chat("!idea add dark mode", { login: "alice" });
    chat("!idea add a leaderboard", { login: "bob" });
    chat("!idea +1", { login: "carol" });
    chat("!+1 1", { login: "dave" });
    chat("!+1 1", { login: "dave" }); // not counted twice
    chat("!idea +1", { login: "alice" }); // own idea
    expect(h.service.engine.round!.ideas[0]!.seconds).toBe(2);
    chat("!aria vote", MOD);
    await settle();
    const before = h.twitch.chatMessages().length;
    chat("!vote 1", { login: "nosub" });
    chat("!vote 2", { login: "nosub" });
    chat("!vote 1", { login: "sub", badges: ["subscriber"] });
    chat("!vote 1", { login: "founder", badges: ["founder"] });
    chat("!vote 2", MOD);
    const r = h.service.engine.round!;
    expect(r.voters).toBe(3);
    expect(r.ineligible).toBe(2);
    await settle();
    const msgs = h.twitch.chatMessages().slice(before).filter((m) => m.includes("@nosub"));
    expect(msgs).toEqual(["[Aria] @nosub only subscribers can vote this round"]);
  });
});
