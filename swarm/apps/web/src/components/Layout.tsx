import { useEffect, useState, type ReactNode } from "react";
import { useApi } from "../lib/useApi.js";
import { navigate } from "../lib/router.js";
import type { Approval } from "../types.js";
import { useWorkspace } from "../AppContext.js";
import { Icon, type IconName } from "./Icon.js";

interface NavItem {
  label: string;
  path: string;
  icon: IconName;
  match: string[];
  count?: number;
}

const PAGE_TITLES: Record<string, string> = {
  command: "Command",
  run: "Run detail",
  workforce: "Workforce",
  tasks: "Tasks",
  approvals: "Approvals",
  artifacts: "Artifacts",
  activity: "Activity",
  integrations: "Integrations",
  settings: "Settings",
};

export function Layout({ routeName, children }: { routeName: string; children: ReactNode }) {
  const { workspace, workspaces, workspaceId, setWorkspaceId, config } = useWorkspace();
  const [mobileOpen, setMobileOpen] = useState(false);

  const approvals = useApi<{ approvals: Approval[] }>(
    workspaceId ? `/api/workspaces/${encodeURIComponent(workspaceId)}/approvals?status=pending` : null,
    [workspaceId],
    { pollMs: 8000 },
  );
  const pendingCount = approvals.data?.approvals.length ?? 0;

  useEffect(() => {
    setMobileOpen(false);
  }, [routeName]);

  const active = routeName === "run" ? "command" : routeName;

  const groups: Array<{ label: string; items: NavItem[] }> = [
    {
      label: "Workspace",
      items: [
        { label: "Command", path: "/", icon: "command", match: ["command"] },
        { label: "Workforce", path: "/workforce", icon: "users", match: ["workforce"] },
        { label: "Tasks", path: "/tasks", icon: "tasks", match: ["tasks"] },
      ],
    },
    {
      label: "Operations",
      items: [
        {
          label: "Approvals",
          path: "/approvals",
          icon: "approvals",
          match: ["approvals"],
          count: pendingCount,
        },
        { label: "Artifacts", path: "/artifacts", icon: "artifacts", match: ["artifacts"] },
        { label: "Activity", path: "/activity", icon: "activity", match: ["activity"] },
      ],
    },
    {
      label: "System",
      items: [
        { label: "Integrations", path: "/integrations", icon: "integrations", match: ["integrations"] },
        { label: "Settings", path: "/settings", icon: "settings", match: ["settings"] },
      ],
    },
  ];

  const startNewRun = () => {
    navigate("/");
    setTimeout(() => window.dispatchEvent(new Event("swarm:focus-goal")), 60);
  };

  return (
    <div className="shell">
      <aside className={`sidebar${mobileOpen ? " open" : ""}`}>
        <div className="brand">
          <span className="brand-mark">
            <svg viewBox="0 0 64 64" aria-hidden="true">
              <path
                d="M32 9 53 21v22L32 55 11 43V21z"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.6"
                strokeLinejoin="round"
              />
              <circle cx="32" cy="32" r="5" fill="currentColor" />
              <circle cx="32" cy="14" r="2.4" fill="currentColor" />
              <circle cx="47" cy="40" r="2.4" fill="currentColor" />
              <circle cx="17" cy="40" r="2.4" fill="currentColor" />
              <path
                d="M32 27v-8M36.5 35.5l7 4M27.5 35.5l-7 4"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </span>
          <span className="brand-copy">
            <strong>SWARM</strong>
            <small>Autonomous workforce</small>
          </span>
        </div>

        <div className="workspace-switcher">
          <span className="workspace-label">Workspace</span>
          <div className="select-wrap">
            <select
              value={workspaceId}
              onChange={(event) => setWorkspaceId(event.target.value)}
              aria-label="Select workspace"
            >
              {workspaces.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </select>
            <Icon name="chevron-down" size={14} />
          </div>
        </div>

        <nav className="nav">
          {groups.map((group) => (
            <div className="nav-group" key={group.label}>
              <div className="nav-label">{group.label}</div>
              {group.items.map((item) => {
                const isActive = item.match.includes(active);
                return (
                  <button
                    type="button"
                    key={item.path}
                    className={`nav-item${isActive ? " active" : ""}`}
                    onClick={() => navigate(item.path)}
                  >
                    <Icon name={item.icon} size={17} />
                    <span>{item.label}</span>
                    {item.count ? <span className="nav-count">{item.count}</span> : null}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className={`model-state ${config?.llm.configured ? "online" : "offline"}`}>
            <span className="model-dot" />
            <div>
              <strong>{config?.llm.configured ? "Model connected" : "Model not configured"}</strong>
              <small>
                {config?.llm.configured
                  ? `${config.llm.provider} · ${config.llm.model}`
                  : "Add a provider in .env to execute runs"}
              </small>
            </div>
          </div>
          <div className="sidebar-meta">
            <span>
              <Icon name="database" size={13} /> Local SQLite
            </span>
            <span>
              <Icon name={config?.auth.tokenRequired ? "lock" : "shield"} size={13} />
              {config?.auth.tokenRequired ? "Token auth" : "Loopback only"}
            </span>
          </div>
          {workspace ? <div className="sidebar-workspace-id">ws · {workspace.slug}</div> : null}
        </div>
      </aside>

      {mobileOpen ? <div className="sidebar-backdrop" onClick={() => setMobileOpen(false)} /> : null}

      <div className="main">
        <header className="topbar">
          <div className="topbar-left">
            <button
              type="button"
              className="icon-button mobile-menu"
              onClick={() => setMobileOpen(true)}
              aria-label="Open navigation"
            >
              <Icon name="menu" size={20} />
            </button>
            <div className="breadcrumb">
              <span>SWARM</span>
              <Icon name="chevron-right" size={13} />
              <strong>{PAGE_TITLES[routeName] ?? "Command"}</strong>
            </div>
          </div>
          <div className="topbar-right">
            {pendingCount > 0 ? (
              <button type="button" className="approval-chip" onClick={() => navigate("/approvals")}>
                <Icon name="shield" size={15} />
                {pendingCount} approval{pendingCount === 1 ? "" : "s"} waiting
              </button>
            ) : null}
            <span className={`topbar-status ${config?.llm.configured ? "ok" : "warn"}`}>
              <span className="dot" />
              {config?.llm.configured ? "Operational" : "Setup needed"}
            </span>
            <button type="button" className="btn btn-primary btn-sm" onClick={startNewRun}>
              <Icon name="plus" size={15} /> New run
            </button>
          </div>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
