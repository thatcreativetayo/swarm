import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Bootstrap, DomainPack, PublicConfig, Workspace } from "./types.js";
import { useApi } from "./lib/useApi.js";

const WORKSPACE_KEY = "swarm.workspaceId";

interface WorkspaceContextValue {
  bootstrap: Bootstrap | null;
  workspace: Workspace | null;
  workspaces: Workspace[];
  config: PublicConfig | null;
  domainPacks: DomainPack[];
  loading: boolean;
  error: string | null;
  workspaceId: string;
  setWorkspaceId: (id: string) => void;
  refresh: () => void;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

function storedWorkspace(): string {
  try {
    return localStorage.getItem(WORKSPACE_KEY) ?? "";
  } catch {
    return "";
  }
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [workspaceId, setWorkspaceIdState] = useState(storedWorkspace);
  const path = workspaceId
    ? `/api/bootstrap?workspaceId=${encodeURIComponent(workspaceId)}`
    : "/api/bootstrap";
  const { data, error, loading, refresh } = useApi<Bootstrap>(path, [workspaceId]);

  useEffect(() => {
    if (!data) return;
    if (data.workspace.id !== workspaceId) {
      setWorkspaceIdState(data.workspace.id);
      try {
        localStorage.setItem(WORKSPACE_KEY, data.workspace.id);
      } catch {
        // Ignore storage restrictions.
      }
    }
  }, [data, workspaceId]);

  const setWorkspaceId = useCallback((id: string) => {
    setWorkspaceIdState(id);
    try {
      localStorage.setItem(WORKSPACE_KEY, id);
    } catch {
      // Ignore storage restrictions.
    }
  }, []);

  useEffect(() => {
    const onRefresh = () => refresh();
    window.addEventListener("swarm:refresh-bootstrap", onRefresh);
    return () => window.removeEventListener("swarm:refresh-bootstrap", onRefresh);
  }, [refresh]);

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      bootstrap: data,
      workspace: data?.workspace ?? null,
      workspaces: data?.workspaces ?? [],
      config: data?.config ?? null,
      domainPacks: data?.domainPacks ?? [],
      loading,
      error,
      workspaceId: data?.workspace.id ?? workspaceId,
      setWorkspaceId,
      refresh,
    }),
    [data, loading, error, workspaceId, setWorkspaceId, refresh],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceContextValue {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error("useWorkspace must be used inside WorkspaceProvider");
  return context;
}

export function refreshBootstrap(): void {
  window.dispatchEvent(new Event("swarm:refresh-bootstrap"));
}
