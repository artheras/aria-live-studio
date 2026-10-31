/**
 * Fallback planner used when no model API key is configured. It is
 * deterministic and says so everywhere a viewer or the streamer will look,
 * so nobody mistakes it for Aria's own reasoning.
 */
import type { PlanInput, PlannedTask, Planner } from "../contracts.ts";
import { oneLine, truncate } from "./text.ts";

export const TEMPLATE_LABEL = "[Template plan — not AI-generated]";

export class TemplatePlanner implements Planner {
  readonly name = "template";

  async plan(input: PlanInput): Promise<PlannedTask> {
    input.signal.throwIfAborted();
    const idea = oneLine(input.idea.text) || "Untitled idea";
    const short = truncate(idea, 60);
    const title = truncate(idea.charAt(0).toUpperCase() + idea.slice(1), 80);
    return {
      title,
      summary: truncate(`${TEMPLATE_LABEL} Build the community's winning idea #${input.idea.number}: "${idea}".`, 300),
      userStory: truncate(`As a viewer, I want "${short}" so that the stream gets the feature chat voted for.`, 400),
      acceptanceCriteria: [
        `The feature described in "${short}" works in the running app.`,
        "Existing behaviour keeps working (existing tests still pass).",
        "The change is small enough to review on stream.",
      ],
      steps: [
        "Find where in the project this feature belongs.",
        "Implement the smallest version that satisfies the idea.",
        "Add or update a test for the new behaviour.",
        "Run the app and show the result on stream.",
      ],
      risks: [
        "This plan was filled in from a fixed template, not by Aria's model — review and edit it before approving.",
      ],
      size: idea.length > 120 ? "M" : "S",
      source: "template",
      model: null,
    };
  }
}
