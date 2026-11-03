import { useCallback, useEffect, useRef, useState } from "react";
import type { RunDetail, RunSnapshot } from "../types.js";
import { api, errorMessage, streamRunEvents } from "./api.js";
import { isTerminal } from "./format.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Loads a run and keeps it live. Prefers the authenticated SSE endpoint and
 * falls back to polling if the stream cannot be established.
 */
export function useRunLive(runId: string | null) {
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(runId));
  const mounted = useRef(true);
  const terminal = useRef(false);

  const refresh = useCallback(
    async (silent = true) => {
      if (!runId) return;
      if (!silent) setLoading(true);
      try {
        const next = await api<RunDetail>(`/api/runs/${encodeURIComponent(runId)}`);
        if (!mounted.current) return;
        setDetail(next);
        terminal.current = isTerminal(next.run.status);
        setError(null);
      } catch (caught) {
        if (!mounted.current) return;
        setError(errorMessage(caught));
      } finally {
        if (mounted.current) setLoading(false);
      }
    },
    [runId],
  );

  useEffect(() => {
    mounted.current = true;
    terminal.current = false;
    if (!runId) {
      setDetail(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    const controllers = new Set<AbortController>();

    const connect = async () => {
      while (!cancelled && !terminal.current) {
        const controller = new AbortController();
        controllers.add(controller);
        try {
          await streamRunEvents(runId, controller.signal, (event, data) => {
            if (cancelled) return;
            if (event === "snapshot") {
              try {
                const snapshot = JSON.parse(data) as RunSnapshot;
                setDetail((previous) =>
                  previous
                    ? { ...previous, ...snapshot, workspace: previous.workspace, modelCalls: previous.modelCalls }
                    : { ...snapshot, workspace: null, modelCalls: [] },
                );
                setError(null);
                if (isTerminal(snapshot.run.status)) terminal.current = true;
              } catch {
                // Ignore malformed snapshot frames; the next poll repairs state.
              }
            } else if (event === "stream_end") {
              terminal.current = true;
            }
          });
          if (cancelled) return;
          if (terminal.current) {
            await refresh(true);
            return;
          }
          await sleep(1200);
        } catch (caught) {
          if (cancelled || controller.signal.aborted) return;
          setError(errorMessage(caught));
          await sleep(2500);
        } finally {
          controllers.delete(controller);
        }
      }
    };

    void (async () => {
      await refresh(false);
      if (!cancelled && !terminal.current) await connect();
    })();

    return () => {
      cancelled = true;
      for (const controller of controllers) controller.abort();
      mounted.current = false;
    };
  }, [runId, refresh]);

  return { detail, error, loading, refresh: () => void refresh(true) };
}
