/**
 * Minimal OBS WebSocket v5 client (uses `ws` + `node:crypto`) for automatic
 * scene switching on round phase transitions (`voting`, `executing`, `done`, etc.).
 */
import { createHash, randomUUID } from "node:crypto";
import WebSocket from "ws";

export interface ObsConfig {
  url: string;
  password?: string;
  timeoutMs?: number;
}

export interface ObsSceneTestResult {
  ok: boolean;
  scenes: string[];
  currentScene: string | null;
  error?: string;
}

export function computeObsAuth(password: string, salt: string, challenge: string): string {
  const secretHash = createHash("sha256").update(password + salt).digest("base64");
  return createHash("sha256").update(secretHash + challenge).digest("base64");
}

async function withObsSession<T>(
  cfg: ObsConfig,
  fn: (call: (requestType: string, requestData?: Record<string, unknown>) => Promise<Record<string, unknown>>) => Promise<T>,
): Promise<T> {
  const timeoutMs = cfg.timeoutMs ?? 4000;
  return new Promise<T>((resolve, reject) => {
    const ws = new WebSocket(cfg.url);
    const pending = new Map<string, { resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void }>();
    let settled = false;

    const fail = (err: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      for (const p of pending.values()) p.reject(err instanceof Error ? err : new Error(String(err)));
      pending.clear();
      try {
        ws.close();
      } catch {
        // Ignore close errors.
      }
      reject(err instanceof Error ? err : new Error(String(err)));
    };

    const timer = setTimeout(() => fail(new Error("OBS WebSocket timed out")), timeoutMs);

    const call = (requestType: string, requestData?: Record<string, unknown>) =>
      new Promise<Record<string, unknown>>((ok, err) => {
        const requestId = randomUUID();
        pending.set(requestId, { resolve: ok, reject: err });
        ws.send(JSON.stringify({ op: 6, d: { requestType, requestId, requestData } }));
      });

    ws.on("error", (err) => fail(err));
    ws.on("close", (code) => {
      if (!settled) fail(new Error(`OBS WebSocket closed (${code})`));
    });

    ws.on("message", async (raw) => {
      try {
        const msg = JSON.parse(String(raw)) as { op: number; d?: Record<string, unknown> };
        if (msg.op === 0) {
          const auth = msg.d?.authentication as { challenge?: string; salt?: string } | undefined;
          const identifyData: Record<string, unknown> = { rpcVersion: 1 };
          if (auth?.challenge && auth?.salt) {
            if (!cfg.password) {
              return fail(new Error("OBS WebSocket requires a password"));
            }
            identifyData.authentication = computeObsAuth(cfg.password, auth.salt, auth.challenge);
          }
          ws.send(JSON.stringify({ op: 1, d: identifyData }));
        } else if (msg.op === 2) {
          try {
            const out = await fn(call);
            if (!settled) {
              settled = true;
              clearTimeout(timer);
              ws.close();
              resolve(out);
            }
          } catch (err) {
            fail(err);
          }
        } else if (msg.op === 7 && msg.d) {
          const reqId = String(msg.d.requestId ?? "");
          const entry = pending.get(reqId);
          if (!entry) return;
          pending.delete(reqId);
          const status = msg.d.requestStatus as { result?: boolean; comment?: string; code?: number } | undefined;
          if (status && status.result === false) {
            entry.reject(new Error(status.comment || `OBS request failed (${status.code ?? "?"})`));
          } else {
            entry.resolve((msg.d.responseData as Record<string, unknown>) ?? {});
          }
        }
      } catch (err) {
        fail(err);
      }
    });
  });
}

export async function testObsConnection(cfg: ObsConfig): Promise<ObsSceneTestResult> {
  try {
    return await withObsSession(cfg, async (call) => {
      const data = await call("GetSceneList");
      const rawScenes = Array.isArray(data.scenes) ? data.scenes : [];
      const scenes = rawScenes
        .map((s) => (s && typeof s === "object" && typeof (s as { sceneName?: unknown }).sceneName === "string"
          ? (s as { sceneName: string }).sceneName
          : null))
        .filter((s): s is string => Boolean(s));
      const currentScene = typeof data.currentProgramSceneName === "string" ? data.currentProgramSceneName : null;
      return { ok: true, scenes, currentScene };
    });
  } catch (err) {
    return {
      ok: false,
      scenes: [],
      currentScene: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function switchObsScene(cfg: ObsConfig, sceneName: string): Promise<void> {
  const trimmed = sceneName.trim();
  if (!trimmed) return;
  await withObsSession(cfg, async (call) => {
    await call("SetCurrentProgramScene", { sceneName: trimmed });
  });
}
