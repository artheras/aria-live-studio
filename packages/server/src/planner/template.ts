/**
 * Fallback planner used when no model API key is configured. It is
 * deterministic and says so everywhere a viewer or the streamer will look,
 * so nobody mistakes it for Aria's own reasoning.
 */
import type { PlanInput, PlannedTask, Planner } from "../contracts.ts";
import { oneLine, truncate } from "./text.ts";

export const TEMPLATE_LABEL = "[Template plan — not AI-generated]";

function domainPlanDetails(idea: string, short: string): { acceptanceCriteria: string[]; steps: string[] } {
  const lower = idea.toLowerCase();
  if (/\b(boss|dragon|wave|jump|game|player|enemy|combo|hud|physics|collision|spawn)\b/.test(lower)) {
    return {
      acceptanceCriteria: [
        `Gameplay behaviour for "${short}" triggers reliably in the active loop.`,
        "Existing entities, HUD elements, and tests keep passing without regressions.",
        "Visual telegraphing and frame pacing stay smooth on stream.",
      ],
      steps: [
        `Locate the entity or gameplay controller modules relevant to "${short}".`,
        "Implement state transitions, parameters, and visual feedback for the mechanic.",
        "Add unit/simulation tests covering trigger conditions and edge cases.",
        "Run the test suite and verify the live scene behavior.",
      ],
    };
  }
  if (/\b(ui|theme|dark|css|style|layout|card|overlay|animation|modal|button)\b/.test(lower)) {
    return {
      acceptanceCriteria: [
        `UI update "${short}" renders cleanly at 1080p without clipping or overlap.`,
        "Existing styles, contrast, and responsive layouts remain intact.",
        "Interactive states and keyboard/focus behaviour work as expected.",
      ],
      steps: [
        `Identify the React component and stylesheet section for "${short}".`,
        "Implement the layout, tokens, and transition styles cleanly.",
        "Update or add component tests for the updated rendering.",
        "Build the web bundle and verify visually.",
      ],
    };
  }
  if (/\b(chat|command|vote|poll|twitch|hype|point|reward|bot|mod)\b/.test(lower)) {
    return {
      acceptanceCriteria: [
        `Chat or stream integration for "${short}" handles viewer input cleanly.`,
        "Permissions, rate limits, and duplicate guards remain enforced.",
        "Existing round lifecycle and tests keep passing.",
      ],
      steps: [
        `Inspect the command/event handler responsible for "${short}".`,
        "Wire input parsing, validation, and broadcast state updates.",
        "Add unit tests for valid, duplicate, and unauthorized inputs.",
        "Verify end-to-end state updates on the dashboard and overlay.",
      ],
    };
  }
  return {
    acceptanceCriteria: [
      `The feature described in "${short}" works in the running app.`,
      "Existing behaviour keeps working (existing tests still pass).",
      "The change is small enough to review on stream.",
    ],
    steps: [
      `Find where in the project "${short}" belongs.`,
      "Implement the smallest clean version that satisfies the idea.",
      "Add or update a test for the new behaviour.",
      "Run the app and show the result on stream.",
    ],
  };
}

export class TemplatePlanner implements Planner {
  readonly name = "template";

  async plan(input: PlanInput): Promise<PlannedTask> {
    input.signal.throwIfAborted();
    const idea = oneLine(input.idea.text) || "Untitled idea";
    const short = truncate(idea, 60);
    const title = truncate(idea.charAt(0).toUpperCase() + idea.slice(1), 80);
    const details = domainPlanDetails(idea, short);
    return {
      title,
      summary: truncate(`${TEMPLATE_LABEL} Build the idea chat voted for: "${idea}".`, 300),
      userStory: truncate(`As a viewer, I want "${short}" so that the stream gets the feature chat voted for.`, 400),
      acceptanceCriteria: details.acceptanceCriteria,
      steps: details.steps,
      risks: [
        "This plan was filled in from a fixed template, not by Aria's model — review and edit it before approving.",
      ],
      size: idea.length > 120 ? "M" : "S",
      source: "template",
      model: null,
    };
  }
}
