import type { Config } from "../config.ts";
import type { Planner } from "../contracts.ts";
import { AnthropicPlanner, anthropicSettings } from "./anthropic.ts";
import { ModelPlanner } from "./model.ts";
import { TemplatePlanner } from "./template.ts";

export { ModelPlanner, SYSTEM_PROMPT, buildUserPrompt } from "./model.ts";
export { AnthropicPlanner, anthropicSettings, DEFAULT_ANTHROPIC_MODEL } from "./anthropic.ts";
export { TemplatePlanner, TEMPLATE_LABEL } from "./template.ts";
export { sanitizePlan, PlanValidationError, TASK_SCHEMA } from "./sanitize.ts";

export type PlannerKind = "anthropic" | "openai" | "template";

export interface PlannerChoice {
  kind: PlannerKind;
  /** What the dashboard shows: "model" for an AI planner, "template" otherwise. */
  label: "model" | "template";
  model: string | null;
}

/**
 * Which planner runs. ARIA_LIVE_PLANNER (anthropic | openai | template) picks
 * explicitly; otherwise Claude when ANTHROPIC_API_KEY is set, then an
 * OpenAI-compatible model when OPENAI_API_KEY is set, then the labelled template.
 */
export function choosePlanner(config: Pick<Config, "planner">, env: NodeJS.ProcessEnv = process.env): PlannerChoice {
  const wanted = env.ARIA_LIVE_PLANNER?.trim().toLowerCase();
  const claude = anthropicSettings(config.planner.timeoutMs, env);
  const openai = Boolean(config.planner.apiKey);
  const pick = (kind: PlannerKind): PlannerChoice =>
    kind === "anthropic" && claude
      ? { kind, label: "model", model: claude.model }
      : kind === "openai" && openai
        ? { kind, label: "model", model: config.planner.model }
        : { kind: "template", label: "template", model: null };
  if (wanted === "anthropic" || wanted === "openai" || wanted === "template") return pick(wanted);
  return pick(claude ? "anthropic" : openai ? "openai" : "template");
}

export function createPlanner(config: Pick<Config, "planner">, env: NodeJS.ProcessEnv = process.env): Planner {
  const choice = choosePlanner(config, env);
  if (choice.kind === "anthropic") return new AnthropicPlanner(anthropicSettings(config.planner.timeoutMs, env)!);
  if (choice.kind === "openai") return new ModelPlanner(config.planner);
  return new TemplatePlanner();
}
