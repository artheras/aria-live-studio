import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { OverlayView } from "../src/overlay/Overlay";
import { execution, makeRound, makeState, task } from "./fixtures";

describe("overlay", () => {
  it("never shows hidden ideas or the activity feed (collecting)", () => {
    const { container } = render(<OverlayView state={makeState(makeRound("collecting"))} connected />);
    expect(container.textContent).toContain("Double jump");
    expect(container.textContent).not.toContain("Secret hat");
    expect(container.textContent).not.toContain("SECRET_ACTIVITY_TEXT");
    expect(container.textContent).toContain("2 ideas so far");
  });

  it("never shows hidden ideas on the ballot", () => {
    const { container } = render(<OverlayView state={makeState(makeRound("voting"))} connected />);
    expect(container.textContent).not.toContain("Secret hat");
    expect(container.textContent).toContain("Boss rage meter");
    expect(container.textContent).not.toContain("SECRET_ACTIVITY_TEXT");
  });

  it("announces the winner with the ballot number chat voted with, not the submission number", () => {
    const round = makeRound("decided", {
      candidates: ["i2", "i1"],
      tallies: [
        { ideaId: "i2", number: 1, votes: 3 },
        { ideaId: "i1", number: 2, votes: 1 },
      ],
    });
    const { container } = render(<OverlayView state={makeState(round)} connected />);
    expect(container.querySelector(".ov-num--gold")?.textContent).toBe("1");
  });

  it("renders nothing before the first snapshot", () => {
    const { container } = render(<OverlayView state={null} connected={false} />);
    expect(container.innerHTML).toBe("");
  });

  it("shows only a tiny dot when disconnected", () => {
    const { container } = render(<OverlayView state={makeState(null)} connected={false} />);
    expect(container.querySelector(".ov-offline")).not.toBeNull();
    expect(container.textContent).toMatch(/!idea/);
  });

  it("executing shows the executor label and no workdir", () => {
    const { container } = render(
      <OverlayView
        state={makeState(makeRound("executing", { task: { ...task, status: "approved" }, execution: { ...execution, executor: "mcp:claude-code" } }))}
        connected
      />,
    );
    expect(container.textContent).toContain("Claude Code");
    expect(container.textContent).toContain("edit src/Boss.tsx");
    expect(container.textContent).not.toContain("/tmp/secret/path");
  });
});
