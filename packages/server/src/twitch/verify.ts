/**
 * `npm run verify:twitch`: checks the logged-in token against the real
 * Twitch API before going live: token, scopes, channel, live state, VOD
 * storage, and (with --write) the stream title round trip, a marker, a clip
 * and a chat message, recording exactly what Twitch answered.
 *
 * It reads data/tokens.json but never refreshes or rewrites it, so it is
 * safe to run next to a running server. The report contains no secrets.
 */
import { TWITCH_SCOPES, FEATURE_SCOPE } from "@aria-live/shared";
import { HelixClient, HelixError, type TokenProvider } from "./helix.ts";
import { liveTitle } from "../live/twitch-extras.ts";

export type Outcome = "pass" | "warn" | "fail" | "skip";

export interface CheckResult {
  id: string;
  outcome: Outcome;
  detail: string;
  /** What Twitch answered, for the checks whose exact answer matters. */
  observed?: { status: number; message?: string; data?: unknown };
}

export interface VerifyOptions {
  clientId: string;
  accessToken: string | null;
  authBase: string;
  apiBase: string;
  /** Change the title (then restore it), create a marker and a clip. */
  write: boolean;
  /** Also post one message in chat. */
  chat: boolean;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  clipPollMs?: number;
  clipWaitMs?: number;
}

export interface VerifyReport {
  at: string;
  login: string | null;
  live: boolean | null;
  results: CheckResult[];
}

const SELF_TEST = "Aria Live self-test";

function observe(err: unknown): CheckResult["observed"] {
  if (err instanceof HelixError) {
    return { status: err.status, message: (err.body as { message?: string } | undefined)?.message ?? err.message };
  }
  return { status: 0, message: (err as Error)?.message ?? String(err) };
}

export async function verifyTwitch(o: VerifyOptions): Promise<VerifyReport> {
  const f = o.fetch ?? fetch;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const results: CheckResult[] = [];
  const add = (r: CheckResult) => {
    results.push(r);
    return r;
  };
  const report: VerifyReport = { at: new Date().toISOString(), login: null, live: null, results };

  if (!o.clientId) {
    add({ id: "config", outcome: "fail", detail: "TWITCH_CLIENT_ID is not set (.env)" });
    return report;
  }
  if (!o.accessToken) {
    add({ id: "token", outcome: "fail", detail: "No Twitch login found: start the server and log in on the dashboard first" });
    return report;
  }

  // ── token ──
  let userId = "";
  let scopes: string[] = [];
  try {
    const res = await f(`${o.authBase}/validate`, {
      headers: { Authorization: `OAuth ${o.accessToken}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 401) {
      add({ id: "token", outcome: "fail", detail: "Token expired or revoked: open the dashboard (it refreshes the token) or log in again", observed: { status: 401 } });
      return report;
    }
    if (!res.ok) throw new HelixError(res.status, `validate failed (${res.status})`);
    const v = (await res.json()) as { login: string; user_id: string; client_id: string; scopes: string[] | null; expires_in: number };
    userId = v.user_id;
    scopes = v.scopes ?? [];
    report.login = v.login;
    if (v.client_id !== o.clientId) {
      add({ id: "token", outcome: "fail", detail: `Token belongs to another Twitch app (client ${v.client_id}); log in again` });
      return report;
    }
    add({ id: "token", outcome: "pass", detail: `Logged in as ${v.login}; token valid for ${Math.round(v.expires_in / 60)} more minutes` });
  } catch (err) {
    add({ id: "token", outcome: "fail", detail: `Cannot reach Twitch to validate the token (${observe(err)?.message})` });
    return report;
  }

  const missing = TWITCH_SCOPES.filter((s) => !scopes.includes(s));
  add({
    id: "scopes",
    outcome: missing.length ? "warn" : "pass",
    detail: missing.length
      ? `Missing ${missing.join(", ")}: click "Reconnect Twitch" on the dashboard (or open /auth/twitch/login?force_verify=true)`
      : `All scopes granted (${TWITCH_SCOPES.join(", ")})`,
  });

  const tokens: TokenProvider = {
    clientId: o.clientId,
    getAccessToken: async () => o.accessToken!,
    refresh: async () => {
      throw new HelixError(401, "Token rejected; this check does not refresh tokens. Open the dashboard and run it again.");
    },
  };
  const helix = new HelixClient(o.apiBase, tokens, { fetch: f });

  // ── reads ──
  let original: string | null = null;
  try {
    const ch = await helix.getChannel(userId);
    original = ch?.title ?? null;
    add({ id: "channel", outcome: ch ? "pass" : "fail", detail: ch ? `Channel title: "${ch.title}"` : "Channel not found" });
  } catch (err) {
    add({ id: "channel", outcome: "fail", detail: "Could not read the channel", observed: observe(err) });
  }

  try {
    const res = await helix.request<{ data: { type: string; started_at: string }[] }>("GET", `/streams?user_id=${encodeURIComponent(userId)}`);
    const s = res?.data?.[0];
    report.live = !!s && s.type === "live";
    add({
      id: "live",
      outcome: report.live ? "pass" : "warn",
      detail: report.live
        ? `Live since ${s!.started_at}`
        : "Channel is offline: markers and clips only work while live (go live, even unlisted/test, and run again with --write)",
    });
  } catch (err) {
    add({ id: "live", outcome: "fail", detail: "Could not read the stream state", observed: observe(err) });
  }

  try {
    const vod = await helix.getLatestArchive(userId);
    add({
      id: "vod",
      outcome: vod ? "pass" : "warn",
      detail: vod
        ? `Latest past broadcast: ${vod.url} (${vod.created_at})`
        : 'No past broadcasts: turn on Settings → Stream → "Store past broadcasts" so markers get VOD links',
    });
  } catch (err) {
    add({ id: "vod", outcome: "warn", detail: "Could not list past broadcasts", observed: observe(err) });
  }

  if (!o.write) {
    for (const id of ["title", "marker", "clip"]) add({ id, outcome: "skip", detail: "Run with --write to test it on your channel" });
    add({ id: "chat", outcome: "skip", detail: "Run with --write --chat to post one test message" });
    return report;
  }

  // ── title round trip ──
  if (!scopes.includes(FEATURE_SCOPE.autoTitle)) {
    add({ id: "title", outcome: "skip", detail: `Needs ${FEATURE_SCOPE.autoTitle}` });
  } else if (original === null) {
    add({ id: "title", outcome: "skip", detail: "Original title unknown; not changing it" });
  } else {
    const test = liveTitle(SELF_TEST);
    let changed = false;
    try {
      await helix.setChannelTitle(userId, test);
      changed = true;
      const after = (await helix.getChannel(userId))?.title;
      if (after !== test) throw new Error(`Twitch shows "${after}" after the change`);
      await helix.setChannelTitle(userId, original);
      changed = false;
      const back = (await helix.getChannel(userId))?.title;
      add({
        id: "title",
        outcome: back === original ? "pass" : "fail",
        detail: back === original ? `Set "${test}", then restored "${original}"` : `Restore did not stick: Twitch shows "${back}"`,
      });
    } catch (err) {
      add({ id: "title", outcome: "fail", detail: "Title change failed", observed: observe(err) });
    } finally {
      if (changed) await helix.setChannelTitle(userId, original).catch(() => {});
    }
  }

  // ── marker ──
  if (!scopes.includes(FEATURE_SCOPE.streamMarkers)) {
    add({ id: "marker", outcome: "skip", detail: `Needs ${FEATURE_SCOPE.streamMarkers}` });
  } else {
    try {
      const m = await helix.createStreamMarker(userId, SELF_TEST);
      add({
        id: "marker",
        outcome: typeof m.position_seconds === "number" ? "pass" : "fail",
        detail: `Marker at ${m.position_seconds}s (${m.created_at})`,
        observed: { status: 200, data: m },
      });
    } catch (err) {
      const obs = observe(err);
      // Offline is expected to fail; what matters is how, which the studio relies on.
      const expected = report.live === false && (obs?.status === 404 || (obs?.status === 400 && /live|offline|broadcast/i.test(obs.message ?? "")));
      add({
        id: "marker",
        outcome: report.live === false ? (expected ? "pass" : "warn") : "fail",
        detail:
          report.live === false
            ? expected
              ? "Offline answer recognized (the studio will skip markers while offline)"
              : "Offline answer NOT recognized by the studio; send this report so the check can be updated"
            : "Marker failed while live",
        observed: obs,
      });
    }
  }

  // ── clip ──
  if (!scopes.includes(FEATURE_SCOPE.autoClip)) {
    add({ id: "clip", outcome: "skip", detail: `Needs ${FEATURE_SCOPE.autoClip}` });
  } else {
    try {
      const c = await helix.createClip(userId);
      const deadline = Date.now() + (o.clipWaitMs ?? 15_000);
      let url: string | null = null;
      while (Date.now() < deadline) {
        await sleep(o.clipPollMs ?? 1500);
        const got = await helix.getClip(c.id).catch(() => null);
        if (got) {
          url = got.url ?? `https://clips.twitch.tv/${c.id}`;
          break;
        }
      }
      add({
        id: "clip",
        outcome: url ? "pass" : "warn",
        detail: url ? `Clip ready: ${url}` : "Clip was accepted but not ready within 15 s (Twitch says to treat that as failed)",
        observed: { status: 202, data: { id: c.id } },
      });
    } catch (err) {
      const obs = observe(err);
      add({
        id: "clip",
        outcome: report.live === false ? (obs?.status === 404 ? "pass" : "warn") : "fail",
        detail:
          report.live === false
            ? obs?.status === 404
              ? 'Offline answer is 404 (the studio says "No clip: the channel is offline")'
              : `Offline answer is ${obs?.status}, not 404: the studio will show "No clip (${obs?.status} …)"; send this report`
            : "Clip failed while live",
        observed: obs,
      });
    }
  }

  // ── chat ──
  if (!o.chat) {
    add({ id: "chat", outcome: "skip", detail: "Run with --chat to post one test message" });
  } else if (!scopes.includes("user:write:chat")) {
    add({ id: "chat", outcome: "skip", detail: "Needs user:write:chat" });
  } else {
    try {
      const sent = await helix.sendChatMessage(userId, userId, `[Aria] ${SELF_TEST} ✓`);
      add({
        id: "chat",
        outcome: sent.is_sent ? "pass" : "fail",
        detail: sent.is_sent ? "Test message posted in your chat" : `Twitch dropped it: ${sent.drop_reason?.message ?? "no reason"}`,
      });
    } catch (err) {
      add({ id: "chat", outcome: "fail", detail: "Could not post in chat", observed: observe(err) });
    }
  }
  return report;
}

const ICON: Record<Outcome, string> = { pass: "PASS", warn: "WARN", fail: "FAIL", skip: "skip" };

export function formatReport(r: VerifyReport): string {
  const lines = [`Twitch check ${r.at}${r.login ? ` for ${r.login}` : ""}`, ""];
  for (const c of r.results) {
    lines.push(`  ${ICON[c.outcome].padEnd(4)}  ${c.id.padEnd(8)} ${c.detail}`);
    if (c.observed && c.outcome !== "pass") lines.push(`${" ".repeat(16)}Twitch answered ${c.observed.status}${c.observed.message ? `: ${c.observed.message}` : ""}`);
  }
  return lines.join("\n");
}
