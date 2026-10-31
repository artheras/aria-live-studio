import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LiveState } from "@aria-live/shared";
import { ApiRequestError, createApi, errorMessage, type AriaApi, type Me } from "../lib/api";
import { useLive, type LiveStatus } from "../lib/useLive";
import { ActionsProvider, Btn, Spinner, useActions } from "./actions";
import { AgentPanel } from "./AgentPanel";
import { Drawer } from "./Drawer";
import { Header, Logo } from "./Header";
import { IdeasPanel } from "./IdeasPanel";
import { RoundControl } from "./RoundControl";
import { SettingsForm } from "./SettingsDrawer";
import { ActivityFeed, CommandHelp, StatsStrip } from "./Side";

export interface DashboardViewProps {
  state: LiveState | null;
  live: LiveStatus;
  me: Me;
  api: AriaApi;
  clockOffset?: number;
  onLogout?: () => void;
}

/** Pure view of the console for a given state — what the tests render. */
export function DashboardView(props: DashboardViewProps) {
  return (
    <ActionsProvider>
      <DashboardInner {...props} />
    </ActionsProvider>
  );
}

function DashboardInner({ state, live, me, api, clockOffset = 0, onLogout }: DashboardViewProps) {
  const { run } = useActions();
  const [drawer, setDrawer] = useState<"settings" | "agent" | null>(null);
  const close = useCallback(() => setDrawer(null), []);

  if (!state) {
    return (
      <div className="screen-center">
        <Spinner />
        <p className="muted">Connecting to the Aria server…</p>
      </div>
    );
  }

  const logout = () =>
    run("logout", async () => {
      await api.logout();
      onLogout?.();
    });

  return (
    <div className="studio">
      <Header
        connection={state.connection}
        live={live}
        me={me}
        api={api}
        onSettings={() => setDrawer("settings")}
        onAgent={() => setDrawer("agent")}
        onLogout={logout}
      />
      {state.connection.state === "error" && state.connection.error && (
        <p className="banner banner--bad" role="alert">
          Twitch: {state.connection.error}
        </p>
      )}
      <StatsStrip stats={state.stats} />
      <main className="grid">
        <div className="grid__main">
          <RoundControl
            round={state.round}
            settings={state.settings}
            me={me}
            api={api}
            clockOffset={clockOffset}
            onConnectAgent={() => setDrawer("agent")}
          />
        </div>
        <div className="grid__ideas">
          <IdeasPanel round={state.round} api={api} maxIdeas={state.settings.maxIdeasPerRound} />
        </div>
        <div className="grid__side">
          <ActivityFeed activity={state.activity ?? []} />
          <CommandHelp />
        </div>
      </main>
      <Drawer open={drawer === "settings"} title="Settings" onClose={close}>
        <SettingsForm settings={state.settings} me={me} api={api} onDone={close} />
      </Drawer>
      <Drawer open={drawer === "agent"} title="Connect a coding agent" onClose={close} wide>
        <AgentPanel api={api} />
      </Drawer>
    </div>
  );
}

function LiveDashboard({ me, api, onLogout }: { me: Me; api: AriaApi; onLogout: () => void }) {
  const live = useLive("dashboard");
  const [initial, setInitial] = useState<LiveState | null>(null);
  useEffect(() => {
    // Paint immediately from REST; the socket snapshot takes over when it lands.
    api.state().then(setInitial, () => undefined);
  }, [api]);
  return (
    <DashboardView
      state={live.state ?? initial}
      live={live.status}
      me={me}
      api={api}
      clockOffset={live.clockOffset}
      onLogout={onLogout}
    />
  );
}

export function SetupSteps() {
  return (
    <ol className="setup">
      <li>
        Create an app at <a href="https://dev.twitch.tv/console/apps" target="_blank" rel="noreferrer">dev.twitch.tv/console</a>.
      </li>
      <li>
        Set its OAuth redirect URL to <code>http://localhost:3000/auth/twitch/callback</code>.
      </li>
      <li>
        Put <code>TWITCH_CLIENT_ID</code> and <code>TWITCH_CLIENT_SECRET</code> in <code>.env</code> at the repo root.
      </li>
      <li>Restart the server and reload this page.</li>
    </ol>
  );
}

export function LoginScreen({ configured }: { configured: boolean | null }) {
  return (
    <div className="screen-center">
      <div className="login">
        <Logo />
        <h1>Let chat decide what gets built.</h1>
        <p className="muted">
          Viewers pitch ideas with <code>!idea</code>, vote with <code>!vote</code>, Aria plans the winner, you approve,
          and it gets built live.
        </p>
        {configured === false ? (
          <>
            <p className="callout callout--warn">Twitch isn't configured on this server yet.</p>
            <SetupSteps />
          </>
        ) : (
          <>
            <a className="btn btn--primary btn--lg btn--twitch" href="/auth/twitch/login">
              Connect Twitch
            </a>
            {configured === null && (
              <details className="details">
                <summary>First time? Setup steps</summary>
                <SetupSteps />
              </details>
            )}
          </>
        )}
      </div>
    </div>
  );
}

type AuthState =
  | { kind: "loading" }
  | { kind: "signed_out"; configured: boolean | null }
  | { kind: "ready"; me: Me }
  | { kind: "error"; message: string };

export function useAuth() {
  const [auth, setAuth] = useState<AuthState>({ kind: "loading" });
  const csrf = useRef<string | null>(null);
  const api = useMemo(() => createApi(() => csrf.current), []);

  const load = useCallback(async () => {
    setAuth({ kind: "loading" });
    try {
      const me = await api.me();
      csrf.current = me.csrf;
      if (!me.user) setAuth({ kind: "signed_out", configured: me.configured });
      else setAuth({ kind: "ready", me });
    } catch (err) {
      if (err instanceof ApiRequestError && (err.status === 401 || err.status === 403)) {
        const body = err.body as { configured?: unknown; csrf?: unknown } | null;
        if (body && typeof body.csrf === "string") csrf.current = body.csrf;
        const configured =
          body && typeof body.configured === "boolean" ? body.configured : err.code === "not_configured" ? false : null;
        setAuth({ kind: "signed_out", configured });
      } else {
        setAuth({ kind: "error", message: errorMessage(err) });
      }
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  return { auth, api, reload: load };
}

export function DashboardPage() {
  const { auth, api, reload } = useAuth();
  if (auth.kind === "loading")
    return (
      <div className="screen-center">
        <Spinner />
      </div>
    );
  if (auth.kind === "signed_out") return <LoginScreen configured={auth.configured} />;
  if (auth.kind === "error")
    return (
      <div className="screen-center">
        <div className="login">
          <Logo />
          <p className="callout callout--bad">{auth.message}</p>
          <Btn variant="primary" onClick={() => void reload()}>
            Retry
          </Btn>
        </div>
      </div>
    );
  return <LiveDashboard me={auth.me} api={api} onLogout={() => window.location.assign("/")} />;
}
