/**
 * Minimal Helix client: Client-Id + Bearer, JSON, 10s timeouts, one
 * refresh-and-retry on 401, waits for Ratelimit-Reset on 429.
 */
type FetchFn = typeof fetch;

export interface TokenProvider {
  readonly clientId: string;
  getAccessToken(): Promise<string>;
  refresh(): Promise<string>;
}

export class HelixError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = "HelixError";
  }
}

export interface HelixUser {
  id: string;
  login: string;
  display_name: string;
}

export interface EventSubSubscription {
  id: string;
  status: string;
  type: string;
  version: string;
  condition: Record<string, string>;
}

export interface SentChatMessage {
  message_id: string;
  is_sent: boolean;
  drop_reason?: { code: string; message: string } | null;
}

/** The part of Helix the EventSub client needs (fakeable in tests). */
export interface EventSubApi {
  createEventSubSubscription(
    type: string,
    version: string,
    condition: Record<string, string>,
    sessionId: string,
  ): Promise<EventSubSubscription>;
  deleteEventSubSubscription(id: string): Promise<void>;
}

export interface HelixOptions {
  fetch?: FetchFn;
  timeoutMs?: number;
  /** Max time to wait for a rate-limit reset before giving up. */
  maxRateWaitMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export class HelixClient implements EventSubApi {
  private readonly fetch: FetchFn;
  private readonly timeoutMs: number;
  private readonly maxRateWaitMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    private readonly base: string,
    private readonly tokens: TokenProvider,
    opts: HelixOptions = {},
  ) {
    this.fetch = opts.fetch ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    this.maxRateWaitMs = opts.maxRateWaitMs ?? 15_000;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let token = await this.tokens.getAccessToken();
    let refreshed = false;
    let rateRetried = false;
    for (;;) {
      const headers: Record<string, string> = {
        "Client-Id": this.tokens.clientId,
        Authorization: `Bearer ${token}`,
      };
      if (body !== undefined) headers["Content-Type"] = "application/json";
      const res = await this.fetch(`${this.base}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (res.status === 401 && !refreshed) {
        refreshed = true;
        await res.body?.cancel().catch(() => {});
        token = await this.tokens.refresh();
        continue;
      }
      if (res.status === 429 && !rateRetried) {
        rateRetried = true;
        const reset = Number(res.headers.get("ratelimit-reset"));
        const wait = Number.isFinite(reset) && reset > 0 ? reset * 1000 - Date.now() : 1000;
        await res.body?.cancel().catch(() => {});
        if (wait <= this.maxRateWaitMs) {
          await this.sleep(Math.max(0, wait));
          continue;
        }
        throw new HelixError(429, "Twitch rate limit exceeded");
      }
      const text = await res.text();
      let json: unknown = undefined;
      if (text) {
        try {
          json = JSON.parse(text);
        } catch {
          json = text;
        }
      }
      if (!res.ok) {
        const msg = (json as { message?: string } | undefined)?.message ?? res.statusText;
        throw new HelixError(res.status, `Helix ${method} ${path.split("?")[0]} failed (${res.status}): ${msg}`, json);
      }
      return json as T;
    }
  }

  async getUsers(query: { ids?: string[]; logins?: string[] } = {}): Promise<HelixUser[]> {
    const qs = new URLSearchParams();
    for (const id of query.ids ?? []) qs.append("id", id);
    for (const l of query.logins ?? []) qs.append("login", l);
    const q = qs.toString();
    const res = await this.request<{ data: HelixUser[] }>("GET", `/users${q ? `?${q}` : ""}`);
    return res?.data ?? [];
  }

  async createEventSubSubscription(
    type: string,
    version: string,
    condition: Record<string, string>,
    sessionId: string,
  ): Promise<EventSubSubscription> {
    const res = await this.request<{ data: EventSubSubscription[] }>("POST", "/eventsub/subscriptions", {
      type,
      version,
      condition,
      transport: { method: "websocket", session_id: sessionId },
    });
    const sub = res?.data?.[0];
    if (!sub) throw new HelixError(502, "EventSub subscription response had no data");
    return sub;
  }

  async deleteEventSubSubscription(id: string): Promise<void> {
    await this.request<unknown>("DELETE", `/eventsub/subscriptions?id=${encodeURIComponent(id)}`);
  }

  async sendChatMessage(
    broadcasterId: string,
    senderId: string,
    message: string,
    replyParentMessageId?: string,
  ): Promise<SentChatMessage> {
    const body: Record<string, string> = { broadcaster_id: broadcasterId, sender_id: senderId, message };
    if (replyParentMessageId) body.reply_parent_message_id = replyParentMessageId;
    const res = await this.request<{ data: SentChatMessage[] }>("POST", "/chat/messages", body);
    const sent = res?.data?.[0];
    if (!sent) throw new HelixError(502, "Chat message response had no data");
    return sent;
  }
}
