import { useEffect, useRef, useState } from "react";
import type { Eligibility, Execution, Round, Settings } from "@aria-live/shared";
import type { AriaApi, Me } from "../lib/api";
import { ApiRequestError } from "../lib/api";
import { PHASE_LABEL, STEPS, ballotNumber, isExecutionActive, stepIndex, totalVotes, winnerIdea } from "../lib/round";
import { clock, duration, useNow } from "../lib/time";
import { executorInfo } from "../lib/agents";
import { Btn, Spinner, useActions } from "./actions";
import { TaskCard, TaskEditor } from "./TaskCard";

const KEY = "round";

export function PhaseStepper({ round }: { round: Round | null }) {
  const current = stepIndex(round);
  const failed =
    round?.phase === "rejected" || (round?.phase === "done" && round.execution?.status !== "succeeded");
  return (
    <ol className="stepper" aria-label="Round progress">
      {STEPS.map((s, i) => {
        const state = i < current ? "done" : i === current ? "current" : "todo";
        return (
          <li
            key={s.key}
            className={`stepper__step is-${state} ${state === "current" && failed ? "is-failed" : ""}`}
            aria-current={state === "current" ? "step" : undefined}
          >
            <span className="stepper__dot">{state === "done" ? "✓" : i + 1}</span>
            <span className="stepper__label">{s.label}</span>
          </li>
        );
      })}
    </ol>
  );
}

function PromptForm({
  label,
  onSubmit,
  pending,
}: {
  label: string;
  onSubmit: (prompt: string) => void;
  pending: boolean;
}) {
  const [prompt, setPrompt] = useState("");
  return (
    <form
      className="prompt-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(prompt.trim());
      }}
    >
      <label className="field field--grow">
        <span>Theme for this round (optional)</span>
        <input
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="e.g. features for the boss fight"
          maxLength={140}
        />
      </label>
      <Btn type="submit" variant="primary" size="lg" pending={pending}>
        {label}
      </Btn>
    </form>
  );
}

function Countdown({ endsAt, totalSec, offset }: { endsAt: number | null; totalSec: number; offset: number }) {
  const now = useNow(250) + offset;
  if (!endsAt) {
    return (
      <div className="countdown countdown--manual">
        <span className="countdown__time">Open</span>
        <span className="muted">No timer — close the vote when chat is ready.</span>
      </div>
    );
  }
  const left = Math.max(0, endsAt - now);
  const pct = totalSec > 0 ? Math.min(100, (left / (totalSec * 1000)) * 100) : 0;
  return (
    <div className={`countdown ${left < 10_000 ? "is-urgent" : ""}`}>
      <span className="countdown__time num" aria-label="Time left">
        {duration(Math.ceil(left / 1000) * 1000)}
      </span>
      <div className="meter" aria-hidden="true">
        <div className="meter__fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="muted">{left === 0 ? "Closing…" : "until the vote closes"}</span>
    </div>
  );
}

function StepLog({ execution }: { execution: Execution }) {
  const ref = useRef<HTMLOListElement>(null);
  const count = execution.steps.length;
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [count]);
  return (
    <ol className="steplog" ref={ref} aria-label="Execution log" aria-live="polite">
      {execution.steps.length === 0 && <li className="steplog__line muted">Waiting for the first step…</li>}
      {execution.steps.map((s, i) => (
        <li key={i} className={`steplog__line steplog__line--${s.kind} ${s.ok === false ? "is-bad" : ""}`}>
          <time className="steplog__at">{clock(s.at)}</time>
          <span className="steplog__kind">{s.kind}</span>
          <span className="steplog__text">{s.text}</span>
        </li>
      ))}
    </ol>
  );
}

const OUTCOME: Record<Execution["status"], { label: string; tone: string }> = {
  queued: { label: "Queued", tone: "info" },
  running: { label: "Running", tone: "info" },
  succeeded: { label: "Succeeded", tone: "good" },
  failed: { label: "Failed", tone: "bad" },
  cancelled: { label: "Cancelled", tone: "warn" },
};

function Outcome({ execution }: { execution: Execution }) {
  const o = OUTCOME[execution.status];
  const took = execution.endedAt ? duration(execution.endedAt - execution.startedAt) : null;
  return (
    <div className={`outcome outcome--${o.tone}`}>
      <div className="outcome__head">
        <span className={`pill pill--${o.tone}`}>{o.label}</span>
        {took && <span className="muted">in {took}</span>}
        <span className="muted">via {executorInfo(execution.executor).label}{executorInfo(execution.executor).viaMcp ? " (MCP)" : ""}</span>
      </div>
      {execution.summary && <p className="outcome__summary">{execution.summary}</p>}
      {execution.error && <p className="outcome__error">{execution.error}</p>}
      <dl className="outcome__facts">
        <div>
          <dt>Branch</dt>
          <dd>{execution.branch ? <code>{execution.branch}</code> : <span className="muted">—</span>}</dd>
        </div>
        <div>
          <dt>Changed files</dt>
          <dd className="num">{execution.changedFiles.length}</dd>
        </div>
        {execution.clipUrl && (
          <div>
            <dt>Clip</dt>
            <dd>
              <a href={execution.clipUrl} target="_blank" rel="noreferrer">
                Watch the clip
              </a>
            </dd>
          </div>
        )}
      </dl>
      {execution.changedFiles.length > 0 && (
        <ul className="files">
          {execution.changedFiles.slice(0, 30).map((f) => (
            <li key={f}>
              <code>{f}</code>
            </li>
          ))}
          {execution.changedFiles.length > 30 && (
            <li className="muted">…and {execution.changedFiles.length - 30} more</li>
          )}
        </ul>
      )}
    </div>
  );
}

const VOTE_BADGE: Record<Exclude<Eligibility, "everyone">, string> = {
  subscribers: "Subscribers vote",
  vip_mod: "VIPs & mods vote",
};
const IDEA_BADGE: Record<Exclude<Eligibility, "everyone">, string> = {
  subscribers: "Subscriber ideas",
  vip_mod: "VIP & mod ideas",
};

/** Eligibility badges and the ineligible-attempt counter for the round header. */
function EligibilityBadges({ round, settings }: { round: Round | null; settings: Settings }) {
  if (!round || (round.phase !== "collecting" && round.phase !== "voting")) return null;
  const idea = round.phase === "collecting" && settings.ideaEligibility !== "everyone" ? IDEA_BADGE[settings.ideaEligibility] : null;
  const vote = settings.voteEligibility !== "everyone" ? VOTE_BADGE[settings.voteEligibility] : null;
  const ineligible = round.ineligible ?? 0;
  if (!idea && !vote && !ineligible) return null;
  return (
    <span className="round-badges">
      {idea && <span className="badge badge--elig">{idea}</span>}
      {vote && <span className="badge badge--elig">{vote}</span>}
      {ineligible > 0 && (
        <span className="muted num" title="!idea / !vote attempts refused by the eligibility settings this round">
          {ineligible} ineligible
        </span>
      )}
    </span>
  );
}

export interface RoundControlProps {
  round: Round | null;
  settings: Settings;
  me: Me;
  api: AriaApi;
  clockOffset: number;
  onConnectAgent?: () => void;
}

export function RoundControl({ round, settings, me, api, clockOffset, onConnectAgent }: RoundControlProps) {
  const { run, isPending } = useActions();
  const pending = isPending(KEY);
  const [editing, setEditing] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const now = useNow(1000) + clockOffset;

  const phase = round?.phase ?? "idle";
  const task = round?.task ?? null;

  // Leave edit/reject modes when the phase or task changes underneath us.
  const taskId = task?.id;
  useEffect(() => {
    setEditing(false);
    setRejecting(false);
    setNote("");
  }, [phase, taskId]);

  const act = (fn: () => Promise<unknown>, success?: string) => run(KEY, fn, { success });

  const openRound = async (prompt: string) => {
    await act(async () => {
      try {
        await api.openRound(prompt || undefined);
      } catch (err) {
        // From done/rejected, the server may want an explicit reset first.
        if (err instanceof ApiRequestError && err.code === "wrong_phase" && phase !== "idle") {
          await api.resetRound();
          await api.openRound(prompt || undefined);
        } else throw err;
      }
    });
  };

  const winner = winnerIdea(round);
  const visibleIdeas = round?.ideas.filter((i) => !i.hidden).length ?? 0;
  const execution = round?.execution ?? null;
  const active = isExecutionActive(round);
  const approvedIdle = task?.status === "approved" && !active && phase !== "done" && phase !== "rejected";
  const executorBlocked = !me.executor.ok
    ? (me.executor.reason ?? `Executor "${me.executor.kind}" is not available`)
    : !settings.executorEnabled
      ? "Execution is disabled in Settings"
      : null;

  let title: string;
  let body: JSX.Element;

  if (!round || phase === "idle") {
    title = "Ready for a new round";
    body = (
      <>
        <p className="lede">Open a round and chat starts submitting ideas with <code>!idea</code>.</p>
        <PromptForm label="Open round" onSubmit={openRound} pending={pending} />
      </>
    );
  } else if (phase === "collecting") {
    title = `Round ${round.index} — collecting ideas`;
    body = (
      <>
        {round.prompt && <p className="round-prompt">“{round.prompt}”</p>}
        <p className="lede">
          <strong className="num">{visibleIdeas}</strong> {visibleIdeas === 1 ? "idea" : "ideas"} so far. Up to{" "}
          {settings.maxCandidates} go on the ballot.
        </p>
        <div className="actions">
          <Btn
            variant="primary"
            size="lg"
            pending={pending}
            disabled={visibleIdeas === 0}
            onClick={() => act(() => api.startVote())}
          >
            Start vote
          </Btn>
          <Btn variant="ghost" disabled={pending} onClick={() => act(() => api.resetRound())}>
            Reset round
          </Btn>
          {visibleIdeas === 0 && <span className="hint">Waiting for the first <code>!idea</code> in chat</span>}
        </div>
      </>
    );
  } else if (phase === "voting") {
    title = `Round ${round.index} — voting`;
    body = (
      <>
        {round.prompt && <p className="round-prompt">“{round.prompt}”</p>}
        <Countdown endsAt={round.votingEndsAt} totalSec={settings.voteDurationSec} offset={clockOffset} />
        <p className="lede">
          <strong className="num">{round.voters}</strong> {round.voters === 1 ? "voter" : "voters"} ·{" "}
          <strong className="num">{totalVotes(round)}</strong> votes. Chat votes with <code>!vote &lt;number&gt;</code>.
        </p>
        <div className="actions">
          <Btn variant="primary" size="lg" pending={pending} onClick={() => act(() => api.closeVote())}>
            Close vote
          </Btn>
        </div>
      </>
    );
  } else if (phase === "decided") {
    title = winner ? "We have a winner" : "Vote closed";
    body = winner ? (
      <>
        <div className="winner">
          <span className="winner__num">#{ballotNumber(round, winner.id)}</span>
          <div>
            <p className="winner__text">{winner.text}</p>
            <p className="muted">
              by @{winner.author.displayName || winner.author.login} ·{" "}
              {round.tallies.find((t) => t.ideaId === winner.id)?.votes ?? 0} votes
            </p>
          </div>
        </div>
        <p className="hint">
          {me.planner.kind === "model"
            ? `Aria will plan it with ${me.planner.model ?? "the configured model"}.`
            : "No model configured — Aria will use the built-in template plan."}
        </p>
        <div className="actions">
          <Btn variant="primary" size="lg" pending={pending} onClick={() => act(() => api.planTask())}>
            Plan with Aria
          </Btn>
          <Btn variant="ghost" disabled={pending} onClick={() => act(() => api.resetRound())}>
            Reset
          </Btn>
        </div>
      </>
    ) : (
      <>
        <p className="lede">No votes were cast, so there is nothing to plan. Reset and try another round.</p>
        <div className="actions">
          <Btn variant="primary" size="lg" pending={pending} onClick={() => act(() => api.resetRound())}>
            Reset
          </Btn>
        </div>
      </>
    );
  } else if (phase === "planning") {
    title = "Aria is planning";
    body = (
      <div className="planning">
        <Spinner />
        <div>
          <p className="lede">
            Turning {winner ? <strong>#{ballotNumber(round, winner.id)} “{winner.text}”</strong> : "the winning idea"} into a task…
          </p>
          <p className="muted">
            {me.planner.kind === "model" ? `Model: ${me.planner.model ?? "configured"}` : "Template planner"}
          </p>
        </div>
        <Btn variant="ghost" size="sm" disabled={pending} onClick={() => act(() => api.resetRound())}>
          Reset
        </Btn>
      </div>
    );
  } else if (active && execution) {
    const ex = executorInfo(execution.executor);
    title = ex.viaMcp ? `Running in ${ex.client} via MCP` : "Building in an isolated workspace";
    body = (
      <>
        <div className="exec-head">
          <span className={`badge ${ex.viaMcp ? "badge--agent" : "badge--ai"}`}>{ex.label}</span>
          <span className="pill pill--info">
            <span className="pulse" /> {OUTCOME[execution.status].label}
          </span>
          <span className="muted num">elapsed {duration(now - execution.startedAt)}</span>
          {execution.branch && (
            <span className="muted">
              on <code>{execution.branch}</code>
            </span>
          )}
          <Btn variant="danger" pending={pending} onClick={() => act(() => api.cancelExecution())} className="push-right">
            Cancel
          </Btn>
        </div>
        <StepLog execution={execution} />
        {task && <TaskCard task={task} compact />}
      </>
    );
  } else if (phase === "awaiting_approval" && task && task.status === "draft") {
    title = "Review Aria's plan";
    body = editing ? (
      <TaskEditor
        task={task}
        pending={pending}
        onCancel={() => setEditing(false)}
        onSave={async (edit) => {
          if (await act(() => api.editTask(edit), "Task updated")) setEditing(false);
        }}
      />
    ) : (
      <>
        <TaskCard task={task} />
        {rejecting ? (
          <form
            className="reject-form"
            onSubmit={async (e) => {
              e.preventDefault();
              await act(() => api.rejectTask(note.trim() || undefined));
            }}
          >
            <label className="field field--grow">
              <span>Why reject? (optional, shown in history)</span>
              <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} autoFocus />
            </label>
            <Btn type="submit" variant="danger" pending={pending}>
              Confirm reject
            </Btn>
            <Btn variant="ghost" disabled={pending} onClick={() => setRejecting(false)}>
              Back
            </Btn>
          </form>
        ) : (
          <div className="actions">
            <Btn variant="success" size="lg" pending={pending} onClick={() => act(() => api.approveTask())}>
              Approve
            </Btn>
            <Btn variant="secondary" disabled={pending} onClick={() => setEditing(true)}>
              Edit
            </Btn>
            <Btn variant="secondary" disabled={pending} onClick={() => act(() => api.planTask())}>
              Re-plan
            </Btn>
            <Btn variant="danger" disabled={pending} onClick={() => setRejecting(true)}>
              Reject
            </Btn>
          </div>
        )}
      </>
    );
  } else if (approvedIdle && task) {
    title = "Approved — ready to build";
    body = (
      <>
        <div className="build-options">
          <div className="build-option">
            <h3 className="build-option__title">Built-in executor</h3>
            <p className="muted">Aria Code works on a fresh branch in an isolated git worktree.</p>
            <Btn
              variant="primary"
              size="lg"
              pending={pending}
              disabled={!!executorBlocked}
              title={executorBlocked ?? undefined}
              onClick={() => act(() => api.startExecution())}
            >
              Run in isolated workspace
            </Btn>
            {executorBlocked && (
              <p className="callout callout--warn" role="note">
                <strong>Can't run yet:</strong> {executorBlocked}
              </p>
            )}
          </div>
          <div className="build-option build-option--agent">
            <h3 className="build-option__title">Your coding agent</h3>
            <p className="waiting">
              <span className="pulse" /> Waiting for a coding agent… (it can claim this task)
            </p>
            <p className="muted">Codex, Claude Code or Aria Code connected via MCP picks it up automatically.</p>
            {onConnectAgent && (
              <Btn variant="ghost" size="sm" onClick={onConnectAgent}>
                Connect a coding agent
              </Btn>
            )}
          </div>
        </div>
        <div className="actions">
          <Btn variant="ghost" size="sm" disabled={pending} onClick={() => act(() => api.resetRound())}>
            Reset round
          </Btn>
        </div>
        <TaskCard task={task} />
      </>
    );
  } else if (phase === "done") {
    title = execution?.status === "succeeded" ? "Shipped!" : "Round finished";
    body = (
      <>
        {execution ? <Outcome execution={execution} /> : <p className="lede">The round is complete.</p>}
        {execution && execution.steps.length > 0 && (
          <details className="details">
            <summary>Execution log ({execution.steps.length} steps)</summary>
            <StepLog execution={execution} />
          </details>
        )}
        {task && <TaskCard task={task} compact />}
        <PromptForm label="Next round" onSubmit={openRound} pending={pending} />
      </>
    );
  } else if (phase === "rejected") {
    title = "Task rejected";
    body = (
      <>
        <p className="lede">
          {task?.note ? (
            <>
              Note: <em>{task.note}</em>
            </>
          ) : (
            "You passed on this plan."
          )}{" "}
          Re-plan the same winner, or move on.
        </p>
        <div className="actions">
          <Btn variant="secondary" pending={pending} onClick={() => act(() => api.planTask())}>
            Re-plan
          </Btn>
        </div>
        {task && <TaskCard task={task} compact />}
        <PromptForm label="Next round" onSubmit={openRound} pending={pending} />
      </>
    );
  } else {
    // awaiting_approval/executing without the data we expect: stay useful.
    title = PHASE_LABEL[phase];
    body = (
      <>
        {task ? <TaskCard task={task} /> : <p className="lede">Waiting for the server…</p>}
        <div className="actions">
          <Btn variant="ghost" disabled={pending} onClick={() => act(() => api.resetRound())}>
            Reset
          </Btn>
        </div>
      </>
    );
  }

  return (
    <section className="panel panel--round" aria-labelledby="round-h">
      <PhaseStepper round={round} />
      <div className="panel__body">
        <div className="round-title">
          <h2 id="round-h">{title}</h2>
          <EligibilityBadges round={round} settings={settings} />
          <span className={`phase-tag phase-tag--${phase}`}>{phase === "awaiting_approval" && task?.status === "approved" ? "Ready to build" : PHASE_LABEL[phase]}</span>
        </div>
        {body}
      </div>
    </section>
  );
}
