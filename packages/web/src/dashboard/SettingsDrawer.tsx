import { useEffect, useState } from "react";
import { ELIGIBILITY_LABEL, FEATURE_SCOPE, type Eligibility, type Settings } from "@aria-live/shared";
import { errorMessage, type AriaApi, type Me } from "../lib/api";
import { getThemePref, setThemePref, subscribeTheme, type ThemePref } from "../lib/theme";
import { playCue } from "../lib/sound";
import { Btn, useActions } from "./actions";

type NumKey = "ideaCooldownSec" | "maxIdeaLength" | "maxIdeasPerRound" | "maxCandidates" | "voteDurationSec";

const FIELDS: { key: NumKey; label: string; hint: string; min: number; max: number }[] = [
  { key: "ideaCooldownSec", label: "Idea cooldown (s)", hint: "Wait between two !idea from one viewer", min: 0, max: 3600 },
  { key: "maxIdeaLength", label: "Max idea length", hint: "Characters", min: 10, max: 500 },
  { key: "maxIdeasPerRound", label: "Max ideas per round", hint: "Extra ideas are refused", min: 1, max: 500 },
  { key: "maxCandidates", label: "Ballot size", hint: "Ideas that go to the vote", min: 2, max: 20 },
  { key: "voteDurationSec", label: "Vote duration (s)", hint: "0 = close by hand", min: 0, max: 3600 },
];

const ELIGIBILITY_FIELDS: { key: "ideaEligibility" | "voteEligibility"; label: string; hint: string }[] = [
  { key: "ideaEligibility", label: "Who can submit ideas", hint: "!idea and +1s, from chat badges" },
  { key: "voteEligibility", label: "Who can vote", hint: "!vote, from chat badges" },
];

const ELIGIBILITY_HINT: Record<Eligibility, string> = {
  everyone: "Everyone in chat",
  subscribers: "Subscribers and founders (VIPs, mods and you always can)",
  vip_mod: "VIPs and moderators only (and you)",
};

type TwitchKey = keyof typeof FEATURE_SCOPE;

const TWITCH_FIELDS: { key: TwitchKey; label: string; hint: string }[] = [
  { key: "autoTitle", label: "Stream title", hint: "“Building live: <task> · voted by chat” while it's built, then your title back" },
  { key: "streamMarkers", label: "Stream markers", hint: "At round open, vote, winner and build start/end — linked in History" },
  { key: "autoClip", label: "Clip successful builds", hint: "Clips the last ~30 s and posts the link in chat" },
];

export function SettingsForm({
  settings,
  me,
  api,
  onDone,
  missingScopes = [],
}: {
  settings: Settings;
  me: Me;
  api: AriaApi;
  onDone: () => void;
  /** Connection.missingScopes: features needing them are disabled until the streamer reconnects. */
  missingScopes?: string[];
}) {
  const { run, isPending, toast } = useActions();
  const [draft, setDraft] = useState<Settings>(settings);
  const [themePref, setThemePrefState] = useState<ThemePref>(() => getThemePref());
  useEffect(() => setDraft(settings), [settings]);
  useEffect(() => subscribeTheme(() => setThemePrefState(getThemePref())), []);

  const changed: Partial<Settings> = {};
  (Object.keys(draft) as (keyof Settings)[]).forEach((k) => {
    if (draft[k] !== settings[k]) (changed as Record<string, unknown>)[k] = draft[k];
  });
  const dirty = Object.keys(changed).length > 0;
  const invalid = FIELDS.some((f) => !Number.isFinite(draft[f.key]) || draft[f.key] < f.min || draft[f.key] > f.max);

  return (
    <form
      className="settings"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!dirty || invalid) return;
        if (await run("settings", () => api.settings(changed), { success: "Settings saved" })) onDone();
      }}
    >
      {FIELDS.map((f) => (
        <label key={f.key} className="field">
          <span>{f.label}</span>
          <input
            type="number"
            min={f.min}
            max={f.max}
            value={Number.isFinite(draft[f.key]) ? draft[f.key] : ""}
            onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value === "" ? NaN : Number(e.target.value) })}
          />
          <small className="muted">{f.hint}</small>
        </label>
      ))}
      {ELIGIBILITY_FIELDS.map((f) => (
        <label key={f.key} className="field">
          <span>{f.label}</span>
          <select value={draft[f.key]} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value as Eligibility })}>
            {(Object.keys(ELIGIBILITY_LABEL) as Eligibility[]).map((e) => (
              <option key={e} value={e}>
                {ELIGIBILITY_LABEL[e]}
              </option>
            ))}
          </select>
          <small className="muted">
            {f.hint} · {ELIGIBILITY_HINT[draft[f.key]]}
          </small>
        </label>
      ))}
      <label className="switch switch--row">
        <input
          type="checkbox"
          checked={draft.chatReplies}
          onChange={(e) => setDraft({ ...draft, chatReplies: e.target.checked })}
        />
        <span>
          Reply in chat
          <small className="muted"> — acknowledge ideas and votes (rate limited)</small>
        </span>
      </label>
      <fieldset className="field field--group">
        <legend>Twitch</legend>
        {TWITCH_FIELDS.map((f) => {
          const missing = missingScopes.includes(FEATURE_SCOPE[f.key]);
          return (
            <label key={f.key} className="switch switch--row">
              <input
                type="checkbox"
                checked={draft[f.key] && !missing}
                disabled={missing}
                onChange={(e) => setDraft({ ...draft, [f.key]: e.target.checked })}
              />
              <span>
                {f.label}
                <small className="muted">
                  {" "}
                  — {missing ? `reconnect Twitch to allow it (needs ${FEATURE_SCOPE[f.key]})` : f.hint}
                </small>
              </span>
            </label>
          );
        })}
        <label className="switch switch--row">
          <input
            type="checkbox"
            checked={Boolean(draft.autoOpenOnStreamOnline)}
            onChange={(e) => setDraft({ ...draft, autoOpenOnStreamOnline: e.target.checked })}
          />
          <span>
            Auto-open round on stream online
            <small className="muted"> — Open a warm-up round automatically when Twitch goes live</small>
          </span>
        </label>
        <small className="muted">Markers and clips only work while you're live.</small>
      </fieldset>
      <label className="field">
        <span>Overlay density</span>
        <select
          value={draft.overlayDensity ?? "standard"}
          onChange={(e) => setDraft({ ...draft, overlayDensity: e.target.value as "standard" | "compact" })}
        >
          <option value="standard">Standard (with preview &amp; Co-Builders)</option>
          <option value="compact">Compact (minimal footprint)</option>
        </select>
      </label>
      <div className="field">
        <span>Appearance (System &amp; Day/Night)</span>
        <div className="monitor-pill-group" role="group" aria-label="Appearance">
          {(
            [
              ["auto", "Auto"],
              ["light", "Light"],
              ["dark", "Dark"],
            ] as const
          ).map(([v, label]) => (
            <button
              key={v}
              type="button"
              className={`monitor-pill ${themePref === v ? "is-on" : ""}`}
              onClick={() => {
                playCue("click");
                setThemePref(v);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <span>Built-in executor</span>
        {me.executor.ok ? (
          <label className="switch switch--row">
            <input
              type="checkbox"
              checked={draft.executorEnabled}
              onChange={(e) => setDraft({ ...draft, executorEnabled: e.target.checked })}
            />
            <span>
              Allow “Run in isolated workspace” <small className="muted">({me.executor.kind})</small>
            </span>
          </label>
        ) : (
          <p className="callout callout--warn">
            {me.executor.kind}: unavailable{me.executor.reason ? ` — ${me.executor.reason}` : ""}
          </p>
        )}
      </div>
      <div className="field">
        <span>OBS WebSocket Scene Automation</span>
        <label className="switch switch--row">
          <input
            type="checkbox"
            checked={Boolean(draft.obsEnabled)}
            onChange={(e) => setDraft({ ...draft, obsEnabled: e.target.checked })}
          />
          <span>Auto-switch OBS scenes on phase change</span>
        </label>
        {draft.obsEnabled && (
          <div className="agent-panel__details-body">
            <input
              type="text"
              placeholder="ws://127.0.0.1:4455"
              value={draft.obsUrl ?? ""}
              onChange={(e) => setDraft({ ...draft, obsUrl: e.target.value })}
              aria-label="OBS WebSocket URL"
            />
            <input
              type="password"
              placeholder="OBS WebSocket password (optional)"
              value={draft.obsPassword ?? ""}
              onChange={(e) => setDraft({ ...draft, obsPassword: e.target.value })}
              aria-label="OBS WebSocket password"
            />
            {(["collecting", "voting", "executing", "done"] as const).map((phaseKey) => (
              <input
                key={phaseKey}
                type="text"
                placeholder={`Scene for ${phaseKey} (optional)`}
                value={draft.obsScenes?.[phaseKey] ?? ""}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    obsScenes: { ...(draft.obsScenes ?? {}), [phaseKey]: e.target.value },
                  })
                }
                aria-label={`OBS scene for ${phaseKey}`}
              />
            ))}
            <Btn
              size="sm"
              variant="secondary"
              onClick={async () => {
                try {
                  const res = await api.testObs(draft.obsUrl, draft.obsPassword);
                  if (res.ok) {
                    toast("success", `OBS connected (${res.scenes.length} scenes: ${res.scenes.slice(0, 4).join(", ")})`);
                  } else {
                    toast("error", res.error || "Could not connect to OBS");
                  }
                } catch (err) {
                  toast("error", errorMessage(err));
                }
              }}
            >
              Test OBS Connection
            </Btn>
          </div>
        )}
      </div>
      <div className="actions">
        <Btn type="submit" variant="primary" pending={isPending("settings")} disabled={!dirty || invalid}>
          Save settings
        </Btn>
        <Btn variant="ghost" onClick={() => setDraft(settings)} disabled={!dirty}>
          Revert
        </Btn>
      </div>
    </form>
  );
}
