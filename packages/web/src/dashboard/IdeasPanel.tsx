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

import type { OverlayLayout, OverlayPos, OverlayStageMode } from "../overlay/Overlay";

type MonitorBackdrop = "grid" | "code" | "custom";

function BroadcastMonitor({
  api,
  livePreviewUrl,
  phase = "idle",
  state,
  round,
}: {
  api: AriaApi;
  livePreviewUrl?: string | null;
  phase?: Round["phase"];
  state?: LiveState;
  round?: Round | null;
}) {
  const { toast } = useActions();
  const [url, setUrl] = useState<string | null>(null);
  const [mode, setMode] = useState<OverlayStageMode>("card3d");
  const [layout, setLayout] = useState<OverlayLayout>("standard");
  const [pos, setPos] = useState<OverlayPos>("bl");
  const [backdrop, setBackdrop] = useState<MonitorBackdrop>("code");
  const [customBg, setCustomBg] = useState<string | null>(() => {
    try {
      return window.localStorage.getItem("aria.obs.customBackdrop");
    } catch {
      return null;
    }
  });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [obsMuted, setObsMuted] = useState(false);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [camSafe, setCamSafe] = useState<"off" | "tl" | "tr" | "bl" | "br">("off");
  const popoverRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.38);
  const baseUrl = livePreviewUrl || url;

  const activeUrl = (() => {
    if (!baseUrl) return null;
    if (livePreviewUrl) return baseUrl;
    const params = new URLSearchParams();
    if (pos !== "bl") params.set("pos", pos);
    if (layout !== "standard") params.set("layout", layout);
    if (mode !== "none") params.set("mode", mode);
    if (obsMuted) params.set("mute", "1");
    const qs = params.toString();
    if (!qs) return baseUrl;
    return `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}${qs}`;
  })();
  const iframeSrc = (() => {
    if (!activeUrl) return null;
    if (livePreviewUrl) return activeUrl;
    try {
      const parsed = new URL(activeUrl, window.location.origin);
      return `${parsed.pathname}${parsed.search}`;
    } catch {
      return activeUrl;
    }
  })();

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

  useEffect(() => {
    if (!customizeOpen) return;
    const onMouseDown = (ev: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(ev.target as Node)) {
        setCustomizeOpen(false);
      }
    };
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") setCustomizeOpen(false);
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [customizeOpen]);

  return (
    <div className="monitor-wrap">
      <div className="monitor-bezel">
        <div className="monitor-bezel__bar">
          <span className="monitor-bezel__ch">
            <span className="monitor-bezel__led" aria-hidden="true" />
            {livePreviewUrl ? "Live Build Sandbox" : "1080p Live Source"}
          </span>
          {activeUrl && (
            <div className="monitor-bezel__tools">
              {!livePreviewUrl && (
                <>
                  <div className="monitor-pill-group" role="group" aria-label="Overlay Mode">
                    {(
                      [
                        ["none", "Card"],
                        ["stage", "Corner 3D"],
                        ["card3d", "3D Card"],
                        ["showcase", "Showcase"],
                      ] as const
                    ).map(([v, label]) => (
                      <button
                        key={v}
                        type="button"
                        className={`monitor-pill ${mode === v ? "is-on" : ""}`}
                        onClick={() => setMode(v)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <div className="monitor-popover-anchor" ref={popoverRef}>
                    <button
                      type="button"
                      className={`monitor-pill monitor-pill--trigger ${customizeOpen ? "is-on" : ""}`}
                      aria-expanded={customizeOpen}
                      onClick={() => setCustomizeOpen((o) => !o)}
                    >
                      Customize ▾
                    </button>
                    {customizeOpen && (
                      <div className="monitor-popover" role="dialog" aria-label="Customize OBS Overlay">
                        {mode !== "showcase" && (
                          <>
                            <div className="monitor-popover__row">
                              <span className="monitor-popover__label">Layout</span>
                              <div className="monitor-pill-group">
                                {(
                                  [
                                    ["standard", "Std"],
                                    ["compact", "Cmp"],
                                    ["topbar", "Top"],
                                    ["minimal", "Min"],
                                  ] as const
                                ).map(([v, label]) => (
                                  <button
                                    key={v}
                                    type="button"
                                    className={`monitor-pill ${layout === v ? "is-on" : ""}`}
                                    onClick={() => setLayout(v)}
                                  >
                                    {label}
                                  </button>
                                ))}
                              </div>
                            </div>
                            <div className="monitor-popover__row">
                              <span className="monitor-popover__label">Corner</span>
                              <div className="monitor-pill-group">
                                {(
                                  [
                                    ["bl", "Bottom Left"],
                                    ["br", "Bottom Right"],
                                  ] as const
                                ).map(([v, label]) => (
                                  <button
                                    key={v}
                                    type="button"
                                    className={`monitor-pill ${pos === v ? "is-on" : ""}`}
                                    onClick={() => setPos(v)}
                                  >
                                    {label}
                                  </button>
                                ))}
                              </div>
                            </div>
                            <div className="monitor-popover__row">
                              <span className="monitor-popover__label">Backdrop</span>
                              <div className="monitor-pill-group">
                                {(
                                  [
                                    ["grid", "Grid"],
                                    ["code", "Workspace"],
                                    ["custom", "Custom BG"],
                                  ] as const
                                ).map(([v, label]) => (
                                  <button
                                    key={v}
                                    type="button"
                                    className={`monitor-pill ${backdrop === v ? "is-on" : ""}`}
                                    onClick={() => {
                                      setBackdrop(v);
                                      if (v === "custom" && !customBg) {
                                        fileInputRef.current?.click();
                                      }
                                    }}
                                  >
                                    {label}
                                  </button>
                                ))}
                                {backdrop === "custom" && (
                                  <button
                                    type="button"
                                    className="monitor-pill"
                                    onClick={() => fileInputRef.current?.click()}
                                  >
                                    {customBg ? "Change" : "Upload"}
                                  </button>
                                )}
                              </div>
                            </div>
                          </>
                        )}
                        <div className="monitor-popover__row">
                          <span className="monitor-popover__label">Audio</span>
                          <div className="monitor-pill-group">
                            <button
                              type="button"
                              className={`monitor-pill ${!obsMuted ? "is-on" : ""}`}
                              onClick={() => setObsMuted(false)}
                            >
                              Active
                            </button>
                            <button
                              type="button"
                              className={`monitor-pill ${obsMuted ? "is-on" : ""}`}
                              onClick={() => setObsMuted(true)}
                            >
                              Muted
                            </button>
                          </div>
                        </div>
                        <div className="monitor-popover__row">
                          <span className="monitor-popover__label">Webcam Safe</span>
                          <div className="monitor-pill-group">
                            {(
                              [
                                ["off", "Off"],
                                ["tl", "TL"],
                                ["tr", "TR"],
                                ["bl", "BL"],
                                ["br", "BR"],
                              ] as const
                            ).map(([v, label]) => (
                              <button
                                key={v}
                                type="button"
                                className={`monitor-pill ${camSafe === v ? "is-on" : ""}`}
                                onClick={() => setCamSafe(v)}
                              >
                                {label}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    style={{ display: "none" }}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const reader = new FileReader();
                      reader.onload = () => {
                        if (typeof reader.result === "string") {
                          setCustomBg(reader.result);
                          setBackdrop("custom");
                          try {
                            window.localStorage.setItem("aria.obs.customBackdrop", reader.result);
                          } catch { /* ignore quota */ }
                        }
                      };
                      reader.readAsDataURL(file);
                      e.target.value = "";
                    }}
                  />
                </>
              )}
              <Btn
                size="sm"
                variant="primary"
                onClick={async () => {
                  const ok = await copyText(activeUrl);
                  toast(ok ? "success" : "info", ok ? "OBS URL copied" : "Copy failed");
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
        <div
          className={`idle-preview__stage monitor-stage monitor-stage--${backdrop}`}
          ref={stageRef}
          style={
            backdrop === "custom" && customBg
              ? { backgroundImage: `url(${customBg})`, backgroundSize: "cover", backgroundPosition: "center" }
              : undefined
          }
        >
          {backdrop === "code" && !livePreviewUrl && (
            <div className="monitor-mock-code" aria-hidden="true">
              <div className="mock-code-tab">
                {round?.execution?.changedFiles?.[0] ?? (state?.agentStatus?.name ? `${state.agentStatus.name} · Live Workspace` : "Aria Live Studio · Workspace")}
              </div>
              <div className="mock-code-line">
                <span className="mc-ln">01</span>
                <span className="mc-cm">{`// channel: ${state?.connection.channel?.displayName ?? "offline"} · agent: ${state?.agentStatus?.name ?? "not connected"}`}</span>
              </div>
              <div className="mock-code-line">
                <span className="mc-ln">02</span>
                <span className="mc-kw">phase</span>
                <span>: </span>
                <span className="mc-str">{`'${phase}'`}</span>
                <span>{round?.prompt ? ` · theme: "${round.prompt}"` : ""}</span>
              </div>
              {round?.task && (
                <div className="mock-code-line">
                  <span className="mc-ln">03</span>
                  <span className="mc-ty">task</span>
                  <span>{`: "${round.task.title}"`}</span>
                </div>
              )}
              {(round?.execution?.steps.slice(-3) ?? []).map((step, i) => (
                <div key={step.at + i} className="mock-code-line">
                  <span className="mc-ln">{String(4 + i).padStart(2, "0")}</span>
                  <span className="mc-fn">{step.kind}</span>
                  <span>{` ${step.text}`}</span>
                </div>
              ))}
            </div>
          )}
          {backdrop === "custom" && !customBg && !livePreviewUrl && (
            <div className="monitor-standby">
              <span className="monitor-standby__code">CUSTOM BACKDROP</span>
              <span className="muted">Click Upload to preview over your real IDE or game screenshot</span>
            </div>
          )}
          {camSafe !== "off" && !livePreviewUrl && (
            <div className={`monitor-webcam-safe monitor-webcam-safe--${camSafe}`} aria-hidden="true">
              <span>WEBCAM 16:9 SAFE ZONE</span>
            </div>
          )}
          {iframeSrc ? (
            <iframe
              className="idle-preview__frame"
              src={iframeSrc}
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
  onOpenSettings,
  onOpenAgent,
}: {
  state?: LiveState;
  round: Round | null;
  api: AriaApi;
  maxIdeas: number;
  onOpenSettings?: () => void;
  onOpenAgent?: () => void;
}) {
  const phase = round?.phase ?? "idle";
  const showBallot = round && phase !== "idle" && phase !== "collecting" && round.candidates.length > 0;
  const visible = round?.ideas.filter((i) => !i.hidden).length ?? 0;
  const previewUrl = phase === "done" && round?.execution?.status === "succeeded" ? round.execution.previewUrl : null;
  const [view, setView] = useState<"stage" | "arena" | "overlay" | "build">(() =>
    previewUrl ? "build" : round && phase !== "idle" ? "stage" : state ? "arena" : "overlay",
  );
  const [focusMode, setFocusMode] = useState(false);
  const [onboardingDismissed, setOnboardingDismissed] = useState(() => {
    try {
      return window.localStorage.getItem("aria_onboarding_dismissed") === "1";
    } catch {
      return false;
    }
  });
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
                <LiveStageCanvas state={state} />
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
                      ? "This round has not started"
                      : state.round?.prompt || `${state.coBuilders?.length ?? 0} Co-Builders`}
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
                    Set theme
                  </button>
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
            {!focusMode && state.stats.rounds === 0 && !onboardingDismissed && (
              <div className="onboarding-strip" aria-label="Quick start checklist">
                <span className="onboarding-strip__title">Quick Start</span>
                <span className={`onboarding-step ${state.agentStatus ? "is-done" : ""}`}>
                  1. {state.agentStatus ? "Agent connected" : "Connect agent"}
                  {!state.agentStatus && onOpenAgent && (
                    <button type="button" className="onboarding-link" onClick={onOpenAgent}>
                      Setup
                    </button>
                  )}
                </span>
                <span className="onboarding-step">
                  2. Add OBS Overlay
                  <button type="button" className="onboarding-link" onClick={() => setView("overlay")}>
                    Preview
                  </button>
                </span>
                <span className="onboarding-step">
                  3. Open first round
                </span>
                <button
                  type="button"
                  className="onboarding-dismiss"
                  aria-label="Dismiss quick start"
                  onClick={() => {
                    setOnboardingDismissed(true);
                    try {
                      window.localStorage.setItem("aria_onboarding_dismissed", "1");
                    } catch { /* ignore */ }
                  }}
                >
                  ×
                </button>
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
          <BroadcastMonitor api={api} phase={phase} state={state} round={round} />
        ) : activeView === "build" && previewUrl ? (
          <BroadcastMonitor api={api} livePreviewUrl={previewUrl} />
        ) : (
          <div className="ideas-split">
            {state && (
              <div className="monitor-bezel monitor-bezel--workshop monitor-bezel--compact">
                <div className="idle-preview__stage monitor-stage--compact">
                  <LiveStageCanvas state={state} compact />
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
