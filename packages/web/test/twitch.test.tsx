import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { RoundSummary } from "@aria-live/shared";
import { createApi } from "../src/lib/api";
import { DashboardView } from "../src/dashboard/Dashboard";
import { SettingsForm } from "../src/dashboard/SettingsDrawer";
import { ActionsProvider } from "../src/dashboard/actions";
import { HistoryCard } from "../src/history/History";
import { OverlayView } from "../src/overlay/Overlay";
import { execution, makeRound, makeState, me, task } from "./fixtures";

const api = createApi(() => me.csrf);
const OLD = ["user:read:chat", "user:write:chat"];

function oldTokenState() {
  const state = makeState(null);
  state.connection = { ...state.connection, scopes: OLD, missingScopes: ["channel:manage:broadcast", "clips:edit"] };
  return state;
}

describe("Twitch reconnect banner", () => {
  it("shows a non-blocking banner with a re-consent link when scopes are missing", () => {
    render(<DashboardView state={oldTokenState()} live="open" me={me} api={api} />);
    expect(screen.getByText(/Reconnect Twitch to enable stream title, markers and clips/)).toBeTruthy();
    const link = screen.getByRole("link", { name: "Reconnect Twitch" }) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/auth/twitch/login?force_verify=true");
    // the round controls are still there
    expect(screen.getByRole("button", { name: /open round/i })).toBeTruthy();
  });

  it("is hidden with a full grant or when signed out", () => {
    const { unmount } = render(<DashboardView state={makeState(null)} live="open" me={me} api={api} />);
    expect(screen.queryByText(/Reconnect Twitch to enable/)).toBeNull();
    unmount();
    const st = oldTokenState();
    st.connection.state = "signed_out";
    render(<DashboardView state={st} live="open" me={me} api={api} />);
    expect(screen.queryByText(/Reconnect Twitch to enable/)).toBeNull();
  });
});

describe("Twitch settings", () => {
  const box = (name: RegExp) => screen.getByRole("checkbox", { name }) as HTMLInputElement;

  it("has the three toggles, on by default", () => {
    render(
      <ActionsProvider>
        <SettingsForm settings={makeState(null).settings} me={me} api={api} onDone={() => {}} />
      </ActionsProvider>,
    );
    expect(box(/stream title/i).checked).toBe(true);
    expect(box(/stream markers/i).checked).toBe(true);
    expect(box(/clip successful builds/i).checked).toBe(true);
    expect(box(/clip successful builds/i).disabled).toBe(false);
  });

  it("disables a toggle with a hint when its scope is missing", () => {
    render(
      <ActionsProvider>
        <SettingsForm settings={makeState(null).settings} me={me} api={api} onDone={() => {}} missingScopes={["clips:edit"]} />
      </ActionsProvider>,
    );
    expect(box(/clip successful builds/i).disabled).toBe(true);
    expect(box(/clip successful builds/i).checked).toBe(false);
    expect(box(/stream title/i).disabled).toBe(false);
    expect(screen.getByText(/reconnect Twitch to allow it \(needs clips:edit\)/)).toBeTruthy();
  });
});

describe("clip and markers", () => {
  const done = makeRound("done", {
    task: { ...task, status: "approved" },
    execution: { ...execution, status: "succeeded", endedAt: Date.now(), clipUrl: "https://clips.twitch.tv/Slug1" },
  });

  it("the done panel links the clip", () => {
    render(<DashboardView state={makeState(done)} live="open" me={me} api={api} />);
    const link = screen.getByRole("link", { name: "Watch the clip" }) as HTMLAnchorElement;
    expect(link.href).toBe("https://clips.twitch.tv/Slug1");
  });

  it("the overlay says 'Clip saved' without the URL", () => {
    const { container } = render(<OverlayView state={makeState(done)} connected />);
    expect(container.textContent).toContain("Clip saved");
    expect(container.textContent).not.toContain("clips.twitch.tv");
  });

  it("history shows marker chips linking into the VOD, and the clip", () => {
    const r: RoundSummary = {
      id: "r1",
      index: 4,
      openedAt: 1_000,
      closedAt: 2_000,
      prompt: "",
      ideaCount: 1,
      voters: 1,
      winner: null,
      task: null,
      execution: { status: "succeeded", branch: null, changedFiles: [], summary: null, clipUrl: "https://clips.twitch.tv/Slug1" },
      markers: [
        { label: "Aria round 4 opened", positionSeconds: 3723, createdAt: 1, url: "https://www.twitch.tv/videos/7?t=1h2m3s" },
        { label: "Aria round 4: build succeeded", positionSeconds: 4000, createdAt: 2, url: "https://www.twitch.tv/videos/7?t=1h6m40s" },
      ],
      vodUrl: "https://www.twitch.tv/videos/7",
    };
    render(<HistoryCard r={r} />);
    const chip = screen.getByRole("link", { name: /opened · 1:02:03/ }) as HTMLAnchorElement;
    expect(chip.href).toBe("https://www.twitch.tv/videos/7?t=1h2m3s");
    expect((screen.getByRole("link", { name: /build succeeded · 1:06:40/ }) as HTMLAnchorElement).href).toContain("t=1h6m40s");
    expect((screen.getByRole("link", { name: "Clip" }) as HTMLAnchorElement).href).toBe("https://clips.twitch.tv/Slug1");
  });

  it("history shows markers without links when no VOD was found", () => {
    const r: RoundSummary = {
      id: "r2",
      index: 5,
      openedAt: 1_000,
      closedAt: 2_000,
      prompt: "",
      ideaCount: 0,
      voters: 0,
      winner: null,
      task: null,
      execution: null,
      markers: [{ label: "Aria round 5 opened", positionSeconds: 65, createdAt: 1 }],
    };
    render(<HistoryCard r={r} />);
    expect(screen.getByText("opened · 1:05")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });
});
