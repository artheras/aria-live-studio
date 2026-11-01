import type { RoundSummary } from "@aria-live/shared";
import { afterEach, describe, expect, it } from "vitest";
import { liveTitle, vodLink } from "../src/live/twitch-extras.ts";
import { chatEvent, makeEngine } from "./helpers.ts";
import { ALL_SCOPES, startHarness, waitFor, type Harness } from "./harness.ts";

let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});

const TITLE = "Building live: Add dark mode · voted by chat";
const activity = () => h!.service.engine.state.activity.map((a) => a.text);
const settle = (ms = 60) => new Promise((r) => setTimeout(r, ms));

async function start(scopes = ALL_SCOPES) {
  h = await startHarness({}, { scopes });
  (h.service as unknown as { limiter: { tryTake(): boolean } }).limiter = { tryTake: () => true };
  h.service.engine.updateSettings({ ideaCooldownSec: 0, voteDurationSec: 0, executorEnabled: true });
  return h;
}

/** open → idea → vote → winner → plan → approve */
async function toApproved() {
  const x = h!;
  expect((await x.api("POST", "/api/round/open", {})).status).toBe(200);
  x.service.handleChat(chatEvent("!idea add dark mode", { login: "alice" }));
  expect((await x.api("POST", "/api/round/vote", {})).status).toBe(200);
  x.service.handleChat(chatEvent("!vote 1", { login: "bob" }));
  expect((await x.api("POST", "/api/round/close", {})).status).toBe(200);
  expect((await x.api("POST", "/api/task/plan", {})).status).toBe(200);
  expect((await x.api("POST", "/api/task/approve", {})).status).toBe(200);
}

async function build(status: "succeeded" | "failed" = "succeeded") {
  const x = h!;
  expect((await x.api("POST", "/api/execution/start", {})).status).toBe(200);
  await waitFor(() => x.executor.release !== null);
  x.executor.release!({ status, branch: "aria/round-1", workdir: "/tmp/w", changedFiles: ["a.ts"], summary: "ok", error: null });
  await waitFor(() => x.service.engine.round!.phase === "done");
}

async function history(n = 1): Promise<RoundSummary[]> {
  let out: RoundSummary[] = [];
  await waitFor(async () => {
    out = (await (await h!.api("GET", "/api/history")).json()) as RoundSummary[];
    return out.length >= n;
  });
  return out;
}

describe("Twitch extras: helpers", () => {
  it("builds a title within 140 chars without control characters", () => {
    expect(liveTitle("Add dark mode")).toBe(TITLE);
    const long = liveTitle(`Evil\u0007\nname ${"x".repeat(300)}`);
    expect(Array.from(long).length).toBe(140);
    expect(long).toMatch(/^Building live: Evil name x+… · voted by chat$/);
  });
  it("the remembered title survives a restart (snapshot internals)", () => {
    const { engine } = makeEngine();
    engine.setStreamTitle({ original: "Mine", ours: TITLE });
    const again = makeEngine(JSON.parse(JSON.stringify(engine.snapshot()))).engine;
    expect(again.streamTitle).toEqual({ original: "Mine", ours: TITLE });
    engine.openRound("x");
    const snap = JSON.parse(JSON.stringify(engine.snapshot()));
    delete snap.state.round.markers; // snapshot from before markers
    expect(makeEngine(snap).engine.round!.markers).toEqual([]);
  });
  it("formats VOD deep links", () => {
    expect(vodLink("https://www.twitch.tv/videos/1", 3723)).toBe("https://www.twitch.tv/videos/1?t=1h2m3s");
    expect(vodLink("https://www.twitch.tv/videos/1", 59)).toBe("https://www.twitch.tv/videos/1?t=0h0m59s");
  });
});

describe("Twitch extras: scopes", () => {
  it("old tokens keep working: missing scopes are reported and the features are skipped", async () => {
    await start(["user:read:chat", "user:write:chat"]);
    const c = h!.service.engine.state.connection;
    expect(c.scopes).toEqual(["user:read:chat", "user:write:chat"]);
    expect(c.missingScopes).toEqual(["channel:manage:broadcast", "clips:edit"]);
    await toApproved();
    await build();
    expect((await h!.api("POST", "/api/round/reset", {})).status).toBe(200);
    await history();
    expect(h!.twitch.helixCalls("/channels")).toEqual([]);
    expect(h!.twitch.helixCalls("/streams/markers")).toEqual([]);
    expect(h!.twitch.helixCalls("/clips")).toEqual([]);
    expect(h!.twitch.title).toBe("Chill coding stream");
    expect(h!.service.engine.round).toBeNull();
  });

  it("a full grant has nothing missing; the login asks for every scope", async () => {
    await start();
    expect(h!.service.engine.state.connection.missingScopes).toEqual([]);
    const r = await fetch(`${h!.base}/auth/twitch/login?force_verify=true`, { redirect: "manual" });
    const u = new URL(r.headers.get("location")!);
    expect(u.searchParams.get("scope")).toBe(ALL_SCOPES.join(" "));
    expect(u.searchParams.get("force_verify")).toBe("true");
  });

  it("settings switch each feature off", async () => {
    await start();
    h!.service.engine.updateSettings({ autoTitle: false, streamMarkers: false, autoClip: false });
    await toApproved();
    await build();
    await settle();
    expect(h!.twitch.helixCalls("/channels")).toEqual([]);
    expect(h!.twitch.helixCalls("/streams/markers")).toEqual([]);
    expect(h!.twitch.helixCalls("/clips")).toEqual([]);
    expect((await h!.api("PATCH", "/api/settings", { autoClip: "yes" })).status).toBe(400);
  });
});

describe("Twitch extras: stream title", () => {
  it("is set on approve, remembered in the snapshot, and restored when the next round opens", async () => {
    await start();
    await toApproved();
    await waitFor(() => h!.twitch.title === TITLE);
    expect(h!.twitch.helixCalls("/channels", "GET").length).toBe(1);
    expect(JSON.parse(h!.twitch.helixCalls("/channels", "PATCH")[0]!.body)).toEqual({ title: TITLE });
    await waitFor(() => activity().includes(`Stream title set: ${TITLE}`));
    expect(h!.service.engine.snapshot().internals.streamTitle).toEqual({ original: "Chill coding stream", ours: TITLE });

    await build();
    expect((await h!.api("POST", "/api/round/open", {})).status).toBe(200);
    await waitFor(() => h!.twitch.title === "Chill coding stream");
    await waitFor(() => activity().includes("Stream title restored: Chill coding stream"));
    expect(h!.service.engine.snapshot().internals.streamTitle).toBeNull();
  });

  it("is not restored when the streamer changed it meanwhile", async () => {
    await start();
    await toApproved();
    await waitFor(() => h!.twitch.title === TITLE);
    h!.twitch.title = "Streamer's own title";
    expect((await h!.api("POST", "/api/round/reset", {})).status).toBe(200);
    await waitFor(() => activity().includes("Stream title left as it is: it was changed on Twitch"));
    expect(h!.twitch.title).toBe("Streamer's own title");
    expect(h!.twitch.helixCalls("/channels", "PATCH").length).toBe(1);
  });

  it("is restored on logout", async () => {
    await start();
    await toApproved();
    await waitFor(() => h!.twitch.title === TITLE);
    const r = await h!.api("POST", "/auth/logout", undefined, { origin: "http://localhost:3999" });
    expect(r.status).toBe(200);
    expect(h!.twitch.title).toBe("Chill coding stream");
  });

  it("failures become one activity line and never stop the round", async () => {
    await start();
    h!.twitch.channelsStatus = 500;
    await toApproved();
    await waitFor(() => activity().some((a) => a.startsWith("Couldn't update the stream title (500")));
    expect(h!.service.engine.round!.task!.status).toBe("approved");
    await build();
    expect(h!.service.engine.round!.execution!.status).toBe("succeeded");
  });
});

describe("Twitch extras: markers, VOD links and clips", () => {
  it("records markers with Twitch's positions and links them into the VOD", async () => {
    await start();
    await toApproved();
    await build();
    await waitFor(() => h!.service.engine.round!.markers.length === 5);
    const labels = h!.service.engine.round!.markers.map((m) => m.label);
    expect(labels).toEqual([
      "Aria round 1 opened",
      "Aria round 1: vote started",
      "Aria round 1 winner: #1 add dark mode",
      "Aria round 1: build started: Add dark mode",
      "Aria round 1: build succeeded",
    ]);
    expect(h!.twitch.markers.map((m) => m.description)).toEqual(labels);
    const body = JSON.parse(h!.twitch.helixCalls("/streams/markers")[0]!.body);
    expect(body).toEqual({ user_id: "1337", description: "Aria round 1 opened" });
    for (const m of h!.service.engine.round!.markers) expect(m.positionSeconds).toBeGreaterThanOrEqual(3723);

    expect((await h!.api("POST", "/api/round/reset", {})).status).toBe(200);
    const [s] = await history();
    expect(h!.twitch.helixCalls("/videos?user_id=1337&type=archive&first=1").length).toBe(1);
    expect(s!.vodUrl).toBe("https://www.twitch.tv/videos/77");
    expect(s!.markers).toHaveLength(5);
    expect(s!.markers![0]!.url).toMatch(/^https:\/\/www\.twitch\.tv\/videos\/77\?t=1h2m\d+s$/);
  });

  it("does not link a VOD that started after the markers", async () => {
    await start();
    h!.twitch.vod = { ...h!.twitch.vod!, created_at: new Date(Date.now() + 60_000).toISOString() };
    await h!.api("POST", "/api/round/open", {});
    await waitFor(() => h!.service.engine.round!.markers.length === 1);
    await h!.api("POST", "/api/round/reset", {});
    const [s] = await history();
    expect(s!.markers).toHaveLength(1);
    expect(s!.vodUrl).toBeUndefined();
    expect(s!.markers![0]!.url).toBeUndefined();
  });

  it("offline: one 'markers skipped' line per round, no clip, the loop goes on", async () => {
    await start();
    h!.twitch.live = false;
    await toApproved();
    await build();
    await waitFor(() => activity().includes("No clip: the channel is offline"));
    await settle();
    expect(activity().filter((a) => a === "Markers skipped: the channel is offline")).toHaveLength(1);
    expect(h!.twitch.helixCalls("/streams/markers").length).toBe(1);
    expect(h!.service.engine.round!.markers).toEqual([]);
    expect(h!.service.engine.round!.execution!.clipUrl ?? null).toBeNull();
    expect(h!.twitch.title).toBe(TITLE); // the title works offline

    // the next round tries again
    h!.twitch.live = true;
    await h!.api("POST", "/api/round/open", {});
    await waitFor(() => h!.service.engine.round!.markers.length === 1);
    const [s] = await history();
    expect(s!.markers).toEqual([]);
  });

  it("clips a succeeded build, waits until Twitch has it, posts it in chat and keeps it in history", async () => {
    await start();
    h!.twitch.clipPollsUntilReady = 2;
    await toApproved();
    await build();
    await waitFor(() => Boolean(h!.service.engine.round!.execution!.clipUrl));
    expect(h!.service.engine.round!.execution!.clipUrl).toBe("https://clips.twitch.tv/ClipSlug1");
    expect(h!.twitch.helixCalls("/clips?broadcaster_id=1337", "POST").length).toBe(1);
    expect(h!.twitch.helixCalls("/clips?id=ClipSlug1", "GET").length).toBe(3);
    await waitFor(() => h!.twitch.chatMessages().includes("[Aria] Built live: Add dark mode — clip: https://clips.twitch.tv/ClipSlug1"));
    expect(activity()).toContain("Clip saved: https://clips.twitch.tv/ClipSlug1");
    await h!.api("POST", "/api/round/reset", {});
    const [s] = await history();
    expect(s!.execution!.clipUrl).toBe("https://clips.twitch.tv/ClipSlug1");
  });

  it("history waits for a clip still processing when the round is closed early", async () => {
    await start();
    h!.twitch.clipPollsUntilReady = 5;
    await toApproved();
    await build();
    await h!.api("POST", "/api/round/reset", {});
    const [s] = await history();
    expect(s!.execution!.clipUrl).toBe("https://clips.twitch.tv/ClipSlug1");
  });

  it("gives up on a clip Twitch never finishes, and does not clip failed builds", async () => {
    await start();
    h!.twitch.clipPollsUntilReady = 1000;
    await toApproved();
    await build();
    await waitFor(() => activity().includes("No clip: Twitch did not finish the clip in time"), 2000);
    expect(h!.service.engine.round!.execution!.clipUrl ?? null).toBeNull();
    expect(h!.twitch.chatMessages().some((m) => m.includes("clip:"))).toBe(false);

    await h!.api("POST", "/api/round/open", {});
    h!.service.handleChat(chatEvent("!idea add a leaderboard", { login: "carol" }));
    await h!.api("POST", "/api/round/vote", {});
    h!.service.handleChat(chatEvent("!vote 1", { login: "dave" }));
    await h!.api("POST", "/api/round/close", {});
    await h!.api("POST", "/api/task/plan", {});
    await h!.api("POST", "/api/task/approve", {});
    h!.executor.release = null;
    await build("failed");
    await settle();
    expect(h!.twitch.clips).toHaveLength(1);
  });
});
