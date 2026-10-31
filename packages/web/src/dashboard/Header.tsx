import { useState } from "react";
import type { Connection } from "@aria-live/shared";
import type { AriaApi, Me } from "../lib/api";
import type { LiveStatus } from "../lib/useLive";
import { timeAgo, useNow } from "../lib/time";
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
      <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true">
        <rect width="32" height="32" rx="8" fill="var(--accent)" />
        <path d="M9 23l7-15 7 15h-3.2l-1.3-3h-5l-1.3 3z" fill="#fff" />
        <circle cx="25" cy="8" r="3" fill="var(--live)" />
      </svg>
      <span className="logo__word">
        Aria <strong>Live Studio</strong>
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

function OverlayButton({ api }: { api: AriaApi }) {
  const { run, isPending, toast } = useActions();
  const [url, setUrl] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
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
          <input className="popover__url" readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
          <p className="muted">Keep this URL private — the key lets anyone view your overlay.</p>
          <div className="actions">
            <Btn size="sm" variant="primary" onClick={async () => toast("success", (await copyText(url)) ? "Copied" : "Copy failed")}>
              Copy again
            </Btn>
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
  onSettings,
  onAgent,
  onLogout,
}: {
  connection: Connection;
  live: LiveStatus;
  me: Me;
  api: AriaApi;
  onSettings: () => void;
  onAgent: () => void;
  onLogout: () => void;
}) {
  const channel = connection.channel ?? me.user;
  const name = channel?.displayName || channel?.login || "—";
  return (
    <header className="topbar">
      <Logo />
      <div className="topbar__channel" title={channel ? `twitch.tv/${channel.login}` : undefined}>
        <span className="avatar" aria-hidden="true">
          {name.slice(0, 1).toUpperCase()}
        </span>
        <span className="topbar__name">{name}</span>
      </div>
      <ConnectionPill connection={connection} />
      <span
        className={`chip ${connection.canReply ? "chip--good" : "chip--muted"}`}
        title={connection.canReply ? "Aria can reply in chat" : "Chat replies unavailable (user:write:chat not granted)"}
      >
        {connection.canReply ? "Chat replies on" : "Read-only chat"}
      </span>
      {live !== "open" && (
        <span className="chip chip--warn" role="status">
          Server {live === "connecting" ? "connecting…" : "reconnecting…"}
        </span>
      )}
      <nav className="topbar__actions" aria-label="Studio">
        <OverlayButton api={api} />
        <Btn size="sm" onClick={onAgent}>
          Connect agent
        </Btn>
        <a className="btn btn--ghost btn--sm" href="/history">
          History
        </a>
        <Btn size="sm" variant="ghost" onClick={onSettings}>
          Settings
        </Btn>
        <Btn size="sm" variant="ghost" onClick={onLogout}>
          Log out
        </Btn>
      </nav>
    </header>
  );
}
