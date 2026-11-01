import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { AriaApi } from "../src/lib/api";
import { AgentPanel } from "../src/dashboard/AgentPanel";
import { ActionsProvider } from "../src/dashboard/actions";

const conn = {
  token: "tok-1234567890",
  mcpUrl: "https://live.example",
  remote: {
    agentUrl: "https://live.example/mcp",
    cohostUrl: "https://live.example/mcp/cohost/COHOSTKEY12345",
    streamerUrl: "https://live.example/mcp/streamer/STREAMERKEY6789",
  },
};

describe("AgentPanel remote tab", () => {
  it("shows masked co-host and streamer URLs with their roles", async () => {
    const api = { agentConnection: async () => conn } as unknown as AriaApi;
    render(
      <ActionsProvider>
        <AgentPanel api={api} />
      </ActionsProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: /remote \(url\)/i }));
    const body = document.body.textContent ?? "";
    expect(body).toMatch(/Co-host/);
    expect(body).toMatch(/Streamer/);
    expect(body).toMatch(/never approve, reject, run or cancel/);
    expect(body).not.toContain("STREAMERKEY6789");
    expect(body).not.toContain("COHOSTKEY12345");
    expect(body).toMatch(/\/mcp\/streamer\/STRE•+89/);
    fireEvent.click(screen.getByLabelText(/reveal token/i));
    expect(document.body.textContent).toContain(conn.remote.streamerUrl);
  });
});
