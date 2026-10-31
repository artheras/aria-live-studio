import type { Round } from "@aria-live/shared";
import type { AriaApi } from "../lib/api";
import { computeBallot, totalVotes } from "../lib/round";
import { useActions } from "./actions";

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
              <span className="ballot__author">@{r.idea.author.displayName || r.idea.author.login}</span>
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
                @{idea.author.displayName || idea.author.login}
                {idea.seconds > 0 && <span className="plus">+{idea.seconds}</span>}
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

export function IdeasPanel({ round, api, maxIdeas }: { round: Round | null; api: AriaApi; maxIdeas: number }) {
  const phase = round?.phase ?? "idle";
  const showBallot = round && phase !== "idle" && phase !== "collecting" && round.candidates.length > 0;
  const visible = round?.ideas.filter((i) => !i.hidden).length ?? 0;
  return (
    <section className="panel panel--ideas" aria-labelledby="ideas-h">
      <header className="panel__head">
        <h2 id="ideas-h">{showBallot ? "Ballot" : "Ideas"}</h2>
        {round && !showBallot && (
          <span className="panel__count num">
            {visible}/{maxIdeas}
          </span>
        )}
        {showBallot && phase === "voting" && <span className="live-tag">Live</span>}
      </header>
      <div className="panel__body panel__body--scroll">
        {!round || phase === "idle" ? (
          <div className="empty empty--big">
            <p>No round open.</p>
            <p className="muted">Open a round and chat's ideas will appear here live.</p>
          </div>
        ) : showBallot ? (
          <Ballot round={round} />
        ) : (
          <IdeaList round={round} api={api} />
        )}
      </div>
    </section>
  );
}
