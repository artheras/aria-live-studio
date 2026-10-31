import { useState } from "react";
import type { Task } from "@aria-live/shared";
import type { TaskEdit } from "../lib/api";
import { Btn } from "./actions";

const SIZE_HINT: Record<Task["size"], string> = {
  S: "Small — fits in a few minutes",
  M: "Medium — a solid chunk of stream",
  L: "Large — may not fit this stream",
};

const STATUS_LABEL: Record<Task["status"], string> = {
  draft: "Draft",
  approved: "Approved",
  rejected: "Rejected",
};

export function SourceBadge({ task }: { task: Pick<Task, "source" | "model"> }) {
  return task.source === "model" ? (
    <span className="badge badge--ai" title="Planned by a language model">
      AI plan · {task.model ?? "model"}
    </span>
  ) : (
    <span className="badge badge--template" title="No model configured; built-in template used">
      Template plan — no model configured
    </span>
  );
}

export function SizeBadge({ size }: { size: Task["size"] }) {
  return (
    <span className={`badge badge--size badge--size-${size}`} title={SIZE_HINT[size]}>
      Size {size}
    </span>
  );
}

export function TaskCard({ task, compact }: { task: Task; compact?: boolean }) {
  return (
    <article className={`task ${compact ? "task--compact" : ""}`} aria-label="Task">
      <header className="task__head">
        <h3 className="task__title">{task.title}</h3>
        <div className="task__badges">
          <SizeBadge size={task.size} />
          <SourceBadge task={task} />
          <span className={`badge badge--status-${task.status}`}>{STATUS_LABEL[task.status]}</span>
        </div>
      </header>
      {task.summary && <p className="task__summary">{task.summary}</p>}
      {!compact && task.userStory && (
        <blockquote className="task__story">
          <span className="task__label">User story</span>
          {task.userStory}
        </blockquote>
      )}
      {!compact && (
        <div className="task__cols">
          {task.acceptanceCriteria.length > 0 && (
            <section>
              <h4 className="task__label">Acceptance criteria</h4>
              <ul className="checklist">
                {task.acceptanceCriteria.map((c, i) => (
                  <li key={i}>
                    <span className="checklist__box" aria-hidden="true" />
                    {c}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {task.steps.length > 0 && (
            <section>
              <h4 className="task__label">Steps</h4>
              <ol className="steps">
                {task.steps.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ol>
            </section>
          )}
        </div>
      )}
      {!compact && task.risks.length > 0 && (
        <section className="task__risks">
          <h4 className="task__label">Risks</h4>
          <ul>
            {task.risks.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </section>
      )}
      {task.note && (
        <p className="task__note">
          <span className="task__label">Streamer note</span> {task.note}
        </p>
      )}
    </article>
  );
}

const lines = (s: string) =>
  s
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

export function TaskEditor({
  task,
  pending,
  onSave,
  onCancel,
}: {
  task: Task;
  pending: boolean;
  onSave: (edit: TaskEdit) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(task.title);
  const [summary, setSummary] = useState(task.summary);
  const [userStory, setUserStory] = useState(task.userStory);
  const [criteria, setCriteria] = useState(task.acceptanceCriteria.join("\n"));
  const [steps, setSteps] = useState(task.steps.join("\n"));
  const [risks, setRisks] = useState(task.risks.join("\n"));
  const [size, setSize] = useState<Task["size"]>(task.size);

  const submit = () => {
    if (!title.trim()) return;
    onSave({
      title: title.trim(),
      summary: summary.trim(),
      userStory: userStory.trim(),
      acceptanceCriteria: lines(criteria),
      steps: lines(steps),
      risks: lines(risks),
      size,
    });
  };

  return (
    <form
      className="task task--edit"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="field-row">
        <label className="field field--grow">
          <span>Title</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} required autoFocus />
        </label>
        <label className="field">
          <span>Size</span>
          <select value={size} onChange={(e) => setSize(e.target.value as Task["size"])}>
            <option value="S">S</option>
            <option value="M">M</option>
            <option value="L">L</option>
          </select>
        </label>
      </div>
      <label className="field">
        <span>Summary</span>
        <textarea rows={2} value={summary} onChange={(e) => setSummary(e.target.value)} />
      </label>
      <label className="field">
        <span>User story</span>
        <textarea rows={2} value={userStory} onChange={(e) => setUserStory(e.target.value)} />
      </label>
      <div className="field-row">
        <label className="field field--grow">
          <span>Acceptance criteria (one per line)</span>
          <textarea rows={4} value={criteria} onChange={(e) => setCriteria(e.target.value)} />
        </label>
        <label className="field field--grow">
          <span>Steps (one per line)</span>
          <textarea rows={4} value={steps} onChange={(e) => setSteps(e.target.value)} />
        </label>
      </div>
      <label className="field">
        <span>Risks (one per line)</span>
        <textarea rows={2} value={risks} onChange={(e) => setRisks(e.target.value)} />
      </label>
      <div className="actions">
        <Btn type="submit" variant="primary" pending={pending} disabled={!title.trim()}>
          Save changes
        </Btn>
        <Btn variant="ghost" onClick={onCancel} disabled={pending}>
          Cancel
        </Btn>
      </div>
    </form>
  );
}
