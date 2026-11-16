import { useEffect, useMemo, useRef, useState } from "react";
import type { Eligibility, LiveState, Round } from "@aria-live/shared";
import { COMMANDS } from "@aria-live/shared";
import { executorInfo } from "../lib/agents";
import { ballotNumber, computeBallot, winnerIdea } from "../lib/round";
import { playCue } from "../lib/sound";
import { duration, truncate, useNow } from "../lib/time";
import { useLive } from "../lib/useLive";
import "../styles/overlay.css";

function Ring({ endsAt, totalSec, now }: { endsAt: number; totalSec: number; now: number }) {
  const left = Math.max(0, endsAt - now);
  const frac = totalSec > 0 ? Math.min(1, left / (totalSec * 1000)) : 0;
  const r = 34;
  const c = 2 * Math.PI * r;
  return (
    <div className={`ov-ring ${left < 10_000 ? "is-urgent" : ""}`} aria-hidden="true">
      <svg viewBox="0 0 80 80" width="80" height="80">
        <circle cx="40" cy="40" r={r} className="ov-ring__track" />
        <circle
          cx="40"
          cy="40"
          r={r}
          className="ov-ring__fill"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - frac)}
          transform="rotate(-90 40 40)"
        />
      </svg>
      <span className="ov-ring__text">{Math.ceil(left / 1000)}</span>
    </div>
  );
}

const ONLY: Record<Eligibility, string | null> = {
  everyone: null,
  subscribers: "Subscribers only",
  vip_mod: "VIPs & mods only",
};

function Header({ round, label, only }: { round: Round; label: string; only?: Eligibility }) {
  const badge = only ? ONLY[only] : null;
  const active = round.phase === "planning" || round.phase === "executing";
  return (
    <div className="ov-head">
      <span className="ov-brand">
        <img
          className={`ov-brand__icon ${active ? "is-active" : ""}`}
          src="/aria-glyph-inverse.png"
          width={22}
          height={22}
          alt=""
          aria-hidden="true"
        />
        Aria Live
      </span>
      <span className="ov-sep" />
      <span className="ov-kicker">
        Round {round.index} · {label}
      </span>
      {badge && <span className="ov-badge ov-badge--only">{badge}</span>}
    </div>
  );
}

function OverlayCard({ state, now }: { state: LiveState; now: number }) {
  const round = state.round;
  const phase = round?.phase ?? "idle";
  const prevLeaderRef = useRef<string | null>(null);
  const prevPhaseRef = useRef<string>(phase);
  const [leadChange, setLeadChange] = useState(false);

  const votingLeaderId = useMemo(() => {
    if (!round || phase !== "voting") return null;
    return computeBallot(round, false).find((r) => r.isLeader && r.votes > 0)?.idea.id ?? null;
  }, [round, phase]);

  useEffect(() => {
    if (phase !== "voting") {
      prevLeaderRef.current = null;
      setLeadChange(false);
      return;
    }
    if (votingLeaderId && prevLeaderRef.current && prevLeaderRef.current !== votingLeaderId) {
      setLeadChange(true);
      playCue("lead_change");
      const timer = setTimeout(() => setLeadChange(false), 3500);
      prevLeaderRef.current = votingLeaderId;
      return () => clearTimeout(timer);
    }
    if (votingLeaderId) prevLeaderRef.current = votingLeaderId;
  }, [phase, votingLeaderId]);

  useEffect(() => {
    if (phase === "done" && prevPhaseRef.current !== "done" && round?.execution?.status === "succeeded") {
      playCue("shipped");
    }
    prevPhaseRef.current = phase;
  }, [phase, round?.execution?.status]);

  if (!round || phase === "idle") {
    return (
      <div className="ov-card ov-card--small" data-phase="idle">
        <span className="ov-brand">Aria Live</span>
        <p className="ov-small">
          Type <b>{COMMANDS.idea} &lt;your idea&gt;</b> when a round opens
        </p>
      </div>
    );
  }

  const visible = round.ideas.filter((i) => !i.hidden);

  switch (phase) {
    case "collecting": {
      const last = [...visible].sort((a, b) => b.createdAt - a.createdAt).slice(0, 5);
      return (
        <div className="ov-card" data-phase="collecting">
          <Header round={round} label="Ideas open" only={state.settings.ideaEligibility} />
          <h1 className="ov-title">{round.prompt ? truncate(round.prompt, 70) : "What should we build next?"}</h1>
          {round.modifiers?.length ? (
            <div className="ov-mods">
              {round.modifiers.map((m) => (
                <span key={m} className="ov-mod">
                  // {m}
                </span>
              ))}
            </div>
          ) : null}
          <p className="ov-cta">
            Type <b>{COMMANDS.idea} &lt;your idea&gt;</b> in chat
            {visible.length > 0 && (
              <span className="ov-cta__alt">
                {" "}· <b>{COMMANDS.idea} +&lt;n&gt;</b> to +1
              </span>
            )}
          </p>
          <ul className="ov-ideas">
            {last.map((i) => (
              <li key={i.id} className="ov-idea">
                <span className="ov-num">{i.number}</span>
                <span className="ov-idea__text">{truncate(i.text, 64)}</span>
                {i.boosts ? <span className="ov-badge ov-badge--only">+{i.boosts} boost</span> : null}
                <span className="ov-idea__by">@{i.author.displayName || i.author.login}</span>
              </li>
            ))}
          </ul>
          <p className="ov-counter">
            <b>{visible.length}</b> {visible.length === 1 ? "idea" : "ideas"} so far
          </p>
        </div>
      );
    }
    case "voting": {
      const rows = computeBallot(round, false);
      return (
        <div className={`ov-card ${leadChange ? "ov-card--overtake" : ""}`} data-phase="voting">
          <div className="ov-row">
            <div className="ov-grow">
              <Header round={round} label="Vote now" only={state.settings.voteEligibility} />
              <h1 className="ov-title">
                Type <b>{COMMANDS.vote} &lt;number&gt;</b>
                {leadChange && <span className="ov-lead-change">LEAD CHANGE</span>}
              </h1>
              {round.modifiers?.length ? (
                <div className="ov-mods">
                  {round.modifiers.map((m) => (
                    <span key={m} className="ov-mod">
                      // {m}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
            {round.votingEndsAt && <Ring endsAt={round.votingEndsAt} totalSec={state.settings.voteDurationSec} now={now} />}
          </div>
          <ol className="ov-ballot">
            {rows.map((r) => (
              <li key={r.idea.id} className={`ov-bal ${r.isLeader ? "is-leader" : ""}`}>
                <div className="ov-bal__bar" style={{ transform: `scaleX(${r.share / 100})` }} />
                <span className="ov-num">{r.number}</span>
                <span className="ov-bal__text">{truncate(r.idea.text, 52)}</span>
                {r.idea.boosts ? <span className="ov-badge ov-badge--only">+{r.idea.boosts}</span> : null}
                <span className="ov-bal__pct">{r.percent}%</span>
              </li>
            ))}
          </ol>
          <p className="ov-counter">
            <b>{round.voters}</b> {round.voters === 1 ? "voter" : "voters"}
          </p>
        </div>
      );
    }
    case "decided": {
      const w = winnerIdea(round);
      const votes = w ? (round.tallies.find((t) => t.ideaId === w.id)?.votes ?? 0) : 0;
      if (!w || w.hidden) {
        return (
          <div className="ov-card" data-phase="decided">
            <Header round={round} label="Vote closed" />
            <h1 className="ov-title">No winner this time</h1>
          </div>
        );
      }
      return (
        <div className="ov-card ov-reveal" data-phase="decided">
          <Header round={round} label="Chat has spoken" />
          <p className="ov-kicker ov-kicker--gold">Winner</p>
          <h1 className="ov-title ov-winner">
            <span className="ov-num ov-num--gold">{ballotNumber(round, w.id)}</span> {truncate(w.text, 80)}
          </h1>
          <p className="ov-sub">
            by @{w.author.displayName || w.author.login} · {votes} {votes === 1 ? "vote" : "votes"}
          </p>
        </div>
      );
    }
    case "planning": {
      const w = winnerIdea(round);
      return (
        <div className="ov-card" data-phase="planning">
          <Header round={round} label="Planning" />
          <h1 className="ov-title ov-shimmer">Aria is planning…</h1>
          {w && !w.hidden && <p className="ov-sub">Turning “{truncate(w.text, 70)}” into a task</p>}
        </div>
      );
    }
    case "awaiting_approval":
    case "executing": {
      const task = round.task;
      const ex = round.execution;
      const running = ex && (ex.status === "queued" || ex.status === "running");
      if (running && ex) {
        const info = executorInfo(ex.executor);
        const steps = ex.steps.slice(-4);
        return (
          <div className="ov-card" data-phase="executing">
            <div className="ov-row">
              <Header round={round} label="Building live" />
              <span className={`ov-badge ${info.viaMcp ? "ov-badge--agent" : ""}`}>{info.label}</span>
            </div>
            <h1 className="ov-title">{truncate(task?.title ?? "Building the winning idea", 70)}</h1>
            <ul className="ov-ticker">
              {steps.map((s, i) => (
                <li key={`${s.at}-${i}`} className={`ov-step ov-step--${s.kind} ${s.ok === false ? "is-bad" : ""}`}>
                  {truncate(s.text, 80)}
                </li>
              ))}
            </ul>
            <p className="ov-counter">
              <span className="ov-live-dot" /> {duration(now - ex.startedAt)} elapsed
            </p>
          </div>
        );
      }
      return (
        <div className="ov-card" data-phase="awaiting_approval">
          <Header round={round} label={task?.status === "approved" ? "Approved" : "Plan ready"} />
          <h1 className="ov-title">{truncate(task?.title ?? "Task ready", 70)}</h1>
          <p className="ov-sub">
            {task?.status === "approved" ? "Approved — build starting soon" : "Waiting for streamer approval"}
          </p>
        </div>
      );
    }
    case "done": {
      const ex = round.execution;
      const ok = ex?.status === "succeeded";
      const tone = ok ? "good" : ex?.status === "cancelled" ? "warn" : "bad";
      const text = ok ? "Shipped!" : ex?.status === "cancelled" ? "Build cancelled" : "Build didn't make it";
      const line = ok ? ex?.summary : ex?.error ?? ex?.summary;
      const w = winnerIdea(round);
      const winnerLogin = w?.author.login.toLowerCase();
      const winnerRecord = winnerLogin ? state.coBuilders?.find((b) => b.login === winnerLogin) : undefined;
      const compact = state.settings.overlayDensity === "compact";
      const topBuilders = compact ? [] : state.coBuilders?.slice(0, 3) ?? [];
      return (
        <div className={`ov-card ov-done ov-done--${tone} ${compact ? "ov-card--compact" : ""}`} data-phase="done">
          {!compact && ok && (
            <div className="ov-voxel-burst" aria-hidden="true">
              <span className="ov-voxel ov-voxel--1" />
              <span className="ov-voxel ov-voxel--2" />
              <span className="ov-voxel ov-voxel--3" />
              <span className="ov-voxel ov-voxel--4" />
            </div>
          )}
          <Header round={round} label="Result" />
          <h1 className="ov-title">{text}</h1>
          {round.task && <p className="ov-sub">{truncate(round.task.title, 70)}</p>}
          {w && !w.hidden && (
            <p className="ov-built-for">
              Built for <strong>@{w.author.displayName || w.author.login}</strong>
              {winnerRecord && winnerRecord.shipped > 0 && (
                <span className="ov-shipped-badge">{winnerRecord.shipped}× Shipped</span>
              )}
            </p>
          )}
          {line && <p className="ov-line">{truncate(line, 110)}</p>}
          {ok && ex?.changedFiles.length ? (
            <ul className="ov-files">
              {ex.changedFiles.slice(0, 3).map((f) => (
                <li key={f} className="ov-file">{truncate(f, 44)}</li>
              ))}
            </ul>
          ) : null}
          {!compact && ok && ex?.previewUrl && (
            <div className="ov-preview-wrap">
              <iframe
                className="ov-preview"
                src={ex.previewUrl}
                title="Live build preview"
                sandbox="allow-scripts allow-same-origin"
              />
            </div>
          )}
          {ex && (
            <p className="ov-counter">
              <b>{ex.changedFiles.length}</b> {ex.changedFiles.length === 1 ? "file" : "files"} changed
              {ok && ex.clipUrl && <span className="ov-clip"> · Clip saved</span>}
            </p>
          )}
          {topBuilders.length > 0 && (
            <div className="ov-cobuilders" aria-label="Top co-builders">
              <span className="ov-cobuilders__label">Co-Builders</span>
              {topBuilders.map((b) => (
                <span key={b.login} className="ov-cobuilder">
                  @{b.displayName || b.login} <b>{b.shipped}×</b>
                </span>
              ))}
            </div>
          )}
        </div>
      );
    }
    case "rejected":
      return (
        <div className="ov-card" data-phase="rejected">
          <Header round={round} label="Not this time" />
          <h1 className="ov-title">The streamer passed on this plan</h1>
          <p className="ov-sub">A new round is coming — get your ideas ready</p>
        </div>
      );
  }
}

/** Pure overlay render for a snapshot (tests use this directly). */
export function OverlayView({
  state,
  connected,
  clockOffset = 0,
}: {
  state: LiveState | null;
  connected: boolean;
  clockOffset?: number;
}) {
  const now = useNow(500) + clockOffset;
  if (!state) return null;
  const phase = state.round?.phase ?? "idle";
  const activeCelebration = (state.celebrations ?? [])
    .filter((c) => now - c.at >= 0 && now - c.at < 12_000)
    .at(-1);
  return (
    <div className="ov-stage">
      {activeCelebration && (
        <div className={`ov-celebration ov-celebration--${activeCelebration.kind}`} key={activeCelebration.id}>
          <span className="ov-celebration__tag">{activeCelebration.kind.replace("_", " ")}</span>
          <span className="ov-celebration__text">{truncate(activeCelebration.text, 80)}</span>
        </div>
      )}
      <div className="ov-anchor" key={`${state.round?.id ?? "none"}-${phase}`}>
        <OverlayCard state={state} now={now} />
      </div>
      {!connected && <span className="ov-offline" title="Reconnecting" aria-hidden="true" />}
    </div>
  );
}

export function OverlayPage() {
  const key = useMemo(() => new URLSearchParams(window.location.search).get("key"), []);
  useEffect(() => {
    document.documentElement.classList.add("is-overlay");
    if (!key) console.warn("[aria-overlay] Missing ?key=… — copy the Overlay URL from the dashboard.");
    return () => document.documentElement.classList.remove("is-overlay");
  }, [key]);
  const live = useLive("overlay", {
    key,
    enabled: !!key,
    maxDelayMs: 30_000,
    onNeverConnected: () =>
      console.warn("[aria-overlay] Can't connect — is the server running and the overlay key correct?"),
  });
  if (!key) return null;
  return <OverlayView state={live.state} connected={live.status === "open"} clockOffset={live.clockOffset} />;
}
