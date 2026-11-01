/**
 * Optional Twitch extras around the round: the stream title while a task is
 * built, stream markers at the round's key moments (with VOD deep links in
 * the history) and a clip when a build succeeds.
 *
 * Everything here is best effort and asynchronous: it reacts to engine
 * milestones, talks to Helix, and writes back only what Twitch confirmed.
 * Failures become one activity line; nothing here throws into the round loop.
 * A feature runs only when its setting is on and the token has its scope.
 */
import { FEATURE_SCOPE, type RoundSummary, type StreamMarker, type Task, type TwitchUser } from "@aria-live/shared";
import type { HelixClient } from "../twitch/helix.ts";
import { HelixError } from "../twitch/helix.ts";
import type { Milestone, RoundEngine } from "./engine.ts";

export const TITLE_MAX = 140;
export const MARKER_MAX = 140;
const TITLE_PREFIX = "Building live: ";
const TITLE_SUFFIX = " · voted by chat";
const CONTROL = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g;

type Helix = Pick<
  HelixClient,
  "getChannel" | "setChannelTitle" | "createStreamMarker" | "getLatestArchive" | "createClip" | "getClip"
>;

export interface TwitchExtrasDeps {
  engine: RoundEngine;
  auth: { readonly user: TwitchUser | null; hasScope(scope: string): boolean };
  helix: Helix;
  /** Rate-limited chat reply (adds the [Aria] prefix, honours chatReplies). */
  reply: (text: string) => void;
  now?: () => number;
  /** Delay between GET /clips polls. */
  clipPollMs?: number;
  /** How long to wait for Twitch to finish a clip (Twitch: assume failure after ~15 s). */
  clipWaitMs?: number;
}

function clean(s: string): string {
  return s.replace(CONTROL, " ").replace(/\s+/g, " ").trim();
}

function cut(s: string, max: number): string {
  const chars = Array.from(s);
  return chars.length <= max ? s : `${chars.slice(0, max - 1).join("").trimEnd()}…`;
}

/** "Building live: <task title> · voted by chat", within Twitch's 140 characters. */
export function liveTitle(taskTitle: string): string {
  const room = TITLE_MAX - Array.from(TITLE_PREFIX).length - Array.from(TITLE_SUFFIX).length;
  return `${TITLE_PREFIX}${cut(clean(taskTitle) || "a viewer idea", room)}${TITLE_SUFFIX}`;
}

/** `https://www.twitch.tv/videos/1?t=1h2m3s` */
export function vodLink(vodUrl: string, seconds: number): string {
  const t = Math.max(0, Math.floor(seconds));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  return `${vodUrl}?t=${h}h${m}m${s}s`;
}

/** Short reason for an activity line. */
export function helixReason(err: unknown): string {
  if (err instanceof HelixError) {
    const msg = (err.body as { message?: string } | undefined)?.message;
    return `${err.status}${msg ? `: ${msg}` : ""}`;
  }
  const e = err as Error;
  if (e?.name === "TimeoutError" || e?.name === "AbortError") return "Twitch did not answer in time";
  return e?.message || "unknown error";
}

/** Markers and clips need a live broadcast; Twitch answers 404 (or a 400 naming it) otherwise. */
function isOffline(err: unknown): boolean {
  if (!(err instanceof HelixError)) return false;
  if (err.status === 404) return true;
  const msg = String((err.body as { message?: string } | undefined)?.message ?? "");
  return err.status === 400 && /live|offline|broadcast/i.test(msg);
}

export class TwitchExtras {
  private titleChain: Promise<void> = Promise.resolve();
  private markerChain: Promise<void> = Promise.resolve();
  /** Rounds for which markers stopped (offline or refused): one activity line per round. */
  private markersOff = new Set<string>();
  /** Markers made in this process per round, including any that landed after the round was archived. */
  private made = new Map<string, StreamMarker[]>();
  private clips = new Map<string, Promise<string | null>>();
  private readonly stopped = new AbortController();
  private readonly now: () => number;
  private readonly pollMs: number;
  private readonly waitMs: number;

  constructor(private readonly deps: TwitchExtrasDeps) {
    this.now = deps.now ?? Date.now;
    this.pollMs = deps.clipPollMs ?? 1500;
    this.waitMs = deps.clipWaitMs ?? 15_000;
  }

  stop(): void {
    this.stopped.abort();
  }

  private get engine(): RoundEngine {
    return this.deps.engine;
  }

  private note(text: string): void {
    try {
      this.engine.note("system", text);
    } catch {
      /* never let a note break anything */
    }
  }

  /** The broadcaster when the feature's setting is on and its scope granted. */
  private enabled(feature: keyof typeof FEATURE_SCOPE): TwitchUser | null {
    const user = this.deps.auth.user;
    if (!user || !this.engine.state.settings[feature]) return null;
    return this.deps.auth.hasScope(FEATURE_SCOPE[feature]) ? user : null;
  }

  handle(m: Milestone): void {
    try {
      const r = m.round;
      switch (m.kind) {
        case "round_opened":
          return this.marker(r.id, `Aria round ${r.index} opened${r.prompt ? `: ${r.prompt}` : ""}`);
        case "vote_started":
          return this.marker(r.id, `Aria round ${r.index}: vote started`);
        case "winner": {
          const n = r.tallies.find((t) => t.ideaId === m.idea.id)?.number ?? m.idea.number;
          return this.marker(r.id, `Aria round ${r.index} winner: #${n} ${m.idea.text}`);
        }
        case "task_approved":
          return this.setTitle(m.task);
        case "build_started":
          return this.marker(r.id, `Aria round ${r.index}: build started: ${r.task?.title ?? ""}`);
        case "build_finished":
          this.marker(r.id, `Aria round ${r.index}: build ${m.execution.status}`);
          if (m.execution.status === "succeeded") this.clip(r.id, m.execution.id, r.task?.title ?? "");
          return;
      }
    } catch (err) {
      console.warn(`[twitch] ${(err as Error).message}`);
    }
  }

  // ── stream title ─────────────────────────────────────────────────────

  private queueTitle(fn: () => Promise<void>): Promise<void> {
    const next = this.titleChain.then(fn).catch((err) => console.warn(`[twitch] title: ${(err as Error).message}`));
    this.titleChain = next;
    return next;
  }

  private setTitle(task: Task): void {
    const user = this.enabled("autoTitle");
    if (!user) return;
    const title = liveTitle(task.title);
    void this.queueTitle(async () => {
      try {
        // Already ours from an earlier task (not restored yet): keep the streamer's original.
        let original = this.engine.streamTitle?.original;
        if (original === undefined) {
          const ch = await this.deps.helix.getChannel(user.id);
          if (!ch) throw new Error("channel not found");
          original = ch.title;
        }
        await this.deps.helix.setChannelTitle(user.id, title);
        this.engine.setStreamTitle({ original, ours: title });
        this.note(`Stream title set: ${title}`);
      } catch (err) {
        this.note(`Couldn't update the stream title (${helixReason(err)})`);
      }
    });
  }

  /**
   * Put the streamer's title back, but only while Twitch still shows the one
   * Aria set (a title the streamer changed in the meantime is left alone).
   */
  restoreTitle(): Promise<void> {
    return this.queueTitle(async () => {
      const memo = this.engine.streamTitle;
      const user = this.deps.auth.user;
      if (!memo || !user || !this.deps.auth.hasScope(FEATURE_SCOPE.autoTitle)) return;
      try {
        const ch = await this.deps.helix.getChannel(user.id);
        if (ch && ch.title === memo.ours && memo.original) {
          await this.deps.helix.setChannelTitle(user.id, memo.original);
          this.note(`Stream title restored: ${memo.original}`);
        } else if (ch && ch.title !== memo.ours) {
          this.note("Stream title left as it is: it was changed on Twitch");
        }
        this.engine.setStreamTitle(null);
      } catch (err) {
        // Keep the memo: the next round end or logout tries again.
        this.note(`Couldn't update the stream title (${helixReason(err)})`);
      }
    });
  }

  // ── stream markers ───────────────────────────────────────────────────

  private marker(roundId: string, label: string): void {
    const user = this.enabled("streamMarkers");
    if (!user || this.markersOff.has(roundId)) return;
    const description = cut(clean(label), MARKER_MAX);
    this.markerChain = this.markerChain.then(async () => {
      if (this.markersOff.has(roundId)) return;
      try {
        const m = await this.deps.helix.createStreamMarker(user.id, description);
        if (typeof m.position_seconds !== "number") throw new Error("Twitch returned no marker position");
        const marker: StreamMarker = {
          label: description,
          positionSeconds: m.position_seconds,
          createdAt: Date.parse(m.created_at) || this.now(),
        };
        const list = this.made.get(roundId) ?? [];
        list.push(marker);
        this.made.set(roundId, list);
        this.engine.addMarker(roundId, marker);
      } catch (err) {
        this.markersOff.add(roundId);
        this.note(isOffline(err) ? "Markers skipped: the channel is offline" : `Markers skipped (${helixReason(err)})`);
      }
    });
  }

  // ── clip ─────────────────────────────────────────────────────────────

  private clip(roundId: string, executionId: string, taskTitle: string): void {
    const user = this.enabled("autoClip");
    if (!user) return;
    const run = (async (): Promise<string | null> => {
      try {
        const created = await this.deps.helix.createClip(user.id);
        const deadline = this.now() + this.waitMs;
        for (;;) {
          await this.sleep(this.pollMs);
          if (this.stopped.signal.aborted) return null;
          const found = await this.deps.helix.getClip(created.id).catch(() => null);
          if (found) break;
          if (this.now() >= deadline) {
            this.note("No clip: Twitch did not finish the clip in time");
            return null;
          }
        }
        const url = `https://clips.twitch.tv/${encodeURIComponent(created.id)}`;
        this.engine.setClipUrl(executionId, url);
        this.note(`Clip saved: ${url}`);
        this.deps.reply(`Built live: ${clean(taskTitle)} — clip: ${url}`);
        return url;
      } catch (err) {
        this.note(isOffline(err) ? "No clip: the channel is offline" : `No clip (${helixReason(err)})`);
        return null;
      }
    })();
    this.clips.set(roundId, run);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      if (this.stopped.signal.aborted) return resolve();
      const t = setTimeout(done, ms);
      const onAbort = () => done();
      this.stopped.signal.addEventListener("abort", onAbort, { once: true });
      function done() {
        clearTimeout(t);
        resolve();
      }
    });
  }

  // ── round end ────────────────────────────────────────────────────────

  /**
   * Finish an archived round's summary: wait (bounded) for markers and the
   * clip still in flight, then look up the VOD for marker deep links.
   */
  async enrich(summary: RoundSummary): Promise<RoundSummary> {
    const id = summary.id;
    const clip = this.clips.get(id);
    const pending = Promise.all([this.markerChain, clip ?? Promise.resolve(null)]);
    const bound = new Promise<null>((r) => {
      const t = setTimeout(() => r(null), this.waitMs + 15_000);
      t.unref?.();
      this.stopped.signal.addEventListener("abort", () => r(null), { once: true });
    });
    const res = await Promise.race([pending, bound]);
    const clipUrl = res?.[1] ?? null;
    this.clips.delete(id);
    const out: RoundSummary = { ...summary };
    if (clipUrl && out.execution && !out.execution.clipUrl) out.execution = { ...out.execution, clipUrl };

    const markers = [...(summary.markers ?? [])];
    for (const m of this.made.get(id) ?? []) {
      if (!markers.some((x) => x.createdAt === m.createdAt && x.positionSeconds === m.positionSeconds)) markers.push({ ...m });
    }
    this.made.delete(id);
    this.markersOff.delete(id);
    markers.sort((a, b) => a.createdAt - b.createdAt);
    out.markers = markers;

    const user = this.deps.auth.user;
    const first = markers[0];
    if (first && user && !this.stopped.signal.aborted) {
      try {
        const vod = await this.deps.helix.getLatestArchive(user.id);
        const created = vod ? Date.parse(vod.created_at) : NaN;
        if (vod && /^https:\/\//.test(vod.url) && Number.isFinite(created) && created <= first.createdAt) {
          out.vodUrl = vod.url;
          out.markers = markers.map((m) => ({ ...m, url: vodLink(vod.url, m.positionSeconds) }));
        }
      } catch (err) {
        console.warn(`[twitch] VOD lookup failed: ${helixReason(err)}`);
      }
    }
    return out;
  }
}
