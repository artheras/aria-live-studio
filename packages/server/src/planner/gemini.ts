/**
 * Plans a task with Google Gemini through the Generative Language REST API.
 *
 * Uses the same prompts and `sanitizePlan` validation as the Anthropic and
 * OpenAI-compatible planners, without adding extra runtime dependencies.
 */
import type { PlanInput, PlannedTask, Planner } from "../contracts.ts";
import { buildUserPrompt, SYSTEM_PROMPT } from "./model.ts";
import { sanitizePlan, TASK_SCHEMA } from "./sanitize.ts";
import { oneLine, truncate } from "./text.ts";

export const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";
const DEFAULT_GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

export interface GeminiPlannerSettings {
  apiKey: string;
  model: string;
  timeoutMs: number;
  baseUrl: string;
}

/** Read Gemini planner settings from the environment; null without a key. */
export function geminiSettings(
  timeoutMs: number,
  env: NodeJS.ProcessEnv = process.env,
): GeminiPlannerSettings | null {
  const apiKey = env.GEMINI_API_KEY?.trim() || env.GOOGLE_API_KEY?.trim();
  if (!apiKey) return null;
  return {
    apiKey,
    model: env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL,
    timeoutMs,
    baseUrl: (env.GEMINI_BASE_URL?.trim() || DEFAULT_GEMINI_BASE_URL).replace(/\/+$/, ""),
  };
}

/** Strip JSON Schema keywords unsupported by Gemini's `responseSchema`. */
function geminiResponseSchema(schema: unknown = TASK_SCHEMA): Record<string, unknown> {
  const drop = new Set(["additionalProperties", "minItems", "maxItems", "minLength", "maxLength"]);
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === "object") {
      return Object.fromEntries(
        Object.entries(node as Record<string, unknown>).filter(([k]) => !drop.has(k)).map(([k, v]) => [k, walk(v)]),
      );
    }
    return node;
  };
  return walk(schema) as Record<string, unknown>;
}

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  modelVersion?: string;
  error?: { code?: number; message?: string; status?: string };
}

export class GeminiPlanner implements Planner {
  readonly name: string;

  constructor(
    private readonly settings: GeminiPlannerSettings,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.name = `gemini:${settings.model}`;
  }

  async plan(input: PlanInput): Promise<PlannedTask> {
    const endpoint = `${this.settings.baseUrl}/models/${encodeURIComponent(this.settings.model)}:generateContent`;
    const signal = AbortSignal.any([input.signal, AbortSignal.timeout(this.settings.timeoutMs)]);

    let res: Response;
    try {
      res = await this.fetchImpl(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": this.settings.apiKey,
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents: [{ role: "user", parts: [{ text: buildUserPrompt(input) }] }],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: geminiResponseSchema(),
          },
        }),
        signal,
      });
    } catch (error) {
      if (input.signal.aborted) throw new Error("Planning was cancelled");
      if (error instanceof Error && error.name === "TimeoutError") throw new Error("Gemini did not answer in time");
      throw new Error(`Cannot reach the Gemini API: ${error instanceof Error ? error.message : String(error)}`);
    }

    if (!res.ok) {
      let detail = res.statusText;
      try {
        const body = (await res.json()) as GeminiResponse;
        if (body.error?.message) detail = body.error.message;
      } catch {
        // Ignore non-JSON error bodies.
      }
      if (res.status === 401 || res.status === 403) {
        throw new Error("Gemini rejected the API key (GEMINI_API_KEY)");
      }
      if (res.status === 404) throw new Error("Unknown Gemini model (GEMINI_MODEL)");
      if (res.status === 429) throw new Error("Gemini rate limit reached; try planning again shortly");
      throw new Error(`Gemini planner request failed: HTTP ${res.status} ${truncate(oneLine(detail), 200)}`);
    }

    const payload = (await res.json()) as GeminiResponse;
    const candidate = payload.candidates?.[0];
    if (candidate?.finishReason === "SAFETY") {
      throw new Error("Gemini declined to plan this idea (safety)");
    }
    if (candidate?.finishReason === "MAX_TOKENS") {
      throw new Error("Gemini's plan was cut off (MAX_TOKENS)");
    }

    const text = (candidate?.content?.parts ?? [])
      .map((part) => part.text ?? "")
      .join("")
      .trim();
    if (!text) throw new Error("Gemini returned an empty plan");

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error("Gemini returned invalid JSON for the plan");
    }

    return sanitizePlan(parsed, payload.modelVersion || this.settings.model);
  }
}
