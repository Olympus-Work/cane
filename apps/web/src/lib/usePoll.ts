import { useCallback, useEffect, useRef, useState } from 'react';

export interface Poll<T> {
  data: T | null;
  /** The last request failed; `data` still holds the previous good answer. */
  error: unknown;
  loading: boolean;
  reload(): void;
}

/** Calls `fn` now and every `everyMs` while mounted. A newer call wins; results of unmounted or superseded calls are dropped. */
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
    const timer = everyMs === null ? null : window.setInterval(() => void run(), everyMs);
    return () => {
      alive.current = false;
      if (timer !== null) window.clearInterval(timer);
    };
  }, [run, everyMs]);

  return { data, error, loading, reload: () => void run() };
}
