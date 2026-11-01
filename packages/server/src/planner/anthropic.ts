/**
 * Plans a task with Claude through the Anthropic Messages API.
 *
 * Same prompts and the same validation as the OpenAI-compatible planner; the
 * answer is constrained to the task JSON schema with structured outputs, and
 * a declined request is re-run server-side on Anthropic's recommended
 * fallback model (`fallbacks: "default"`).
 */
import Anthropic from "@anthropic-ai/sdk";
import type { PlanInput, PlannedTask, Planner } from "../contracts.ts";
import { buildUserPrompt, SYSTEM_PROMPT } from "./model.ts";
import { sanitizePlan, TASK_SCHEMA } from "./sanitize.ts";
import { oneLine, truncate } from "./text.ts";

export const DEFAULT_ANTHROPIC_MODEL = "claude-opus-5-5";
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface AnthropicPlannerSettings {
  apiKey: string;
  model: string;
  /** A short plan for a stream does not need deep reasoning; medium is the model default. */
  effort: Effort;
  timeoutMs: number;
  /** Override for tests or a proxy. */
  baseURL?: string;
}

/** Read the Anthropic planner settings from the environment; null without a key. */
export function anthropicSettings(
  timeoutMs: number,
  env: NodeJS.ProcessEnv = process.env,
): AnthropicPlannerSettings | null {
  const apiKey = env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return null;
  const effort = (env.ANTHROPIC_EFFORT ?? "medium").trim() as Effort;
  return {
    apiKey,
    model: env.ANTHROPIC_MODEL?.trim() || DEFAULT_ANTHROPIC_MODEL,
    effort: ["low", "medium", "high", "xhigh", "max"].includes(effort) ? effort : "medium",
    timeoutMs,
    baseURL: env.ANTHROPIC_BASE_URL?.trim() || undefined,
  };
}

/**
 * The task schema without count and length keywords, which structured outputs
 * do not accept; `sanitizePlan` still enforces every limit afterwards.
 */
export function structuredSchema(schema: unknown = TASK_SCHEMA): Record<string, unknown> {
  const drop = new Set(["minItems", "maxItems", "minLength", "maxLength"]);
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

export class AnthropicPlanner implements Planner {
  readonly name: string;
  private readonly client: Anthropic;

  constructor(
    private readonly settings: AnthropicPlannerSettings,
    client?: Anthropic,
  ) {
    this.name = `anthropic:${settings.model}`;
    this.client =
      client ??
      new Anthropic({ apiKey: settings.apiKey, baseURL: settings.baseURL, maxRetries: 1, timeout: settings.timeoutMs });
  }

  async plan(input: PlanInput): Promise<PlannedTask> {
    let response: Anthropic.Beta.Messages.BetaMessage;
    try {
      response = await this.client.beta.messages.create(
        {
          model: this.settings.model,
          max_tokens: 16000,
          system: SYSTEM_PROMPT,
          messages: [{ role: "user", content: buildUserPrompt(input) }],
          output_config: {
            effort: this.settings.effort,
            format: { type: "json_schema", schema: structuredSchema() },
          },
          betas: [FALLBACK_BETA],
          fallbacks: "default",
        },
        { signal: input.signal, timeout: this.settings.timeoutMs },
      );
    } catch (error) {
      if (input.signal.aborted) throw new Error("Planning was cancelled");
      throw new Error(describeError(error));
    }

    if (response.stop_reason === "refusal") {
      const category = response.stop_details?.category;
      throw new Error(`Claude declined to plan this idea${category ? ` (${category})` : ""}`);
    }
    if (response.stop_reason === "max_tokens") throw new Error("Claude's plan was cut off (max_tokens)");

    const text = response.content
      .filter((block): block is Anthropic.Beta.Messages.BetaTextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error("Claude returned invalid JSON for the plan");
    }
    // The model that actually answered (a fallback may have served the request).
    return sanitizePlan(parsed, response.model);
  }
}

function describeError(error: unknown): string {
  // Most specific first; never echo the request, which carries the key.
  if (error instanceof Anthropic.AuthenticationError) return "Anthropic rejected the API key (ANTHROPIC_API_KEY)";
  if (error instanceof Anthropic.PermissionDeniedError) return "This Anthropic key cannot use the planner model";
  if (error instanceof Anthropic.NotFoundError) return "Unknown Anthropic model (ANTHROPIC_MODEL)";
  if (error instanceof Anthropic.RateLimitError) return "Anthropic rate limit reached; try planning again shortly";
  if (error instanceof Anthropic.APIConnectionTimeoutError) return "Claude did not answer in time";
  if (error instanceof Anthropic.APIConnectionError) return "Cannot reach the Anthropic API";
  if (error instanceof Anthropic.APIError) {
    return `Planner request failed: HTTP ${error.status ?? "?"} ${truncate(oneLine(error.message), 200)}`;
  }
  return error instanceof Error ? error.message : String(error);
}
