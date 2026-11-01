/**
 * Twitch OAuth (Authorization Code Flow), token storage/refresh and the
 * dashboard session. Single-channel app: whoever logs in is the broadcaster.
 *
 * tokens.json (0600) holds the user token, refresh token, the user and the
 * active dashboard sessions, so a restart keeps the streamer logged in.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { TwitchUser } from "@aria-live/shared";
import { twitchConfigured, type Config } from "../config.ts";

export const SCOPES = ["user:read:chat", "user:write:chat"] as const;
export const SESSION_COOKIE = "aria_session";
const STATE_TTL_MS = 10 * 60 * 1000;
const VALIDATE_EVERY_MS = 60 * 60 * 1000;
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

export interface StoredSession {
  id: string;
  csrf: string;
  createdAt: number;
}

export interface StoredTokens {
  accessToken: string;
  refreshToken: string;
  /** epoch ms; 0 if unknown */
  expiresAt: number;
  scopes: string[];
  user: TwitchUser;
  sessions: StoredSession[];
}

export interface Session {
  id: string;
  csrf: string;
  user: TwitchUser;
}

export class AuthError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

// ── cookie signing ───────────────────────────────────────────────────────

export function signValue(value: string, secret: string): string {
  const mac = createHmac("sha256", secret).update(value).digest("base64url");
  return `${value}.${mac}`;
}

/** Returns the value if the signature is valid, else null. */
export function unsignValue(signed: string, secret: string): string | null {
  const dot = signed.lastIndexOf(".");
  if (dot <= 0) return null;
  const value = signed.slice(0, dot);
  const given = Buffer.from(signed.slice(dot + 1));
  const expected = Buffer.from(createHmac("sha256", secret).update(value).digest("base64url"));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return value;
}

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) {
    // still spend comparable time
    timingSafeEqual(ba, ba);
    return false;
  }
  return timingSafeEqual(ba, bb);
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (!k || k in out) continue;
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      out[k] = v;
    }
  }
  return out;
}

// ── OAuth state store ────────────────────────────────────────────────────

export class OAuthStateStore {
  private states = new Map<string, number>();
  constructor(private readonly now: () => number = Date.now) {}

  create(): string {
    this.sweep();
    const s = randomBytes(24).toString("base64url");
    this.states.set(s, this.now() + STATE_TTL_MS);
    return s;
  }

  /** Single use: returns true once for a valid, unexpired state. */
  consume(state: string | null | undefined): boolean {
    if (!state) return false;
    const exp = this.states.get(state);
    if (exp === undefined) return false;
    this.states.delete(state);
    return exp > this.now();
  }

  private sweep(): void {
    const now = this.now();
    for (const [k, exp] of this.states) if (exp <= now) this.states.delete(k);
    if (this.states.size > 1000) this.states.clear();
  }
}

// ── auth service ─────────────────────────────────────────────────────────

type FetchFn = typeof fetch;

export interface TwitchAuthOptions {
  fetch?: FetchFn;
  now?: () => number;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
  scope?: string[];
}

interface ValidateResponse {
  client_id: string;
  login: string;
  user_id: string;
  scopes: string[] | null;
  expires_in: number;
}

export class TwitchAuth {
  readonly states: OAuthStateStore;
  private tokens: StoredTokens | null = null;
  private refreshing: Promise<string> | null = null;
  private validateTimer: NodeJS.Timeout | null = null;
  private readonly fetch: FetchFn;
  private readonly now: () => number;
  private readonly path: string;
  private signedOutListeners = new Set<(reason: string) => void>();
  private tokenListeners = new Set<() => void>();

  constructor(
    private readonly config: Config,
    opts: TwitchAuthOptions = {},
  ) {
    this.fetch = opts.fetch ?? fetch;
    this.now = opts.now ?? Date.now;
    this.states = new OAuthStateStore(this.now);
    this.path = join(config.dataDir, "tokens.json");
    this.load();
  }

  get configured(): boolean {
    return twitchConfigured(this.config);
  }

  get user(): TwitchUser | null {
    return this.tokens?.user ?? null;
  }

  get scopes(): string[] {
    return this.tokens?.scopes ?? [];
  }

  get canReply(): boolean {
    return this.scopes.includes("user:write:chat");
  }

  get clientId(): string {
    return this.config.twitch.clientId;
  }

  onSignedOut(fn: (reason: string) => void): () => void {
    this.signedOutListeners.add(fn);
    return () => this.signedOutListeners.delete(fn);
  }

  /** Called whenever a new token is stored (login or refresh). */
  onTokens(fn: () => void): () => void {
    this.tokenListeners.add(fn);
    return () => this.tokenListeners.delete(fn);
  }

  // ── persistence ──

  private load(): void {
    if (!existsSync(this.path)) return;
    try {
      const t = JSON.parse(readFileSync(this.path, "utf8")) as StoredTokens;
      if (t?.accessToken && t.user?.id) this.tokens = { ...t, sessions: t.sessions ?? [] };
    } catch (err) {
      console.warn(`[auth] could not read tokens: ${(err as Error).message}`);
    }
  }

  private save(): void {
    if (!this.tokens) {
      rmSync(this.path, { force: true });
      return;
    }
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.tokens, null, 2), { mode: 0o600 });
    chmodSync(tmp, 0o600);
    renameSync(tmp, this.path);
  }

  // ── sessions ──

  /** Session from a raw Cookie header, or null. */
  sessionFromCookie(cookieHeader: string | undefined): Session | null {
    const raw = parseCookies(cookieHeader)[SESSION_COOKIE];
    if (!raw || !this.tokens) return null;
    const id = unsignValue(raw, this.config.sessionSecret);
    if (!id) return null;
    const s = this.tokens.sessions.find((x) => safeEqual(x.id, id));
    return s ? { id: s.id, csrf: s.csrf, user: this.tokens.user } : null;
  }

  /** `httpsRequest`: the request reached a TLS proxy (X-Forwarded-Proto: https with TRUST_PROXY=1). */
  sessionCookie(sessionId: string, httpsRequest = false): string {
    const secure = httpsRequest || this.config.publicUrl.startsWith("https:") ? "; Secure" : "";
    const v = encodeURIComponent(signValue(sessionId, this.config.sessionSecret));
    return `${SESSION_COOKIE}=${v}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${60 * 60 * 24 * 30}${secure}`;
  }

  clearCookie(httpsRequest = false): string {
    const secure = httpsRequest || this.config.publicUrl.startsWith("https:") ? "; Secure" : "";
    return `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`;
  }

  private newSession(): StoredSession {
    return { id: randomBytes(24).toString("base64url"), csrf: randomBytes(24).toString("base64url"), createdAt: this.now() };
  }

  // ── login flow ──

  authorizeUrl(forceVerify = false): string {
    if (!this.configured) throw new AuthError(503, "not_configured", "Twitch app credentials are not configured");
    const u = new URL(`${this.config.twitch.authBase}/authorize`);
    u.searchParams.set("response_type", "code");
    u.searchParams.set("client_id", this.config.twitch.clientId);
    u.searchParams.set("redirect_uri", this.config.twitch.redirectUri);
    u.searchParams.set("scope", SCOPES.join(" "));
    u.searchParams.set("state", this.states.create());
    if (forceVerify) u.searchParams.set("force_verify", "true");
    return u.toString();
  }

  /** Completes the callback; returns the new session (caller sets the cookie). */
  async completeLogin(params: URLSearchParams): Promise<Session> {
    if (!this.configured) throw new AuthError(503, "not_configured", "Twitch app credentials are not configured");
    const state = params.get("state");
    if (!this.states.consume(state)) throw new AuthError(400, "bad_state", "Login expired or invalid state; try again");
    const err = params.get("error");
    if (err) throw new AuthError(403, "denied", params.get("error_description") ?? err);
    const code = params.get("code");
    if (!code) throw new AuthError(400, "no_code", "Missing authorization code");

    const tok = await this.tokenRequest({
      client_id: this.config.twitch.clientId,
      client_secret: this.config.twitch.clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: this.config.twitch.redirectUri,
    });
    const v = await this.validateToken(tok.access_token);
    if (!v) throw new AuthError(502, "validate_failed", "Twitch did not accept the new token");
    const login = v.login.toLowerCase();
    if (this.config.allowedLogins && !this.config.allowedLogins.includes(login)) {
      await this.revoke(tok.access_token).catch(() => {});
      throw new AuthError(403, "not_allowed", `Twitch account ${login} is not allowed to use this studio`);
    }
    const displayName = (await this.fetchDisplayName(tok.access_token, v.user_id)) ?? v.login;
    const user: TwitchUser = { id: v.user_id, login, displayName };
    const keepSessions = this.tokens?.user.id === user.id ? this.tokens.sessions.slice(-9) : [];
    const session = this.newSession();
    this.tokens = {
      accessToken: tok.access_token,
      refreshToken: tok.refresh_token,
      expiresAt: this.now() + (v.expires_in || tok.expires_in || 0) * 1000,
      scopes: v.scopes ?? tok.scope ?? [],
      user,
      sessions: [...keepSessions, session],
    };
    this.save();
    this.startValidation();
    for (const fn of this.tokenListeners) fn();
    return { id: session.id, csrf: session.csrf, user };
  }

  async logout(): Promise<void> {
    const t = this.tokens;
    this.clear();
    if (t) await this.revoke(t.accessToken).catch(() => {});
  }

  private clear(): void {
    this.tokens = null;
    this.save();
    this.stopValidation();
  }

  private signOut(reason: string): void {
    if (!this.tokens) return;
    this.clear();
    for (const fn of this.signedOutListeners) fn(reason);
  }

  // ── tokens ──

  async getAccessToken(): Promise<string> {
    const t = this.tokens;
    if (!t) throw new AuthError(401, "signed_out", "Not signed in to Twitch");
    if (t.expiresAt && t.expiresAt - REFRESH_MARGIN_MS <= this.now()) return this.refresh();
    return t.accessToken;
  }

  /** Single-flight refresh. Signs out if the refresh token is no longer valid. */
  refresh(): Promise<string> {
    if (this.refreshing) return this.refreshing;
    const t = this.tokens;
    if (!t) return Promise.reject(new AuthError(401, "signed_out", "Not signed in to Twitch"));
    this.refreshing = (async () => {
      try {
        const tok = await this.tokenRequest({
          client_id: this.config.twitch.clientId,
          client_secret: this.config.twitch.clientSecret,
          grant_type: "refresh_token",
          refresh_token: t.refreshToken,
        });
        if (!this.tokens) throw new AuthError(401, "signed_out", "Signed out during refresh");
        this.tokens.accessToken = tok.access_token;
        this.tokens.refreshToken = tok.refresh_token || t.refreshToken;
        this.tokens.expiresAt = this.now() + (tok.expires_in ?? 0) * 1000;
        if (tok.scope) this.tokens.scopes = tok.scope;
        this.save();
        for (const fn of this.tokenListeners) fn();
        return tok.access_token;
      } catch (err) {
        if (err instanceof AuthError && (err.status === 400 || err.status === 401)) {
          this.signOut("Twitch session expired; please log in again");
        }
        throw err;
      } finally {
        this.refreshing = null;
      }
    })();
    return this.refreshing;
  }

  private async tokenRequest(form: Record<string, string>): Promise<TokenResponse> {
    const res = await this.fetch(`${this.config.twitch.authBase}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(form).toString(),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new AuthError(res.status === 400 || res.status === 401 ? res.status : 502, "token_failed", `Twitch token request failed (${res.status}) ${text.slice(0, 200)}`);
    }
    const body = (await res.json()) as TokenResponse;
    if (!body.access_token) throw new AuthError(502, "token_failed", "Twitch returned no access token");
    return body;
  }

  /** null on 401, throws on other failures. */
  private async validateToken(token: string): Promise<ValidateResponse | null> {
    const res = await this.fetch(`${this.config.twitch.authBase}/validate`, {
      headers: { Authorization: `OAuth ${token}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 401) return null;
    if (!res.ok) throw new AuthError(502, "validate_failed", `Twitch validate failed (${res.status})`);
    return (await res.json()) as ValidateResponse;
  }

  private async fetchDisplayName(token: string, id: string): Promise<string | null> {
    try {
      const res = await this.fetch(`${this.config.twitch.apiBase}/users?id=${encodeURIComponent(id)}`, {
        headers: { Authorization: `Bearer ${token}`, "Client-Id": this.config.twitch.clientId },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { data?: { display_name?: string }[] };
      return body.data?.[0]?.display_name ?? null;
    } catch {
      return null;
    }
  }

  private async revoke(token: string): Promise<void> {
    await this.fetch(`${this.config.twitch.authBase}/revoke`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: this.config.twitch.clientId, token }).toString(),
      signal: AbortSignal.timeout(10_000),
    });
  }

  /**
   * Twitch requires validating user tokens hourly. Returns false (and signs
   * out) if the token and refresh token are both dead.
   */
  async validateNow(): Promise<boolean> {
    const t = this.tokens;
    if (!t) return false;
    try {
      let v = await this.validateToken(t.accessToken);
      if (!v) {
        const fresh = await this.refresh();
        v = await this.validateToken(fresh);
        if (!v) {
          this.signOut("Twitch token was revoked; please log in again");
          return false;
        }
      }
      if (this.tokens) {
        this.tokens.scopes = v.scopes ?? this.tokens.scopes;
        this.tokens.expiresAt = this.now() + v.expires_in * 1000;
        this.save();
      }
      return true;
    } catch (err) {
      if (!this.tokens) return false;
      console.warn(`[auth] validate failed (will retry): ${(err as Error).message}`);
      return true; // network trouble: keep the session
    }
  }

  startValidation(): void {
    this.stopValidation();
    this.validateTimer = setInterval(() => void this.validateNow(), VALIDATE_EVERY_MS);
    this.validateTimer.unref?.();
  }

  stopValidation(): void {
    if (this.validateTimer) clearInterval(this.validateTimer);
    this.validateTimer = null;
  }
}
