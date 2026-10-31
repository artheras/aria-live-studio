/** JSON schema the model must follow, and the validator that never trusts its output. */
import type { PlannedTask } from "../contracts.ts";
import { oneLine, truncate } from "./text.ts";

export const LIMITS = {
  title: 80,
  summary: 300,
  userStory: 400,
  item: 200,
  acceptanceCriteria: { min: 2, max: 6 },
  steps: { min: 2, max: 8 },
  risks: { min: 0, max: 4 },
} as const;

const list = (min: number, max: number, what: string) => ({
  type: "array",
  minItems: min,
  maxItems: max,
  description: `${min}-${max} ${what}, each one sentence of at most ${LIMITS.item} characters.`,
  items: { type: "string" },
});

export const TASK_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "summary", "userStory", "acceptanceCriteria", "steps", "risks", "size"],
  properties: {
    title: { type: "string", description: `Short imperative title, at most ${LIMITS.title} characters.` },
    summary: { type: "string", description: `What will be built, at most ${LIMITS.summary} characters.` },
    userStory: { type: "string", description: "As a <viewer/streamer>, I want … so that …" },
    acceptanceCriteria: list(LIMITS.acceptanceCriteria.min, LIMITS.acceptanceCriteria.max, "testable acceptance criteria"),
    steps: list(LIMITS.steps.min, LIMITS.steps.max, "concrete implementation steps"),
    risks: list(LIMITS.risks.min, LIMITS.risks.max, "risks or open questions"),
    size: { type: "string", enum: ["S", "M", "L"], description: "S < 30 min, M < 1 h, L longer." },
  },
} as const;

export class PlanValidationError extends Error {}

function field(raw: Record<string, unknown>, key: string, max: number): string {
  const text = truncate(oneLine(raw[key]), max);
  if (!text) throw new PlanValidationError(`Model plan is missing "${key}"`);
  return text;
}

function items(raw: Record<string, unknown>, key: string, range: { min: number; max: number }): string[] {
  const value = raw[key];
  const arr = Array.isArray(value) ? value : [];
  const out = arr
    .map((v) => truncate(oneLine(v), LIMITS.item))
    .filter(Boolean)
    .slice(0, range.max);
  if (out.length < range.min) {
    throw new PlanValidationError(`Model plan needs at least ${range.min} "${key}" (got ${out.length})`);
  }
  return out;
}

/** Turn untrusted model output into Task fields, or throw PlanValidationError. */
export function sanitizePlan(raw: unknown, model: string): PlannedTask {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new PlanValidationError("Model plan is not a JSON object");
  }
  const r = raw as Record<string, unknown>;
  const size = typeof r.size === "string" ? r.size.trim().toUpperCase() : "";
  return {
    title: field(r, "title", LIMITS.title),
    summary: field(r, "summary", LIMITS.summary),
    userStory: field(r, "userStory", LIMITS.userStory),
    acceptanceCriteria: items(r, "acceptanceCriteria", LIMITS.acceptanceCriteria),
    steps: items(r, "steps", LIMITS.steps),
    risks: items(r, "risks", LIMITS.risks),
    size: size === "S" || size === "M" || size === "L" ? size : "M",
    source: "model",
    model,
  };
}
