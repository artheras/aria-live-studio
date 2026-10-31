import type { Activity, LiveState } from "@aria-live/shared";
import { COMMANDS } from "@aria-live/shared";
import { clock } from "../lib/time";

const KIND: Record<Activity["kind"], { label: string; icon: string }> = {
  idea: { label: "Idea", icon: "+" },
  idea_duplicate: { label: "+1", icon: "=" },
  vote: { label: "Vote", icon: "✓" },
  rejected: { label: "Refused", icon: "!" },
  round: { label: "Round", icon: "◆" },
  task: { label: "Task", icon: "▤" },
  execution: { label: "Build", icon: "▶" },
  system: { label: "System", icon: "i" },
};

export function ActivityFeed({ activity }: { activity: Activity[] }) {
  const items = activity.slice(-150).reverse();
  return (
    <section className="panel panel--activity" aria-labelledby="activity-h">
      <header className="panel__head">
        <h2 id="activity-h">Activity</h2>
      </header>
      <div className="panel__body panel__body--scroll">
        {items.length === 0 ? (
          <p className="empty">Quiet so far. Chat activity shows up here.</p>
        ) : (
          <ul className="feed">
            {items.map((a) => {
              const k = KIND[a.kind] ?? KIND.system;
              return (
                <li key={a.id} className={`feed__item feed__item--${a.kind}`}>
                  <span className="feed__icon" aria-hidden="true">
                    {k.icon}
                  </span>
                  <div className="feed__body">
                    <p className="feed__text">
                      <span className="feed__kind">{k.label}</span>
                      {a.user && <span className="feed__user">@{a.user.displayName || a.user.login}</span>}
                      {a.text}
                    </p>
                  </div>
                  <time className="feed__at num">{clock(a.at)}</time>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

export function StatsStrip({ stats }: { stats: LiveState["stats"] }) {
  const items: [string, number][] = [
    ["Rounds", stats.rounds],
    ["Ideas", stats.ideas],
    ["Votes", stats.votes],
    ["Participants", stats.participants],
  ];
  return (
    <dl className="stats">
      {items.map(([label, value]) => (
        <div key={label} className="stat">
          <dt>{label}</dt>
          <dd className="num">{value.toLocaleString()}</dd>
        </div>
      ))}
    </dl>
  );
}

export function CommandHelp() {
  const rows: [string, string][] = [
    [`${COMMANDS.idea} <your idea>`, "Submit an idea while a round is collecting"],
    [`${COMMANDS.vote} <number>`, "Vote for a ballot entry"],
    [COMMANDS.ideas, "Aria lists the current ideas / ballot"],
    [COMMANDS.help, "How to play"],
  ];
  return (
    <section className="panel panel--help" aria-labelledby="help-h">
      <header className="panel__head">
        <h2 id="help-h">Chat commands</h2>
      </header>
      <dl className="commands">
        {rows.map(([cmd, desc]) => (
          <div key={cmd}>
            <dt>
              <code>{cmd}</code>
            </dt>
            <dd>{desc}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
