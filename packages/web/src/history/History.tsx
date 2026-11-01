import { useEffect, useState } from "react";
import type { RoundSummary } from "@aria-live/shared";
import { ApiRequestError, createApi, errorMessage } from "../lib/api";
import { dateTime } from "../lib/time";
import { Spinner } from "../dashboard/actions";
import { Logo } from "../dashboard/Header";
import { SizeBadge, SourceBadge } from "../dashboard/TaskCard";

const api = createApi(() => null);

const EXEC_TONE: Record<string, string> = {
  succeeded: "good",
  failed: "bad",
  cancelled: "warn",
  running: "info",
  queued: "info",
};

/** "Aria round 3: build succeeded" → "build succeeded" */
function markerChip(label: string): string {
  return label.replace(/^Aria round \d+:?\s*/, "") || label;
}

/** 3723 → "1:02:03" */
function clock(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const mm = String(m).padStart(h ? 2 : 1, "0");
  return `${h ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
}

export function HistoryCard({ r }: { r: RoundSummary }) {
  return (
    <article className="hcard">
      <header className="hcard__head">
        <span className="hcard__index">Round {r.index}</span>
        <time className="muted">{dateTime(r.openedAt)}</time>
      </header>
      <p className="hcard__prompt">{r.prompt ? `“${r.prompt}”` : <span className="muted">No theme</span>}</p>
      <dl className="hcard__facts">
        <div>
          <dt>Ideas</dt>
          <dd className="num">{r.ideaCount}</dd>
        </div>
        <div>
          <dt>Voters</dt>
          <dd className="num">{r.voters}</dd>
        </div>
      </dl>
      {r.winner ? (
        <div className="hcard__winner">
          <span className="ballot__num">{r.winner.number}</span>
          <div>
            <p>{r.winner.text}</p>
            <p className="muted">
              @{r.winner.author.displayName || r.winner.author.login} · {r.winner.votes} {r.winner.votes === 1 ? "vote" : "votes"}
            </p>
          </div>
        </div>
      ) : (
        <p className="muted">No winner</p>
      )}
      {r.task && (
        <div className="hcard__task">
          <p className="hcard__task-title">{r.task.title}</p>
          <div className="task__badges">
            <SizeBadge size={r.task.size} />
            <SourceBadge task={{ source: r.task.source, model: null }} />
            <span className={`badge badge--status-${r.task.status}`}>{r.task.status[0]!.toUpperCase() + r.task.status.slice(1)}</span>
          </div>
        </div>
      )}
      {r.execution && (
        <div className="hcard__exec">
          <span className={`pill pill--${EXEC_TONE[r.execution.status] ?? "info"}`}>{r.execution.status}</span>
          {r.execution.branch && <code>{r.execution.branch}</code>}
          <span className="muted">{r.execution.changedFiles.length} files</span>
          {r.execution.clipUrl && (
            <a className="chip chip--clip" href={r.execution.clipUrl} target="_blank" rel="noreferrer">
              Clip
            </a>
          )}
          {r.execution.summary && <p className="hcard__summary">{r.execution.summary}</p>}
        </div>
      )}
      {r.markers && r.markers.length > 0 && (
        <div className="hcard__markers" aria-label="Stream markers">
          {r.markers.map((m, i) =>
            m.url ? (
              <a key={i} className="chip" href={m.url} target="_blank" rel="noreferrer" title={m.label}>
                {markerChip(m.label)} · {clock(m.positionSeconds)}
              </a>
            ) : (
              <span key={i} className="chip chip--muted" title={`${m.label} (no VOD found)`}>
                {markerChip(m.label)} · {clock(m.positionSeconds)}
              </span>
            ),
          )}
          {r.vodUrl && (
            <a className="hcard__vod muted" href={r.vodUrl} target="_blank" rel="noreferrer">
              VOD
            </a>
          )}
        </div>
      )}
    </article>
  );
}

export function HistoryPage() {
  const [rounds, setRounds] = useState<RoundSummary[] | null>(null);
  const [error, setError] = useState<{ message: string; auth: boolean } | null>(null);

  useEffect(() => {
    api.history().then(
      (r) => setRounds([...r].sort((a, b) => b.openedAt - a.openedAt)),
      (e) =>
        setError({
          message: errorMessage(e),
          auth: e instanceof ApiRequestError && (e.status === 401 || e.status === 403),
        }),
    );
  }, []);

  return (
    <div className="studio studio--history">
      <header className="topbar">
        <Logo />
        <h1 className="topbar__page">History</h1>
        <nav className="topbar__actions">
          <a className="btn btn--secondary btn--sm" href="/">
            Back to studio
          </a>
        </nav>
      </header>
      <main className="history">
        {error ? (
          <div className="screen-center">
            <p className="callout callout--bad">{error.auth ? "Sign in to see past rounds." : error.message}</p>
            {error.auth && (
              <a className="btn btn--primary" href="/auth/twitch/login">
                Connect Twitch
              </a>
            )}
          </div>
        ) : !rounds ? (
          <div className="screen-center">
            <Spinner />
          </div>
        ) : rounds.length === 0 ? (
          <p className="empty empty--big">No finished rounds yet. Run one and it lands here.</p>
        ) : (
          <div className="history__grid">
            {rounds.map((r) => (
              <HistoryCard key={r.id} r={r} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
