import { useEffect, useState } from "react";
import QRCode from "qrcode";
import type { LiveState } from "@aria-live/shared";
import type { AriaApi, PreflightStatus } from "../lib/api";
import { errorMessage } from "../lib/api";
import { timeAgo } from "../lib/time";
import {
  agentSnippets,
  maskCohostUrl,
  maskToken,
  remoteSnippets,
  type AgentConnection,
  type AgentSnippet,
} from "../lib/agents";
import { Btn, Spinner, useActions } from "./actions";
import { ClientIcon } from "./ClientIcons";
import { copyText } from "./Drawer";

export function AgentPanel({
  api,
  agentConnected = false,
  agentStatus = null,
  connectedAgents = [],
  activeLease = null,
}: {
  api: AriaApi;
  agentConnected?: boolean;
  agentStatus?: LiveState["agentStatus"] | null;
  connectedAgents?: LiveState["connectedAgents"];
  activeLease?: LiveState["activeLease"] | null;
}) {
  const { toast } = useActions();
  const [conn, setConn] = useState<AgentConnection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reveal, setReveal] = useState(false);
  const [tab, setTab] = useState<"local" | "remote">("local");
  const [selectedId, setSelectedId] = useState<AgentSnippet["id"]>("claude-code");
  const [pingMs, setPingMs] = useState<number | null>(null);
  const [testing, setTesting] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [togglingTunnel, setTogglingTunnel] = useState(false);
  const [preflight, setPreflight] = useState<PreflightStatus | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .agentConnection()
      .then((c) => alive && setConn(c))
      .catch((e) => alive && setError(errorMessage(e)));
    if (typeof api.preflight === "function") {
      api
        .preflight()
        .then((p) => alive && setPreflight(p))
        .catch(() => {});
    }
    return () => {
      alive = false;
    };
  }, [api]);

  if (error) return <p className="callout callout--bad">{error}</p>;
  if (!conn)
    return (
      <p className="muted">
        <Spinner small /> Loading connection details…
      </p>
    );

  const remote = conn.remote;
  const build = (token: string): AgentSnippet[] =>
    tab === "remote" && remote ? remoteSnippets(token, remote.agentUrl) : agentSnippets({ ...conn, token });
  const real = build(conn.token);
  const shown = reveal ? real : build(maskToken(conn.token));
  const activeIndex = Math.max(0, shown.findIndex((s) => s.id === selectedId));
  const activeShown = shown[activeIndex] ?? shown[0]!;
  const activeReal = real[activeIndex] ?? real[0]!;

  return (
    <div className="agent-panel">
      <p className="lede">
        Connect your IDE, CLI, or chat app via MCP. Agents only run tasks you approve on the dashboard.
      </p>

      <div className="agent-panel__meta">
        <div className="agent-panel__tabs" role="tablist" aria-label="Connection mode">
          <Btn size="sm" variant={tab === "local" ? "primary" : "ghost"} onClick={() => setTab("local")}>
            Local (stdio)
          </Btn>
          {remote && (
            <Btn size="sm" variant={tab === "remote" ? "primary" : "ghost"} onClick={() => setTab("remote")}>
              Remote (URL)
            </Btn>
          )}
        </div>
        <span className={`pill pill--${agentConnected ? "good" : "warn"}`}>
          {agentConnected && agentStatus
            ? `${agentStatus.name} · ${timeAgo(agentStatus.lastSeenAt, Date.now())}`
            : agentConnected
              ? "Agent connected"
              : "Waiting for agent"}
        </span>
      </div>

      <div className="client-grid" role="listbox" aria-label="Select client">
        {shown.map((s) => {
          const isSelected = s.id === activeShown.id;
          return (
            <button
              key={s.id}
              type="button"
              role="option"
              aria-selected={isSelected}
              className={`client-chip${isSelected ? " client-chip--active" : ""}`}
              onClick={() => setSelectedId(s.id)}
            >
              <ClientIcon id={s.id} size={18} />
              <span>{s.client}</span>
            </button>
          );
        })}
      </div>

      <section className="snippet">
        <header className="snippet__head">
          <h3>
            <ClientIcon id={activeShown.id} size={18} />
            {activeShown.client}
          </h3>
          <span className="muted">{activeShown.where}</span>
          <Btn
            size="sm"
            variant="secondary"
            className="push-right"
            onClick={async () => {
              const ok = await copyText(activeReal.text);
              toast(ok ? "success" : "error", ok ? `${activeShown.client} config copied (with token)` : "Copy failed");
            }}
          >
            Copy
          </Btn>
        </header>
        <pre className="snippet__code">
          <code>{activeShown.text}</code>
        </pre>
        {activeShown.note && <p className="muted snippet__note">{activeShown.note}</p>}
      </section>

      <div className="agent-panel__toolbar">
        <Btn
          size="sm"
          variant="ghost"
          pending={testing}
          onClick={async () => {
            setTesting(true);
            const t0 = performance.now();
            try {
              const fresh = await api.agentConnection();
              setConn(fresh);
              const ms = Math.max(1, Math.round(performance.now() - t0));
              setPingMs(ms);
              toast("success", `MCP bridge reachable (${ms} ms)`);
            } catch (e) {
              toast("error", errorMessage(e));
            } finally {
              setTesting(false);
            }
          }}
        >
          Test
        </Btn>
        <Btn
          size="sm"
          variant="secondary"
          onClick={async () => {
            const cmd = conn.mcpCommand ?? { command: "node", args: ["plugin/mcp/aria-live-mcp.mjs"] };
            const mcpJson = JSON.stringify(
              {
                mcpServers: {
                  "aria-live": {
                    command: cmd.command,
                    args: cmd.args,
                    env: { ARIA_LIVE_TOKEN: conn.token, ARIA_LIVE_URL: conn.mcpUrl },
                  },
                },
              },
              null,
              2,
            );
            const ok = await copyText(mcpJson);
            toast(ok ? "success" : "error", ok ? "MCP JSON copied (with token)" : "Copy failed");
          }}
        >
          Copy MCP JSON
        </Btn>
        <Btn
          size="sm"
          variant="ghost"
          pending={rotating}
          onClick={async () => {
            setRotating(true);
            try {
              const fresh = await api.rotateAgentKeys();
              setConn(fresh);
              toast("success", "Rotated agent, co-host, and streamer keys");
            } catch (e) {
              toast("error", errorMessage(e));
            } finally {
              setRotating(false);
            }
          }}
        >
          Rotate keys
        </Btn>
        <label className="switch">
          <input type="checkbox" checked={reveal} onChange={(e) => setReveal(e.target.checked)} />
          <span>Reveal token</span>
        </label>
      </div>

      {tab === "remote" && remote && (
        <>
          {conn.tunnel && (
            <div className="agent-panel__tunnel">
              <div>
                <strong>HTTPS Tunnel</strong>{" "}
                <span className="muted">
                  {conn.tunnel.running && conn.tunnel.url
                    ? conn.tunnel.url
                    : conn.tunnel.available
                      ? "Expose localhost over HTTPS for mobile/cloud apps"
                      : "Install cloudflared for one-click HTTPS"}
                </span>
              </div>
              {conn.tunnel.available && (
                <Btn
                  size="sm"
                  variant={conn.tunnel.running ? "danger" : "secondary"}
                  pending={togglingTunnel}
                  onClick={async () => {
                    setTogglingTunnel(true);
                    try {
                      const res = conn.tunnel?.running ? await api.stopTunnel() : await api.startTunnel();
                      setConn(res.connection);
                      if (res.error) toast("error", res.error);
                      else toast("success", res.running ? `Tunnel active: ${res.url}` : "Tunnel stopped");
                    } catch (e) {
                      toast("error", errorMessage(e));
                    } finally {
                      setTogglingTunnel(false);
                    }
                  }}
                >
                  {conn.tunnel.running ? "Stop Tunnel" : "Start Tunnel"}
                </Btn>
              )}
            </div>
          )}
          <h3 className="agent-panel__sub">
            <ClientIcon id="chatgpt" size={16} />
            <ClientIcon id="claude" size={16} />
            Desktop &amp; Mobile Chat Apps
          </h3>
          <ConnectorUrl
            title="Co-host (Read-only)"
            role="Reads round, ideas, history & activity. Cannot change anything."
            url={remote.cohostUrl}
            reveal={reveal}
            onCopied={(ok) => toast(ok ? "success" : "error", ok ? "Co-host URL copied (secret)" : "Copy failed")}
          />
          {remote.streamerUrl && (
            <ConnectorUrl
              title="Streamer (Remote control)"
              role="Open/close rounds & votes, hide ideas, plan winner. Can never approve, reject, run or cancel."
              url={remote.streamerUrl}
              reveal={reveal}
              onCopied={(ok) => toast(ok ? "success" : "error", ok ? "Streamer URL copied (secret)" : "Copy failed")}
            />
          )}
          <p className="muted snippet__note">
            Requires public HTTPS (<code>PUBLIC_URL</code>, e.g. <code>cloudflared tunnel --url http://localhost:3000</code>). Keep URLs off stream.
          </p>
        </>
      )}

      <details className="agent-panel__details">
        <summary>
          Server &amp; diagnostics
          {pingMs !== null ? ` · Bridge ${pingMs} ms` : ""}
        </summary>
        <div className="agent-panel__details-body">
          <div>
            <span className="muted">{tab === "remote" && remote ? "MCP endpoint: " : "Server URL: "}</span>
            <code>{tab === "remote" && remote ? remote.agentUrl : conn.mcpUrl}</code>
          </div>
          {preflight && (
            <div className="agent-panel__meta">
              <span className={`pill pill--${preflight.planner.apiKeyConfigured ? "good" : "warn"}`}>
                Planner: {preflight.planner.model ?? preflight.planner.kind}
              </span>
              <span className={`pill pill--${preflight.executor.ok ? "good" : "warn"}`} title={preflight.executor.reason ?? undefined}>
                Executor: {preflight.executor.kind}
                {preflight.executor.targetRepoConfigured ? " · Repo bound" : " · MCP-only"}
              </span>
            </div>
          )}
          {activeLease && (
            <div>
              <span className={`pill pill--${Date.now() > activeLease.expiresAt ? "warn" : "info"}`}>
                {Date.now() > activeLease.expiresAt
                  ? `Lease expired (${activeLease.client}) — cancel or retry`
                  : `Lease: ${activeLease.client} · ${timeAgo(activeLease.claimedAt, Date.now())}`}
              </span>
            </div>
          )}
          {connectedAgents && connectedAgents.length > 0 && (
            <div className="agent-panel__meta">
              <span className="muted">Active agents:</span>
              {connectedAgents.map((a) => (
                <span key={a.name} className="pill">
                  {a.name} · {timeAgo(a.lastSeenAt, Date.now())}
                </span>
              ))}
            </div>
          )}
        </div>
      </details>
    </div>
  );
}

function ConnectorUrl({
  title,
  role,
  url,
  reveal,
  onCopied,
}: {
  title: string;
  role: string;
  url: string;
  reveal: boolean;
  onCopied: (ok: boolean) => void;
}) {
  const [showQr, setShowQr] = useState(false);
  const [qrSrc, setQrSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!showQr) return;
    let alive = true;
    QRCode.toDataURL(url, { width: 152, margin: 1 })
      .then((src) => alive && setQrSrc(src))
      .catch(() => alive && setQrSrc(null));
    return () => {
      alive = false;
    };
  }, [showQr, url]);

  return (
    <section className="snippet">
      <header className="snippet__head">
        <h3>{title}</h3>
        <div className="push-right snippet__actions">
          <Btn size="sm" variant="ghost" onClick={() => setShowQr((v) => !v)}>
            {showQr ? "Hide QR" : "QR"}
          </Btn>
          <Btn size="sm" variant="secondary" onClick={async () => onCopied(await copyText(url))}>
            Copy
          </Btn>
        </div>
      </header>
      <pre className="snippet__code">
        <code>{reveal ? url : maskCohostUrl(url)}</code>
      </pre>
      {showQr && qrSrc && (
        <div className="snippet__qr">
          <img src={qrSrc} width={152} height={152} alt={`${title} QR code`} />
          <span className="muted">Scan on mobile to open or copy this secret connector URL.</span>
        </div>
      )}
      <p className="muted snippet__note">{role}</p>
    </section>
  );
}
