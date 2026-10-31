/**
 * Runtime configuration, read once from the environment. The npm scripts
 * pass --env-file-if-exists=../../.env so a repo-level .env works.
 * Nothing here throws on missing credentials: an unconfigured Twitch app
 * just means the dashboard shows "not configured".
 */
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type ExecutorKind = "aria-code" | "codex" | "disabled";

export interface Config {
  port: number;
  publicUrl: string;
  webDevUrl: string | undefined;
  twitch: {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    eventsubUrl: string;
    apiBase: string;
    authBase: string;
  };
  dataDir: string;
  sessionSecret: string;
  overlayKey: string;
  /** Bearer token for the coding-agent API (/api/agent/*). */
  agentToken: string;
  projectBrief: string;
  allowedLogins: string[] | undefined;
  planner: {
    apiKey: string | undefined;
    baseUrl: string;
    model: string;
    timeoutMs: number;
  };
  executor: {
    kind: ExecutorKind;
    targetRepo: string | undefined;
    ariaCodeBin: string;
    codexBin: string;
    timeoutSec: number;
    allowTools: string;
  };
}

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

type Env = Record<string, string | undefined>;

function str(env: Env, key: string): string | undefined {
  const v = env[key]?.trim();
  return v ? v : undefined;
}

function int(env: Env, key: string, def: number): number {
  const v = str(env, key);
  if (v === undefined) return def;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : def;
}

function stripSlash(u: string): string {
  return u.replace(/\/+$/, "");
}

interface Secrets {
  sessionSecret?: string;
  overlayKey?: string;
  agentToken?: string;
}

type SecretName = keyof Secrets;
const SECRET_ENV: Record<SecretName, [string, number]> = {
  sessionSecret: ["SESSION_SECRET", 32],
  overlayKey: ["OVERLAY_KEY", 18],
  agentToken: ["AGENT_TOKEN", 32],
};

/** Read dataDir/secrets.json, filling in (and persisting, 0600) any secret not given in env. */
function loadSecrets(dataDir: string, env: Env): Required<Secrets> {
  const names = Object.keys(SECRET_ENV) as SecretName[];
  const out: Secrets = {};
  for (const n of names) {
    const v = str(env, SECRET_ENV[n][0]);
    if (v) out[n] = v;
  }
  if (names.every((n) => out[n])) return out as Required<Secrets>;
  const file = join(dataDir, "secrets.json");
  let stored: Secrets = {};
  if (existsSync(file)) {
    try {
      stored = JSON.parse(readFileSync(file, "utf8")) as Secrets;
    } catch {
      stored = {};
    }
  }
  let dirty = false;
  for (const n of names) {
    if (out[n]) continue;
    if (!stored[n]) {
      stored[n] = randomBytes(SECRET_ENV[n][1]).toString("base64url");
      dirty = true;
    }
    out[n] = stored[n];
  }
  if (dirty) {
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(file, JSON.stringify(stored, null, 2), { mode: 0o600 });
    chmodSync(file, 0o600);
  }
  return out as Required<Secrets>;
}

export function loadConfig(env: Env = process.env): Config {
  const port = int(env, "PORT", 3000);
  const publicUrl = stripSlash(str(env, "PUBLIC_URL") ?? `http://localhost:${port}`);
  const webDevUrl = str(env, "WEB_DEV_URL");
  const dataDir = resolve(str(env, "DATA_DIR") ?? join(REPO_ROOT, "data"));
  const { sessionSecret, overlayKey, agentToken } = loadSecrets(dataDir, env);
  const allowed = str(env, "ALLOWED_LOGINS")
    ?.split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const kindRaw = str(env, "ARIA_LIVE_EXECUTOR");
  const kind: ExecutorKind = kindRaw === "aria-code" || kindRaw === "codex" ? kindRaw : "disabled";

  return {
    port,
    publicUrl,
    webDevUrl: webDevUrl ? stripSlash(webDevUrl) : undefined,
    twitch: {
      clientId: str(env, "TWITCH_CLIENT_ID") ?? "",
      clientSecret: str(env, "TWITCH_CLIENT_SECRET") ?? "",
      redirectUri: str(env, "TWITCH_REDIRECT_URI") ?? `${publicUrl}/auth/twitch/callback`,
      eventsubUrl: str(env, "EVENTSUB_WS_URL") ?? "wss://eventsub.wss.twitch.tv/ws",
      apiBase: stripSlash(str(env, "TWITCH_API_BASE") ?? "https://api.twitch.tv/helix"),
      authBase: stripSlash(str(env, "TWITCH_AUTH_BASE") ?? "https://id.twitch.tv/oauth2"),
    },
    dataDir,
    sessionSecret,
    overlayKey,
    agentToken,
    projectBrief: str(env, "PROJECT_BRIEF") ?? "",
    allowedLogins: allowed && allowed.length ? allowed : undefined,
    planner: {
      apiKey: str(env, "OPENAI_API_KEY"),
      baseUrl: stripSlash(str(env, "OPENAI_BASE_URL") ?? "https://api.openai.com/v1"),
      model: str(env, "ARIA_LIVE_MODEL") ?? "gpt-5-mini",
      timeoutMs: int(env, "PLANNER_TIMEOUT_MS", 45000),
    },
    executor: {
      kind,
      targetRepo: str(env, "TARGET_REPO"),
      ariaCodeBin: str(env, "ARIA_CODE_BIN") ?? "aria-code",
      codexBin: str(env, "CODEX_BIN") ?? "codex",
      timeoutSec: int(env, "EXECUTION_TIMEOUT_SEC", 900),
      allowTools: str(env, "EXECUTOR_ALLOW_TOOLS") ?? "read_file,list_files,search_code,write_file,edit_file",
    },
  };
}

export function twitchConfigured(config: Config): boolean {
  return Boolean(config.twitch.clientId && config.twitch.clientSecret);
}
