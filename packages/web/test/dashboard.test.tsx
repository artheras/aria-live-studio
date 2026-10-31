import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { Round } from "@aria-live/shared";
import { createApi } from "../src/lib/api";
import { DashboardView } from "../src/dashboard/Dashboard";
import { execution, makeRound, makeState, me, task } from "./fixtures";

const api = createApi(() => me.csrf);

function renderRound(round: Round | null, meOverride = me) {
  return render(<DashboardView state={makeState(round)} live="open" me={meOverride} api={api} />);
}

const button = (name: RegExp) => screen.getByRole("button", { name });

describe("Dashboard phases", () => {
  it("idle → Open round with prompt input", () => {
    renderRound(null);
    expect(button(/open round/i)).toBeTruthy();
    expect(screen.getByPlaceholderText(/boss fight/i)).toBeTruthy();
  });

  it("collecting → Start vote, disabled with hint when there are no ideas", () => {
    renderRound(makeRound("collecting", { ideas: [] }));
    expect((button(/start vote/i) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/waiting for the first/i)).toBeTruthy();
  });

  it("collecting with ideas → Start vote enabled", () => {
    renderRound(makeRound("collecting"));
    expect((button(/start vote/i) as HTMLButtonElement).disabled).toBe(false);
  });

  it("voting → countdown and Close vote", () => {
    renderRound(makeRound("voting"));
    expect(button(/close vote/i)).toBeTruthy();
    expect(screen.getByLabelText(/time left/i).textContent).toMatch(/^0:4\d$/);
  });

  it("decided → Plan with Aria + Reset; no-vote message when there is no winner", () => {
    const { unmount } = renderRound(makeRound("decided"));
    expect(button(/plan with aria/i)).toBeTruthy();
    expect(button(/^reset$/i)).toBeTruthy();
    unmount();
    renderRound(makeRound("decided", { winnerId: null }));
    expect(screen.queryByRole("button", { name: /plan with aria/i })).toBeNull();
    expect(screen.getByText(/no votes were cast/i)).toBeTruthy();
  });

  it("planning → spinner text", () => {
    renderRound(makeRound("planning"));
    expect(screen.getByText(/turning/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /approve/i })).toBeNull();
  });

  it("awaiting_approval → task card with Approve / Reject / Edit / Re-plan", () => {
    renderRound(makeRound("awaiting_approval"));
    expect(button(/^approve$/i)).toBeTruthy();
    expect(button(/^reject$/i)).toBeTruthy();
    expect(button(/^edit$/i)).toBeTruthy();
    expect(button(/re-plan/i)).toBeTruthy();
    expect(screen.getByText("Add a boss rage meter")).toBeTruthy();
    expect(screen.getByText(/AI plan · claude-test/)).toBeTruthy();
    expect(screen.getByText("Fills with damage")).toBeTruthy();
  });

  it("template plans are labelled as such", () => {
    renderRound(makeRound("awaiting_approval", { task: { ...task, source: "template", model: null } }));
    expect(screen.getByText(/template plan — no model configured/i)).toBeTruthy();
  });

  it("approved → Run in isolated workspace and the coding-agent option", () => {
    renderRound(makeRound("awaiting_approval", { task: { ...task, status: "approved" } }));
    expect((button(/run in isolated workspace/i) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText(/waiting for a coding agent/i)).toBeTruthy();
  });

  it("approved but executor unavailable → Run disabled with the reason", () => {
    renderRound(makeRound("awaiting_approval", { task: { ...task, status: "approved" } }), {
      ...me,
      executor: { kind: "aria-code", ok: false, reason: "aria binary not found" },
    });
    expect((button(/run in isolated workspace/i) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/aria binary not found/)).toBeTruthy();
  });

  it("executing → step log + Cancel", () => {
    renderRound(makeRound("executing", { task: { ...task, status: "approved" }, execution }));
    expect(button(/cancel/i)).toBeTruthy();
    expect(screen.getByText("edit src/Boss.tsx")).toBeTruthy();
    expect(screen.getByText(/building in an isolated workspace/i)).toBeTruthy();
  });

  it("executing via MCP → shows the client", () => {
    renderRound(
      makeRound("executing", { task: { ...task, status: "approved" }, execution: { ...execution, executor: "mcp:codex" } }),
    );
    expect(screen.getByText(/running in codex via mcp/i)).toBeTruthy();
    expect(button(/cancel/i)).toBeTruthy();
  });

  it("done → outcome and Next round", () => {
    renderRound(
      makeRound("done", {
        task: { ...task, status: "approved" },
        execution: {
          ...execution,
          status: "succeeded",
          endedAt: Date.now(),
          changedFiles: ["src/Boss.tsx", "src/Meter.tsx"],
          summary: "Added the rage meter",
        },
      }),
    );
    expect(button(/next round/i)).toBeTruthy();
    expect(screen.getByText("Added the rage meter")).toBeTruthy();
    expect(screen.getByText("aria/round-3")).toBeTruthy();
    expect(screen.getByText("src/Meter.tsx")).toBeTruthy();
  });
});

describe("Dashboard actions", () => {
  it("Approve POSTs with the csrf header and never double-submits", async () => {
    let resolve!: (r: Response) => void;
    const fetchMock = vi.fn(() => new Promise<Response>((r) => (resolve = r)));
    vi.stubGlobal("fetch", fetchMock);
    renderRound(makeRound("awaiting_approval"));

    const approve = button(/^approve$/i) as HTMLButtonElement;
    fireEvent.click(approve);
    fireEvent.click(approve);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/task/approve");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("include");
    expect((init.headers as Record<string, string>)["x-aria-csrf"]).toBe("csrf-token-123");
    expect(approve.disabled).toBe(true);

    await act(async () => resolve(new Response("{}", { status: 200 })));
    expect(approve.disabled).toBe(false);
    vi.unstubAllGlobals();
  });

  it("shows the ApiError message as a toast", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "Round is not awaiting approval", code: "wrong_phase" }), { status: 409 })),
    );
    renderRound(makeRound("awaiting_approval"));
    await act(async () => {
      fireEvent.click(button(/^approve$/i));
    });
    expect(await screen.findByText("Round is not awaiting approval")).toBeTruthy();
    vi.unstubAllGlobals();
  });
});
