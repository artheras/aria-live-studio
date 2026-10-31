import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { computeBallot } from "../src/lib/round";
import { Ballot } from "../src/dashboard/IdeasPanel";
import { idea, makeRound } from "./fixtures";

describe("ballot", () => {
  it("computes percentages of all votes cast, in ballot order", () => {
    const round = makeRound("voting", {
      ideas: [idea(1, "a"), idea(2, "b"), idea(3, "c")],
      tallies: [
        { ideaId: "i1", number: 1, votes: 1 },
        { ideaId: "i2", number: 2, votes: 2 },
        { ideaId: "i3", number: 3, votes: 0 },
      ],
    });
    const rows = computeBallot(round);
    expect(rows.map((r) => r.number)).toEqual([1, 2, 3]);
    expect(rows.map((r) => r.percent)).toEqual([33, 67, 0]);
    expect(rows.map((r) => r.share)).toEqual([50, 100, 0]);
    expect(rows[1]!.isLeader).toBe(true);
  });

  it("is 0% everywhere when nobody voted", () => {
    const round = makeRound("voting", { tallies: [] });
    expect(computeBallot(round).every((r) => r.percent === 0 && r.share === 0)).toBe(true);
  });

  it("drops hidden ideas when asked (overlay)", () => {
    const round = makeRound("voting");
    expect(computeBallot(round, false).map((r) => r.idea.id)).toEqual(["i1", "i2"]);
  });

  it("renders bars with counts, % and winner", () => {
    render(<Ballot round={makeRound("decided")} />);
    const pcts = screen.getAllByTestId("ballot-pct").map((e) => e.textContent);
    expect(pcts).toEqual(["25%", "75%", "0%"]);
    expect(screen.getByText("Winner")).toBeTruthy();
    expect(screen.getByText("voters", { exact: false }).textContent).toMatch(/4\s+voters/);
  });
});
