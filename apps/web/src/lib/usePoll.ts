import { useCallback, useEffect, useRef, useState } from 'react';

export interface Poll<T> {
  data: T | null;
  /** The last request failed; `data` still holds the previous good answer. */
  error: unknown;
  loading: boolean;
  reload(): void;
}

/**
 * Calls `fn` now and every `everyMs` while mounted. A newer call wins; results of unmounted or superseded calls are dropped.
 * While the tab is hidden the interval skips its calls; when the tab shows again it calls `fn` at once.
 */
export function usePoll<T>(fn: () => Promise<T>, everyMs: number | null): Poll<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const seq = useRef(0);
  const alive = useRef(true);

  const run = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const next = await fnRef.current();
      if (!alive.current || mine !== seq.current) return;
      setData(next);
      setError(null);
    } catch (err) {
      if (!alive.current || mine !== seq.current) return;
      setError(err);
    } finally {
      if (alive.current && mine === seq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void run();
    if (everyMs === null) {
      return () => {
        alive.current = false;
      };
    }
    const timer = window.setInterval(() => {
      if (!document.hidden) void run();
    }, everyMs);
    const onVisible = () => {
      if (!document.hidden) void run();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive.current = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [run, everyMs]);

  return { data, error, loading, reload: () => void run() };
}
