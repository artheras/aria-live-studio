import { useEffect, useState } from "react";
import type { Connection, LiveState } from "@aria-live/shared";
import type { AriaApi, Me } from "../lib/api";
import type { LiveStatus } from "../lib/useLive";
import { timeAgo, useNow } from "../lib/time";
import { getThemePref, setThemePref, subscribeTheme, type ThemePref } from "../lib/theme";
import { playCue } from "../lib/sound";
import { Btn, useActions } from "./actions";
import { copyText } from "./Drawer";

const TWITCH_LABEL: Record<Connection["state"], string> = {
  signed_out: "Twitch signed out",
  connecting: "Connecting to Twitch",
  connected: "Twitch connected",
  reconnecting: "Twitch reconnecting",
  error: "Twitch error",
};

export function Logo() {
  return (
    <span className="logo">
      <img
        className="logo__icon"
        src="/aria-live-studio-icon.svg"
        onError={(e) => {
          e.currentTarget.onerror = null;
          e.currentTarget.src = "/aria-icon-dark.png";
        }}
        width={32}
        height={32}
        alt=""
        aria-hidden="true"
      />
      <span className="logo__stack">
        <span className="logo__word">
          Aria <strong>Live Studio</strong>
        </span>
        <span className="logo__sub">Stream · Create · Connect</span>
      </span>
    </span>
  );
}

export function ConnectionPill({ connection }: { connection: Connection }) {
  const now = useNow(1000);
  const tip = [
    TWITCH_LABEL[connection.state],
    connection.sessionId ? `EventSub session: ${connection.sessionId}` : null,
    connection.error ? `Error: ${connection.error}` : null,
    `Reconnects: ${connection.reconnects}`,
  ]
    .filter(Boolean)
    .join("\n");
  return (
    <span className={`conn conn--${connection.state}`} title={tip} tabIndex={0} aria-label={tip}>
      <span className="conn__dot" aria-hidden="true" />
      <span className="conn__label">{TWITCH_LABEL[connection.state]}</span>
      <span className="conn__meta num">
        {connection.reconnects > 0 && <span title="Reconnects">↻{connection.reconnects} · </span>}
        last event {timeAgo(connection.lastEventAt, now)}
      </span>
    </span>
  );
}

import type { OverlayLayout, OverlayPos, OverlayStageMode } from "../overlay/Overlay";

function buildConfiguredOverlayUrl(base: string, pos: OverlayPos, layout: OverlayLayout, mode: OverlayStageMode): string {
  const params = new URLSearchParams();
  if (pos !== "bl") params.set("pos", pos);
  if (layout !== "standard") params.set("layout", layout);
  if (mode !== "none") params.set("mode", mode);
  const qs = params.toString();
  if (!qs) return base;
  return `${base}${base.includes("?") ? "&" : "?"}${qs}`;
}

function OverlayButton({ api }: { api: AriaApi }) {
  const { run, isPending, toast } = useActions();
  const [url, setUrl] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<OverlayPos>("bl");
  const [layout, setLayout] = useState<OverlayLayout>("standard");
  const [mode, setMode] = useState<OverlayStageMode>("none");
  const configuredUrl = url ? buildConfiguredOverlayUrl(url, pos, layout, mode) : "";
  return (
    <div className="popover-anchor">
      <Btn
        size="sm"
        pending={isPending("overlay-url")}
        onClick={() =>
          run("overlay-url", async () => {
            const u = await api.overlayUrl();
            setUrl(u);
            setOpen(true);
            const ok = await copyText(u);
            toast(ok ? "success" : "info", ok ? "Overlay URL copied" : "Copy the overlay URL below");
          })
        }
      >
        Overlay URL
      </Btn>
      {open && url && (
        <div className="popover" role="dialog" aria-label="Overlay URL">
          <p className="popover__title">Add as OBS Browser Source 1920×1080</p>
          <div className="popover__presets">
            <div className="popover__row">
              <span className="popover__label">3D Mode</span>
              <div className="popover__pills">
                {(
                  [
                    ["none", "Card"],
                    ["stage", "Corner 3D"],
                    ["card3d", "3D Card"],
                    ["showcase", "Fullscreen 3D"],
                  ] as const
                ).map(([v, label]) => (
                  <button
                    key={v}
                    type="button"
                    className={`popover__pill ${mode === v ? "is-on" : ""}`}
                    onClick={() => setMode(v)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            {mode !== "showcase" && (
              <>
                <div className="popover__row">
                  <span className="popover__label">Layout</span>
                  <div className="popover__pills">
                    {(
                      [
                        ["standard", "Standard"],
                        ["compact", "Compact"],
                        ["topbar", "Top Bar"],
                        ["minimal", "Minimal"],
                      ] as const
                    ).map(([v, label]) => (
                      <button
                        key={v}
                        type="button"
                        className={`popover__pill ${layout === v ? "is-on" : ""}`}
                        onClick={() => setLayout(v)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="popover__row">
                  <span className="popover__label">Position</span>
                  <div className="popover__pills">
                    {(
                      [
                        ["bl", "Bottom Left"],
                        ["br", "Bottom Right"],
                      ] as const
                    ).map(([v, label]) => (
                      <button
                        key={v}
                        type="button"
                        className={`popover__pill ${pos === v ? "is-on" : ""}`}
                        onClick={() => setPos(v)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
          <input className="popover__url" readOnly value={configuredUrl} onFocus={(e) => e.currentTarget.select()} />
          <p className="muted">Keep this URL private — the key lets anyone view your overlay.</p>
          <div className="actions">
            <Btn
              size="sm"
              variant="primary"
              onClick={async () => toast("success", (await copyText(configuredUrl)) ? "Copied" : "Copy failed")}
            >
              Copy URL
            </Btn>
            <Btn
              size="sm"
              onClick={async () => {
                const sep = url.includes("?") ? "&" : "?";
                const preset = `${url}${sep}pos=br&mode=card3d`;
                toast("success", (await copyText(preset)) ? "OBS 3D preset copied" : "Copy failed");
              }}
            >
              Copy 3D Card
            </Btn>
            <a className="btn btn--sm" href={configuredUrl} target="_blank" rel="noreferrer">
              Preview
            </a>
            <Btn size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Close
            </Btn>
          </div>
        </div>
      )}
    </div>
  );
}

export function Header({
  connection,
  live,
  me,
  api,
  agentStatus,
  onSettings,
  onAgent,
  onLogout,
}: {
  connection: Connection;
  live: LiveStatus;
  me: Me;
  api: AriaApi;
  agentStatus?: LiveState["agentStatus"];
  onSettings: () => void;
  onAgent: () => void;
  onLogout: () => void;
}) {
  const now = useNow(10_000);
  const agentOnline = Boolean(agentStatus && now - agentStatus.lastSeenAt < 90_000);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showReconnect, setShowReconnect] = useState(false);
  const [themePref, setThemePrefState] = useState<ThemePref>(() => getThemePref());

  useEffect(() => subscribeTheme(() => setThemePrefState(getThemePref())), []);

  useEffect(() => {
    if (live === "open") {
      setShowReconnect(false);
      return;
    }
    const timer = window.setTimeout(() => setShowReconnect(true), 4000);
    return () => window.clearTimeout(timer);
  }, [live]);

  const { run, toast } = useActions();
  const channel = connection.channel ?? me.user;
  const name = channel?.displayName || channel?.login || "—";

  return (
    <header className="topbar topbar--studio">
      <Logo />
      <div className="topbar__right">
        {showReconnect && (
          <span className="chip chip--warn" role="status">
            Server {live === "connecting" ? "connecting…" : "reconnecting…"}
          </span>
        )}
        <button
          type="button"
          className={`service-pill ${agentOnline ? "is-ok" : ""}`}
          onClick={onAgent}
          title={agentOnline ? `Connected: ${agentStatus?.name ?? "Agent"}` : "Click to connect a coding agent"}
        >
          <span className="service-pill__dot" aria-hidden="true" />
          <span>{agentOnline ? `Agent · ${agentStatus?.name || "Online"}` : "Agent Offline"}</span>
        </button>
        <button
          type="button"
          className={`service-pill ${connection.state === "connected" ? "is-ok" : "is-warn"}`}
          onClick={onSettings}
          title={`Twitch: ${TWITCH_LABEL[connection.state]}${connection.isLive ? " (Stream LIVE)" : ""} · Click to manage Settings`}
        >
          <span className="service-pill__dot" aria-hidden="true" />
          <span>
            {connection.state === "connected" ? (connection.isLive ? "Twitch · LIVE" : "Twitch Connected") : "Twitch Offline"}
          </span>
        </button>
        <a className="service-pill" href="/history" title="View past rounds & VOD markers">
          <span>History</span>
        </a>
        <div className="popover-anchor">
          <button
            type="button"
            className="user-pill"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((o) => !o)}
            title={channel ? `twitch.tv/${channel.login}` : undefined}
          >
            <span className="user-pill__avatar-wrap">
              {channel?.avatarUrl ? (
                <img className="avatar avatar__img" src={channel.avatarUrl} width={28} height={28} alt="" />
              ) : (
                <span className="avatar" aria-hidden="true">
                  {name.slice(0, 1).toUpperCase()}
                </span>
              )}
              <span
                className={`user-pill__dot ${connection.state === "connected" ? "is-online" : ""}`}
                aria-hidden="true"
              />
            </span>
            <span className="topbar__name">{name}</span>
            <span className="user-pill__caret" aria-hidden="true">▾</span>
          </button>
          {menuOpen && (
            <div className="popover user-menu" role="menu" aria-label="Studio menu">
              <div className="user-menu__status">
                <ConnectionPill connection={connection} />
                <span className={`chip ${connection.canReply ? "chip--good" : "chip--muted"}`}>
                  {connection.canReply ? "Chat replies on" : "Read-only chat"}
                </span>
                <span className={`chip ${me.executor.ok || agentOnline ? "chip--good" : "chip--muted"}`}>
                  {agentOnline && agentStatus
                    ? `Agent: ${agentStatus.name}`
                    : me.executor.ok
                      ? `Agent: ${me.executor.kind}`
                      : "Agent: Waiting"}
                </span>
              </div>
              <div className="user-menu__theme" role="group" aria-label="Appearance">
                <span className="user-menu__theme-label">Appearance</span>
                <div className="monitor-pill-group">
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
              <div className="user-menu__items">
                <button
                  type="button"
                  className="user-menu__item"
                  onClick={() => {
                    setMenuOpen(false);
                    void run("overlay-url", async () => {
                      const u = await api.overlayUrl();
                      const ok = await copyText(u);
                      toast(ok ? "success" : "info", ok ? "Overlay URL copied" : u);
                    });
                  }}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <rect x="9" y="9" width="13" height="13" rx="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                  <span>Copy OBS Overlay URL</span>
                </button>
                <button
                  type="button"
                  className="user-menu__item"
                  onClick={() => {
                    setMenuOpen(false);
                    onAgent();
                  }}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <rect x="4" y="4" width="16" height="16" rx="3" />
                    <path d="M9 9h6M9 13h4" />
                  </svg>
                  <span>Connect coding agent</span>
                </button>
                <a className="user-menu__item" href="/history">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <circle cx="12" cy="12" r="9" />
                    <path d="M12 7v5l3 2" />
                  </svg>
                  <span>Round history</span>
                </a>
                <button
                  type="button"
                  className="user-menu__item"
                  onClick={() => {
                    setMenuOpen(false);
                    onSettings();
                  }}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.6.79 1 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                  </svg>
                  <span>Manage settings</span>
                </button>
                <button
                  type="button"
                  className="user-menu__item user-menu__item--danger"
                  onClick={() => {
                    setMenuOpen(false);
                    onLogout();
                  }}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
                  </svg>
                  <span>Log out</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
