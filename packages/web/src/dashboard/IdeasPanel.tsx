import { useEffect, useRef, useState } from "react";
import type { LiveState, Round } from "@aria-live/shared";
import type { AriaApi } from "../lib/api";
import { computeBallot, totalVotes } from "../lib/round";
import { Btn, useActions } from "./actions";
import { copyText } from "./Drawer";
import { LiveStageCanvas } from "./LiveStageCanvas";

export function Ballot({ round }: { round: Round }) {
  const rows = computeBallot(round, true);
  const votes = totalVotes(round);
  const decided = round.phase !== "voting";
  return (
    <div className="ballot">
      <ol className="ballot__list">
        {rows.map((r) => (
          <li
            key={r.idea.id}
            className={`ballot__row ${r.isWinner ? "is-winner" : ""} ${!decided && r.isLeader ? "is-leader" : ""} ${r.idea.hidden ? "is-hidden" : ""}`}
            data-testid="ballot-row"
          >
            <div className="ballot__bar" style={{ width: `${r.share}%` }} aria-hidden="true" />
            <span className="ballot__num">{r.number}</span>
            <div className="ballot__text">
              <span className="ballot__idea">{r.idea.text}</span>
              <span className="ballot__author">
                {r.idea.author.avatarUrl && (
                  <img className="idea__avatar" src={r.idea.author.avatarUrl} width={16} height={16} alt="" />
                )}
                @{r.idea.author.displayName || r.idea.author.login}
                {r.idea.boosts ? <span className="plus">+{r.idea.boosts} boost</span> : null}
              </span>
            </div>
            <div className="ballot__score">
              <span className="ballot__pct" data-testid="ballot-pct">
                {r.percent}%
              </span>
              <span className="ballot__votes">
                {r.votes} {r.votes === 1 ? "vote" : "votes"}
              </span>
            </div>
            {r.isWinner && <span className="ballot__crown">Winner</span>}
          </li>
        ))}
      </ol>
      {rows.length === 0 && <p className="empty">No candidates on the ballot.</p>}
      <footer className="ballot__foot">
        <span>
          <strong className="num">{round.voters}</strong> {round.voters === 1 ? "voter" : "voters"}
        </span>
        <span>
          <strong className="num">{votes}</strong> {votes === 1 ? "vote" : "votes"} counted
        </span>
      </footer>
    </div>
  );
}

function IdeaList({ round, api }: { round: Round; api: AriaApi }) {
  const { run, isPending } = useActions();
  const ideas = [...round.ideas].sort((a, b) => b.number - a.number);
  if (!ideas.length) {
    return (
      <div className="empty empty--big">
        <p>No ideas yet.</p>
        <p className="muted">
          Chat types <code>!idea your idea</code> to submit.
        </p>
      </div>
    );
  }
  return (
    <ul className="ideas">
      {ideas.map((idea) => {
        const key = `hide:${idea.id}`;
        return (
          <li key={idea.id} className={`idea ${idea.hidden ? "is-hidden" : ""}`}>
            <span className="idea__num">{idea.number}</span>
            <div className="idea__body">
              <p className="idea__text">{idea.text}</p>
              <p className="idea__meta">
                {idea.author.avatarUrl && (
                  <img className="idea__avatar" src={idea.author.avatarUrl} width={16} height={16} alt="" />
                )}
                @{idea.author.displayName || idea.author.login}
                {idea.seconds > 0 && <span className="plus">+{idea.seconds}</span>}
                {idea.boosts ? <span className="plus">+{idea.boosts} boost</span> : null}
                {idea.hidden && <span className="tag">Hidden</span>}
              </p>
            </div>
            <button
              type="button"
              className="btn btn--ghost btn--sm idea__hide"
              disabled={isPending(key)}
              onClick={() => run(key, () => api.hideIdea(idea.id, !idea.hidden))}
              aria-label={`${idea.hidden ? "Unhide" : "Hide"} idea ${idea.number}`}
            >
              {idea.hidden ? "Unhide" : "Hide"}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function BroadcastMonitor({ api, livePreviewUrl }: { api: AriaApi; livePreviewUrl?: string | null }) {
  const { toast } = useActions();
  const [url, setUrl] = useState<string | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.38);
  const activeUrl = livePreviewUrl || url;

  useEffect(() => {
    let active = true;
    if (livePreviewUrl || typeof api.overlayUrl !== "function") return;
    api
      .overlayUrl()
      .then((u) => {
        if (active) setUrl(u);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [api, livePreviewUrl]);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const update = () => {
      if (el.clientWidth > 0) setScale(el.clientWidth / 1280);
    };
    update();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [activeUrl]);

  return (
    <div className="monitor-wrap">
      <div className="monitor-bezel">
        <div className="monitor-bezel__bar">
          <span className="monitor-bezel__ch">
            <span className="monitor-bezel__led" aria-hidden="true" />
            {livePreviewUrl ? "CH-02 // LIVE BUILD SANDBOX" : "CH-01 // OBS OVERLAY 1280×720"}
          </span>
          {activeUrl && (
            <div className="monitor-bezel__tools">
              <Btn
                size="sm"
                variant="ghost"
                onClick={async () => {
                  const ok = await copyText(activeUrl);
                  toast(ok ? "success" : "info", ok ? "URL copied" : "Copy failed");
                }}
              >
                Copy URL
              </Btn>
              <a className="btn btn--secondary btn--sm" href={activeUrl} target="_blank" rel="noreferrer">
                Pop out
              </a>
            </div>
          )}
        </div>
        <div className="idle-preview__stage monitor-stage" ref={stageRef}>
          <span className="reticle reticle--tl" aria-hidden="true" />
          <span className="reticle reticle--tr" aria-hidden="true" />
          <span className="reticle reticle--bl" aria-hidden="true" />
          <span className="reticle reticle--br" aria-hidden="true" />
          {activeUrl ? (
            <iframe
              className="idle-preview__frame"
              src={activeUrl}
              title={livePreviewUrl ? "Live build sandbox" : "Live OBS Overlay monitor"}
              sandbox={livePreviewUrl ? "allow-scripts allow-same-origin" : undefined}
              style={{ transform: `scale(${scale})` }}
            />
          ) : (
            <div className="monitor-standby">
              <span className="monitor-standby__code">STANDBY</span>
              <span className="muted">Waiting for overlay endpoint</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function IdeasPanel({
  state,
  round,
  api,
  maxIdeas,
}: {
  state?: LiveState;
  round: Round | null;
  api: AriaApi;
  maxIdeas: number;
}) {
  const phase = round?.phase ?? "idle";
  const showBallot = round && phase !== "idle" && phase !== "collecting" && round.candidates.length > 0;
  const visible = round?.ideas.filter((i) => !i.hidden).length ?? 0;
  const previewUrl = phase === "done" && round?.execution?.status === "succeeded" ? round.execution.previewUrl : null;
  const [view, setView] = useState<"stage" | "arena" | "overlay" | "build">(() =>
    previewUrl ? "build" : round && phase !== "idle" ? "stage" : state ? "arena" : "overlay",
  );

  useEffect(() => {
    if (previewUrl) setView("build");
    else if (round && phase !== "idle") setView("stage");
    else if (state) setView("arena");
    else setView("overlay");
  }, [round?.id, phase, previewUrl, Boolean(state)]);

  const activeView = (!round || phase === "idle") && view === "stage" ? (state ? "arena" : "overlay") : view;

  return (
    <section className="panel panel--ideas" aria-labelledby="ideas-h">
      <header className="panel__head">
        <div className="panel__head-left">
          <h2 id="ideas-h">
            {activeView === "arena"
              ? "Interactive Stage"
              : activeView === "overlay"
                ? "Broadcast Monitor"
                : activeView === "build"
                  ? "Live Build"
                  : showBallot
                    ? "Ballot"
                    : "Ideas"}
          </h2>
          {activeView === "stage" && round && !showBallot && (
            <span className="panel__count num">
              {visible}/{maxIdeas}
            </span>
          )}
          {activeView === "stage" && showBallot && phase === "voting" && <span className="live-tag">Live</span>}
        </div>
        <div className="monitor-tabs" role="tablist" aria-label="Stage view">
          {round && phase !== "idle" && (
            <button
              type="button"
              role="tab"
              aria-selected={activeView === "stage"}
              className={`monitor-tab ${activeView === "stage" ? "is-active" : ""}`}
              onClick={() => setView("stage")}
            >
              {showBallot ? "Ballot" : "Ideas"}
            </button>
          )}
          {state && (
            <button
              type="button"
              role="tab"
              aria-selected={activeView === "arena"}
              className={`monitor-tab ${activeView === "arena" ? "is-active" : ""}`}
              onClick={() => setView("arena")}
            >
              Stage
            </button>
          )}
          {previewUrl && (
            <button
              type="button"
              role="tab"
              aria-selected={activeView === "build"}
              className={`monitor-tab ${activeView === "build" ? "is-active" : ""}`}
              onClick={() => setView("build")}
            >
              Build
            </button>
          )}
          <button
            type="button"
            role="tab"
            aria-selected={activeView === "overlay"}
            className={`monitor-tab ${activeView === "overlay" ? "is-active" : ""}`}
            onClick={() => setView("overlay")}
          >
            OBS
          </button>
        </div>
      </header>
      <div className="panel__body panel__body--scroll">
        {activeView === "arena" && state ? (
          <div className="monitor-wrap">
            <div className="monitor-bezel">
              <div className="monitor-bezel__bar">
                <span className="monitor-bezel__ch">
                  <span className="monitor-bezel__led" aria-hidden="true" />
                  CH-02 // LIVE INTERACTIVE STAGE
                </span>
                <span className="muted num">Click arena to fire · Twitch events trigger waves</span>
              </div>
              <div className="idle-preview__stage monitor-stage">
                <span className="reticle reticle--tl" aria-hidden="true" />
                <span className="reticle reticle--tr" aria-hidden="true" />
                <span className="reticle reticle--bl" aria-hidden="true" />
                <span className="reticle reticle--br" aria-hidden="true" />
                <LiveStageCanvas state={state} />
              </div>
            </div>
          </div>
        ) : activeView === "overlay" ? (
          <BroadcastMonitor api={api} />
        ) : activeView === "build" && previewUrl ? (
          <BroadcastMonitor api={api} livePreviewUrl={previewUrl} />
        ) : showBallot ? (
          <Ballot round={round} />
        ) : (
          <IdeaList round={round!} api={api} />
        )}
      </div>
    </section>
  );
}
