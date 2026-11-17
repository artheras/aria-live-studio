import { useCallback, useEffect, useState } from "react";
import type { LiveState } from "@aria-live/shared";
import { computeBallot } from "../lib/round";
import "../styles/dashboard.css";

interface TwitchExtAuth {
  token: string;
  channelId: string;
  userId: string;
}

declare global {
  interface Window {
    Twitch?: {
      ext?: {
        onAuthorized: (cb: (auth: TwitchExtAuth) => void) => void;
      };
    };
  }
}

/**
 * Twitch Extension Panel UI (/ext): viewers can submit ideas and click to vote
 * using the Twitch Extension JWT without typing chat commands.
 */
export function ExtensionPanel() {
  const [token, setToken] = useState<string | null>(null);
  const [state, setState] = useState<LiveState | null>(null);
  const [ideaText, setIdeaText] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    window.Twitch?.ext?.onAuthorized((auth) => {
      setToken(auth.token);
    });
  }, []);

  const refresh = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch("/api/ext/state", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) setState((await res.json()) as LiveState);
    } catch {
      // Ignore transient network errors while polling.
    }
  }, [token]);

  useEffect(() => {
    if (!token) return;
    void refresh();
    const timer = setInterval(() => void refresh(), 3000);
    return () => clearInterval(timer);
  }, [token, refresh]);

  const submitIdea = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !ideaText.trim()) return;
    setBusy(true);
    setStatus(null);
    try {
      const res = await fetch("/api/ext/idea", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ text: ideaText.trim() }),
      });
      if (res.ok) {
        setIdeaText("");
        setStatus("Idea submitted");
        await refresh();
      } else {
        const err = (await res.json().catch(() => null)) as { error?: string } | null;
        setStatus(err?.error ?? "Unable to submit idea");
      }
    } finally {
      setBusy(false);
    }
  };

  const castVote = async (num: number) => {
    if (!token) return;
    setBusy(true);
    setStatus(null);
    try {
      const res = await fetch("/api/ext/vote", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ number: num }),
      });
      if (res.ok) {
        setStatus(`Voted #${num}`);
        await refresh();
      } else {
        const err = (await res.json().catch(() => null)) as { error?: string } | null;
        setStatus(err?.error ?? "Unable to vote");
      }
    } finally {
      setBusy(false);
    }
  };

  if (!token) {
    return (
      <div className="screen-center">
        <p className="muted">Aria Live Twitch Extension Panel — waiting for Twitch authorization.</p>
      </div>
    );
  }

  const round = state?.round;
  const phase = round?.phase ?? "idle";
  const ballot = round && phase === "voting" ? computeBallot(round, false) : [];

  return (
    <main className="panel" style={{ margin: 12, padding: 14 }}>
      <header className="panel__head">
        <h2>Aria Live</h2>
        <span className="phase-tag">{phase}</span>
      </header>
      <div className="panel__body" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {phase === "collecting" && (
          <form onSubmit={submitIdea} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <input
              value={ideaText}
              onChange={(e) => setIdeaText(e.target.value)}
              placeholder="Propose a feature for this stream"
              maxLength={140}
            />
            <button type="submit" className="btn btn--primary" disabled={busy || !ideaText.trim()}>
              Submit Idea
            </button>
          </form>
        )}
        {phase === "voting" && (
          <ol className="ballot__list">
            {ballot.map((r) => (
              <li key={r.idea.id} className="ballot__row">
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  disabled={busy}
                  onClick={() => void castVote(r.number)}
                >
                  Vote #{r.number}
                </button>
                <span className="ballot__idea">{r.idea.text}</span>
                <span className="ballot__pct num">{r.percent}%</span>
              </li>
            ))}
          </ol>
        )}
        {phase !== "collecting" && phase !== "voting" && (
          <p className="muted">
            {round?.task?.title ? `Current task: ${round.task.title}` : "Waiting for the streamer to open a round."}
          </p>
        )}
        {status && <p className="muted">{status}</p>}
      </div>
    </main>
  );
}
