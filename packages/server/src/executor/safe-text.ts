/** Makes executor output safe to show on stream: one line, no control chars, no secrets. */
import { oneLine, truncate } from "../planner/text.ts";

export const STEP_MAX = 200;

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/\b(?:sk|pk|rk)-(?:proj-|ant-)?[A-Za-z0-9_-]{8,}/g, "[redacted]"],
  [/\bgh[pousr]_[A-Za-z0-9]{12,}/g, "[redacted]"],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, "[redacted]"],
  [/\bxox[abposr]-[A-Za-z0-9-]{10,}/g, "[redacted]"],
  [/\bAKIA[0-9A-Z]{16}\b/g, "[redacted]"],
  [/\bAIza[0-9A-Za-z_-]{20,}/g, "[redacted]"],
  [/\bya29\.[0-9A-Za-z_-]+/g, "[redacted]"],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+/g, "[redacted]"], // JWT
  [/\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{6,}/gi, "$1 [redacted]"],
  [
    /\b([A-Za-z0-9_]*(?:api[_-]?key|token|secret|password|passwd|client[_-]?secret)[A-Za-z0-9_]*)(["']?\s*[:=]\s*["']?)[^\s"',;]+/gi,
    "$1$2[redacted]",
  ],
];

export function redact(text: string): string {
  let out = text;
  for (const [re, rep] of SECRET_PATTERNS) out = out.replace(re, rep);
  return out;
}

/** Stream-safe single line: ANSI/control chars stripped, secrets redacted, ≤ max chars. */
export function streamSafe(value: unknown, max = STEP_MAX): string {
  // Redact before truncating so a secret cut in half is still caught.
  return truncate(redact(oneLine(typeof value === "string" ? value : value == null ? "" : String(value))), max);
}
