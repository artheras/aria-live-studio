import type { Config } from "../config.ts";
import type { Planner } from "../contracts.ts";
import { ModelPlanner } from "./model.ts";
import { TemplatePlanner } from "./template.ts";

export { ModelPlanner, SYSTEM_PROMPT, buildUserPrompt } from "./model.ts";
export { TemplatePlanner, TEMPLATE_LABEL } from "./template.ts";
export { sanitizePlan, PlanValidationError, TASK_SCHEMA } from "./sanitize.ts";

/** Model planner when an API key is configured, the labelled template otherwise. */
export function createPlanner(config: Pick<Config, "planner">): Planner {
  return config.planner.apiKey ? new ModelPlanner(config.planner) : new TemplatePlanner();
}
