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
  const [mutedLogins, setMutedLogins] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem("aria:muted-logins");
      return raw ? (JSON.parse(raw) as string[]) : [];
    } catch {
      return [];
    }
  });
  const toggleMute = (login: string) => {
    setMutedLogins((prev) => {
      const exists = prev.includes(login);
      const next = exists ? prev.filter((l) => l !== login) : [...prev, login];
      try {
        localStorage.setItem("aria:muted-logins", JSON.stringify(next));
      } catch {
        /* ignore storage errors */
      }
      if (!exists) {
        const toHide = round.ideas.filter((i) => i.author.login === login && !i.hidden);
        if (toHide.length > 0) {
          void run(`mute:${login}`, () => Promise.all(toHide.map((i) => api.hideIdea(i.id, true))));
        }
      }
      return next;
    });
  };
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
            <div className="idea__actions">
              <button
                type="button"
                className="btn btn--ghost btn--sm idea__hide"
                disabled={isPending(key)}
                onClick={() => run(key, () => api.hideIdea(idea.id, !idea.hidden))}
                aria-label={`${idea.hidden ? "Unhide" : "Hide"} idea ${idea.number}`}
              >
                {idea.hidden ? "Unhide" : "Hide"}
              </button>
              <button
                type="button"
                className={`btn btn--ghost btn--sm ${mutedLogins.includes(idea.author.login) ? "is-muted-user" : ""}`}
                onClick={() => toggleMute(idea.author.login)}
                title={`Mute @${idea.author.login} in this browser`}
              >
                {mutedLogins.includes(idea.author.login) ? "Muted" : "Mute"}
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function BroadcastMonitor({ api, livePreviewUrl }: { api: AriaApi; livePreviewUrl?: string | null }) {
  const { toast } = useActions();
  const [url, setUrl] = useState<string | null>(null);
  const [include3dStage, setInclude3dStage] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.38);
  const baseUrl = livePreviewUrl || url;
  const activeUrl =
    baseUrl && !livePreviewUrl && include3dStage
      ? `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}mode=stage`
      : baseUrl;

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
              {!livePreviewUrl && (
                <button
                  type="button"
                  className={`focus-pill ${include3dStage ? "is-on" : ""}`}
                  aria-pressed={include3dStage}
                  onClick={() => setInclude3dStage((v) => !v)}
                >
                  <span>3D Stage</span>
                  <span className="focus-pill__track" aria-hidden="true">
                    <span className="focus-pill__thumb" />
                  </span>
                </button>
              )}
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

type StagePerfMode = "3d" | "eco" | "2d";

function loadStageMode(): StagePerfMode {
  try {
    const v = window.localStorage.getItem("aria_stage_mode");
    if (v === "eco" || v === "2d" || v === "3d") return v;
  } catch { /* ignore */ }
  return "3d";
}

function Stage2DFallback({ state, compact = false }: { state: LiveState; compact?: boolean }) {
  const ideas = (state.round?.ideas.filter((i) => !i.hidden) ?? []).slice(-4);
  return (
    <div className="workshop-scene workshop-scene--2d">
      <img className="workshop-scene__art" src="/art/voxel-workshop.jpg" alt="Voxel Workshop Stage (2D Mode)" />
      {ideas.map((idea, idx) => (
        <div
          key={idea.id}
          className={`workshop-bubble workshop-bubble--flank workshop-bubble--flank-${idx} ${idea.boosts ? "is-boosted" : ""}`}
        >
          <span className="workshop-bubble__user">@{idea.author.displayName || idea.author.login}</span>
          <span className="workshop-bubble__text">{idea.text.length > 22 ? `${idea.text.slice(0, 21)}…` : idea.text}</span>
          {idea.boosts ? <span className="workshop-bubble__boost">+{idea.boosts}</span> : null}
        </div>
      ))}
      <span className="stage-2d-badge">{compact ? "2D Mode" : "2D Mode · Low GPU"}</span>
    </div>
  );
}

export function IdeasPanel({
  state,
  round,
  api,
  maxIdeas,
  onOpenSettings,
}: {
  state?: LiveState;
  round: Round | null;
  api: AriaApi;
  maxIdeas: number;
  onOpenSettings?: () => void;
}) {
  const phase = round?.phase ?? "idle";
  const showBallot = round && phase !== "idle" && phase !== "collecting" && round.candidates.length > 0;
  const visible = round?.ideas.filter((i) => !i.hidden).length ?? 0;
  const previewUrl = phase === "done" && round?.execution?.status === "succeeded" ? round.execution.previewUrl : null;
  const [view, setView] = useState<"stage" | "arena" | "overlay" | "build">(() =>
    previewUrl ? "build" : round && phase !== "idle" ? "stage" : state ? "arena" : "overlay",
  );
  const [focusMode, setFocusMode] = useState(false);
  const [stageMode, setStageMode] = useState<StagePerfMode>(loadStageMode);
  const updateStageMode = (m: StagePerfMode) => {
    setStageMode(m);
    try {
      window.localStorage.setItem("aria_stage_mode", m);
    } catch { /* ignore */ }
  };

  useEffect(() => {
    if (previewUrl) setView("build");
    else if (round && phase !== "idle") setView("stage");
    else if (state) setView("arena");
    else setView("overlay");
  }, [round?.id, phase, previewUrl, Boolean(state)]);

  const activeView = (!round || phase === "idle") && view === "stage" ? (state ? "arena" : "overlay") : view;

  return (
    <section className="panel panel--ideas panel--workshop" aria-labelledby="ideas-h">
      <header className="panel__head">
        <div className="panel__head-left">
          <h2 id="ideas-h">
            {activeView === "arena"
              ? "Workshop Preview"
              : activeView === "overlay"
                ? "OBS Monitor"
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
            <div className="monitor-bezel monitor-bezel--workshop">
              <div className="idle-preview__stage monitor-stage--workshop">
                {stageMode === "2d" ? (
                  <Stage2DFallback state={state} />
                ) : (
                  <LiveStageCanvas state={state} ecoMode={stageMode === "eco"} />
                )}
              </div>
            </div>
            {!focusMode && (
              <div className="workshop-bar">
                <span className="workshop-bar__status">
                  <span className={`workshop-dot ${phase !== "idle" ? "is-live" : ""}`} aria-hidden="true" />
                  {phase === "idle" ? "Round not active" : `${visible} ideas · ${state.stats.votes} votes`}
                </span>
                <span className="workshop-bar__hint">
                  {state.connection.isLive
                    ? `LIVE · ${state.connection.viewerCount ?? 0} viewers`
                    : phase === "idle"
                      ? "Next theme: Boss fight mechanic"
                      : `${state.coBuilders?.length ?? 0} Co-Builders`}
                </span>
                <div className="workshop-bar__actions">
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => {
                      const input = document.getElementById("round-theme-input") as HTMLInputElement | null;
                      if (!input) return;
                      input.focus();
                      input.classList.remove("is-focus-pulse");
                      void input.offsetWidth;
                      input.classList.add("is-focus-pulse");
                      setTimeout(() => input.classList.remove("is-focus-pulse"), 1200);
                    }}
                  >
                    Send Idea
                  </button>
                  <div className="stage-perf-switch" role="group" aria-label="Stage graphics mode">
                    {(["3d", "eco", "2d"] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        className={`stage-perf-btn ${stageMode === m ? "is-active" : ""}`}
                        aria-pressed={stageMode === m}
                        title={
                          m === "3d"
                            ? "Full 3D with bloom & shadows"
                            : m === "eco"
                              ? "Eco 3D (no bloom or shadows)"
                              : "Pure 2D fallback (0% WebGL/GPU)"
                        }
                        onClick={() => updateStageMode(m)}
                      >
                        {m.toUpperCase()}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    className={`focus-pill ${focusMode ? "is-on" : ""}`}
                    aria-pressed={focusMode}
                    onClick={() => setFocusMode((f) => !f)}
                  >
                    <span>Focus Mode</span>
                    <span className="focus-pill__track" aria-hidden="true">
                      <span className="focus-pill__thumb" />
                    </span>
                  </button>
                  {onOpenSettings && (
                    <Btn size="sm" variant="ghost" onClick={onOpenSettings}>
                      Manage Settings
                    </Btn>
                  )}
                </div>
              </div>
            )}
            {focusMode && (
              <div className="workshop-bar">
                <span className="workshop-bar__status">Focus Mode active</span>
                <button
                  type="button"
                  className="monitor-hint monitor-hint--btn is-active"
                  onClick={() => setFocusMode(false)}
                >
                  Exit Focus
                </button>
              </div>
            )}
          </div>
        ) : activeView === "overlay" ? (
          <BroadcastMonitor api={api} />
        ) : activeView === "build" && previewUrl ? (
          <BroadcastMonitor api={api} livePreviewUrl={previewUrl} />
        ) : (
          <div className="ideas-split">
            {state && (
              <div className="monitor-bezel monitor-bezel--workshop monitor-bezel--compact">
                <div className="idle-preview__stage monitor-stage--compact">
                  {stageMode === "2d" ? (
                    <Stage2DFallback state={state} compact />
                  ) : (
                    <LiveStageCanvas state={state} ecoMode={stageMode === "eco"} compact />
                  )}
                </div>
              </div>
            )}
            {showBallot ? <Ballot round={round!} /> : <IdeaList round={round!} api={api} />}
          </div>
        )}
      </div>
    </section>
  );
}
