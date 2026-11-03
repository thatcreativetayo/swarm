import { useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "./api.js";

export interface UseApiResult<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  refresh: () => void;
  setData: (value: T | null) => void;
}

export function useApi<T>(
  path: string | null,
  deps: unknown[] = [],
  options: { pollMs?: number } = {},
): UseApiResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const [tick, setTick] = useState(0);
  const key = path ? `${path}::${JSON.stringify(deps)}` : "";
  const pollMs = options.pollMs ?? 0;

  const refresh = useCallback(() => setTick((value) => value + 1), []);

  useEffect(() => {
    if (!path) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();

    const load = async (silent: boolean) => {
      if (!silent) setLoading(true);
      try {
        const result = await api<T>(path, { signal: controller.signal });
        if (cancelled) return;
        setData(result);
        setError(null);
      } catch (caught) {
        if (cancelled || (caught as Error).name === "AbortError") return;
        setError(errorMessage(caught));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load(false);
    const timer = pollMs > 0 ? setInterval(() => void load(true), pollMs) : null;
    return () => {
      cancelled = true;
      controller.abort();
      if (timer) clearInterval(timer);
    };
  }, [key, tick, pollMs]);

  return { data, error, loading, refresh, setData };
}
