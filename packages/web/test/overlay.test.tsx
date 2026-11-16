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

  it("labels a subscriber-only vote, and shows nothing extra when open to everyone", () => {
    const state = makeState(makeRound("voting"));
    expect(render(<OverlayView state={state} connected />).container.textContent).not.toContain("only");
    state.settings.voteEligibility = "subscribers";
    expect(render(<OverlayView state={state} connected />).container.textContent).toContain("Subscribers only");
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

  it("done renders celebration toast, changed file pills, and live preview iframe", () => {
    const now = Date.now();
    const state = {
      ...makeState(
        makeRound("done", {
          task: { ...task, status: "approved" },
          execution: {
            ...execution,
            status: "succeeded",
            endedAt: now,
            changedFiles: ["src/Boss.tsx", "src/Boss.css"],
            summary: "Added boss bar",
            previewUrl: "http://127.0.0.1:4173/preview",
          },
        }),
      ),
      celebrations: [
        {
          id: "cel-1",
          kind: "channel_points" as const,
          at: now,
          user: { id: "u1", login: "viewerone", displayName: "ViewerOne", role: "viewer" as const },
          text: "Boosted #1 (+2)",
        },
      ],
      coBuilders: [{ login: "viewer2", displayName: "viewer2", shipped: 2 }],
    };

    const { container } = render(<OverlayView state={state} connected />);
    expect(container.textContent).toContain("channel points");
    expect(container.textContent).toContain("Boosted #1 (+2)");
    expect(container.textContent).toContain("Built for @viewer2");
    expect(container.textContent).toContain("2× Shipped");
    expect(container.textContent).toContain("Co-Builders");
    expect(container.textContent).toContain("src/Boss.tsx");
    expect(container.textContent).toContain("src/Boss.css");
    const iframe = container.querySelector("iframe.ov-preview");
    expect(iframe).not.toBeNull();
    expect(iframe?.getAttribute("src")).toBe("http://127.0.0.1:4173/preview");
  });
});
