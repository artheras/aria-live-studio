import { useEffect, useState } from "react";
import type { AriaApi } from "../lib/api";
import { errorMessage } from "../lib/api";
import { agentSnippets, maskToken, type AgentConnection } from "../lib/agents";
import { Btn, Spinner, useActions } from "./actions";
import { copyText } from "./Drawer";

export function AgentPanel({ api }: { api: AriaApi }) {
  const { toast } = useActions();
  const [conn, setConn] = useState<AgentConnection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reveal, setReveal] = useState(false);

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

  const real = agentSnippets(conn);
  const shown = reveal ? real : agentSnippets({ ...conn, token: maskToken(conn.token) });

  return (
    <div className="agent-panel">
      <p className="lede">
        Let Codex, Claude Code or Aria Code pick up approved tasks through the Aria Live MCP bridge.
      </p>
      <p className="callout callout--info">
        The agent can claim <strong>approved</strong> tasks and report progress; it can never approve, reject or vote.
      </p>
      <div className="agent-panel__meta">
        <span>
          MCP URL <code>{conn.mcpUrl}</code>
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
      <p className="muted">Keep the token off stream — it lets an agent act on approved tasks.</p>
    </div>
  );
}
