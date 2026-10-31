/** What the OBS overlay is allowed to see: no activity feed, no hidden ideas, no paths. */
import type { LiveState } from "@aria-live/shared";

export const OVERLAY_STEP_LIMIT = 8;

export function overlaySnapshot(state: LiveState): LiveState {
  const s = structuredClone(state);
  s.activity = [];
  s.connection = {
    ...s.connection,
    sessionId: null,
    error: null,
  };
  const r = s.round;
  if (r) {
    const hidden = new Set(r.ideas.filter((i) => i.hidden).map((i) => i.id));
    r.ideas = r.ideas.filter((i) => !hidden.has(i.id));
    r.candidates = r.candidates.filter((id) => !hidden.has(id));
    r.tallies = r.tallies.filter((t) => !hidden.has(t.ideaId));
    if (r.winnerId && hidden.has(r.winnerId)) r.winnerId = null;
    if (r.task) r.task = { ...r.task, note: null, decidedBy: null };
    if (r.execution) {
      r.execution = {
        ...r.execution,
        workdir: null,
        steps: r.execution.steps.slice(-OVERLAY_STEP_LIMIT),
      };
    }
  }
  return s;
}
