import { useEffect, useState } from "react";
import type { AriaApi } from "../lib/api";
import { errorMessage } from "../lib/api";
import {
  agentSnippets,
  maskCohostUrl,
  maskToken,
  remoteSnippets,
  type AgentConnection,
  type AgentSnippet,
} from "../lib/agents";
import { Btn, Spinner, useActions } from "./actions";
import { copyText } from "./Drawer";

export function AgentPanel({ api }: { api: AriaApi }) {
  const { toast } = useActions();
  const [conn, setConn] = useState<AgentConnection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reveal, setReveal] = useState(false);
  const [tab, setTab] = useState<"local" | "remote">("local");

  useEffect(() => {
    let alive = true;
    api
      .agentConnection()
      .then((c) => alive && setConn(c))
      .catch((e) => alive && setError(errorMessage(e)));
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

  return (
    <div className="agent-panel">
      <p className="lede">
        Let Codex, Claude Code or Aria Code pick up approved tasks through the Aria Live MCP bridge.
      </p>
      <p className="callout callout--info">
        The agent can claim <strong>approved</strong> tasks and report progress; it can never approve, reject or vote.
      </p>
      <div className="agent-panel__meta">
        <Btn size="sm" variant={tab === "local" ? "primary" : "ghost"} onClick={() => setTab("local")}>
          Local (stdio)
        </Btn>
        {remote && (
          <Btn size="sm" variant={tab === "remote" ? "primary" : "ghost"} onClick={() => setTab("remote")}>
            Remote (URL)
          </Btn>
        )}
      </div>
      <div className="agent-panel__meta">
        <span>
          {tab === "remote" && remote ? "MCP endpoint" : "Server URL"} <code>{tab === "remote" && remote ? remote.agentUrl : conn.mcpUrl}</code>
        </span>
        <label className="switch">
          <input type="checkbox" checked={reveal} onChange={(e) => setReveal(e.target.checked)} />
          <span>Reveal token</span>
        </label>
      </div>
      {shown.map((s, i) => (
        <section key={s.id} className="snippet">
          <header className="snippet__head">
            <h3>{s.client}</h3>
            <span className="muted">{s.where}</span>
            <Btn
              size="sm"
              variant="secondary"
              className="push-right"
              onClick={async () => {
                const ok = await copyText(real[i]!.text);
                toast(ok ? "success" : "error", ok ? `${s.client} command copied (with token)` : "Copy failed");
              }}
            >
              Copy
            </Btn>
          </header>
          <pre className="snippet__code">
            <code>{s.text}</code>
          </pre>
          {s.note && <p className="muted snippet__note">{s.note}</p>}
        </section>
      ))}
      {tab === "remote" && remote && (
        <>
          <p className="muted">
            The Claude Code progress hook (plugin) posts "Edited …" / "Ran tests" lines automatically; Codex and Aria Code
            report progress through the live_report_progress tool.
          </p>
          <section className="snippet">
            <header className="snippet__head">
              <h3>Co-host (ChatGPT / Claude.ai)</h3>
              <span className="muted">Read-only connector URL — no auth</span>
              <Btn
                size="sm"
                variant="secondary"
                className="push-right"
                onClick={async () => {
                  const ok = await copyText(remote.cohostUrl);
                  toast(ok ? "success" : "error", ok ? "Co-host URL copied (secret)" : "Copy failed");
                }}
              >
                Copy
              </Btn>
            </header>
            <pre className="snippet__code">
              <code>{reveal ? remote.cohostUrl : maskCohostUrl(remote.cohostUrl)}</code>
            </pre>
            <p className="muted snippet__note">
              ChatGPT: Settings → Connectors → Developer mode → Create connector → paste the URL, no authentication.
              <br />
              Claude.ai: Settings → Connectors → Add custom connector → paste the URL.
            </p>
            <p className="muted snippet__note">
              The URL must be public HTTPS: e.g. run <code>cloudflared tunnel --url http://localhost:3000</code> and set{" "}
              <code>PUBLIC_URL</code> to the tunnel URL, then restart. The co-host can summarise chat and draft recaps but
              cannot change anything; it does reveal idea texts, so treat the URL as a secret.
            </p>
          </section>
        </>
      )}
      <p className="muted">Keep the token off stream — it lets an agent act on approved tasks.</p>
    </div>
  );
}
