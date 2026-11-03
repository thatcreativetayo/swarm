import { useEffect, useState } from "react";
import { useWorkspace, WorkspaceProvider } from "./AppContext.js";
import { Layout } from "./components/Layout.js";
import { Icon } from "./components/Icon.js";
import { Spinner } from "./components/ui.js";
import { ToastProvider } from "./components/Toast.js";
import { useRoute } from "./lib/router.js";
import { getApiToken, setApiToken } from "./lib/api.js";
import { ActivityPage } from "./pages/ActivityPage.js";
import { ApprovalsPage } from "./pages/ApprovalsPage.js";
import { ArtifactsPage } from "./pages/ArtifactsPage.js";
import { CommandPage } from "./pages/CommandPage.js";
import { IntegrationsPage } from "./pages/IntegrationsPage.js";
import { RunPage } from "./pages/RunPage.js";
import { SettingsPage } from "./pages/SettingsPage.js";
import { TasksPage } from "./pages/TasksPage.js";
import { WorkforcePage } from "./pages/WorkforcePage.js";

function Splash() {
  return (
    <div className="splash">
      <div className="splash-mark">
        <svg viewBox="0 0 64 64" aria-hidden="true">
          <path d="M32 9 53 21v22L32 55 11 43V21z" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round" />
          <circle cx="32" cy="32" r="5" fill="currentColor" />
          <circle cx="32" cy="14" r="2.4" fill="currentColor" />
          <circle cx="47" cy="40" r="2.4" fill="currentColor" />
          <circle cx="17" cy="40" r="2.4" fill="currentColor" />
          <path d="M32 27v-8M36.5 35.5l7 4M27.5 35.5l-7 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </div>
      <div className="splash-copy">
        <strong>SWARM</strong>
        <span>Bringing the workforce online</span>
      </div>
      <Spinner />
    </div>
  );
}

function BootError({ message, onRetry }: { message: string; onRetry: () => void }) {
  const [token, setToken] = useState(getApiToken());
  const save = () => {
    setApiToken(token);
    onRetry();
  };
  return (
    <div className="boot-error">
      <div className="boot-card">
        <span className="boot-icon"><Icon name="alert" size={26} /></span>
        <h1>Cannot open the command center</h1>
        <p>{message}</p>
        <div className="boot-steps">
          <div><strong>1.</strong> Confirm the API is running: <code>pnpm dev:api</code></div>
          <div><strong>2.</strong> If <code>SWARM_API_TOKEN</code> is set, paste it below.</div>
          <div><strong>3.</strong> Check the browser console and API logs for details.</div>
        </div>
        <label className="field">
          <span>API bearer token (optional)</span>
          <input
            className="input"
            type="password"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder="SWARM_API_TOKEN"
            autoComplete="off"
          />
        </label>
        <div className="boot-actions">
          <button type="button" className="btn btn-primary" onClick={save}>
            <Icon name="key" size={15} /> Save token & retry
          </button>
          <button type="button" className="btn btn-ghost" onClick={onRetry}>
            <Icon name="refresh" size={15} /> Retry
          </button>
        </div>
      </div>
    </div>
  );
}

function Routes() {
  const route = useRoute();
  const { bootstrap, loading, error, refresh } = useWorkspace();

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
    const titles: Record<string, string> = {
      command: "Command",
      run: "Run",
      workforce: "Workforce",
      tasks: "Tasks",
      approvals: "Approvals",
      artifacts: "Artifacts",
      activity: "Activity",
      integrations: "Integrations",
      settings: "Settings",
    };
    document.title = `SWARM · ${titles[route.name] ?? "Command"}`;
  }, [route.name, route.params.id]);

  if (loading && !bootstrap) return <Splash />;
  if (!bootstrap) {
    return <BootError message={error ?? "The SWARM API did not return a workspace."} onRetry={refresh} />;
  }

  return (
    <Layout routeName={route.name}>
      {route.name === "command" ? <CommandPage /> : null}
      {route.name === "run" && route.params.id ? <RunPage runId={route.params.id} /> : null}
      {route.name === "workforce" ? <WorkforcePage /> : null}
      {route.name === "tasks" ? <TasksPage /> : null}
      {route.name === "approvals" ? <ApprovalsPage /> : null}
      {route.name === "artifacts" ? <ArtifactsPage /> : null}
      {route.name === "activity" ? <ActivityPage /> : null}
      {route.name === "integrations" ? <IntegrationsPage /> : null}
      {route.name === "settings" ? <SettingsPage /> : null}
    </Layout>
  );
}

export function App() {
  return (
    <ToastProvider>
      <WorkspaceProvider>
        <Routes />
      </WorkspaceProvider>
    </ToastProvider>
  );
}
