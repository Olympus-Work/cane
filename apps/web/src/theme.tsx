import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type Theme = 'dark' | 'light';
const STORAGE_KEY = 'cane.theme';

function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'dark' || saved === 'light') return saved;
  } catch {
    /* storage blocked: fall through */
  }
  return 'dark'; // dark is the default (design handoff)
}

interface ThemeCtx {
  theme: Theme;
  toggle(): void;
}
const Ctx = createContext<ThemeCtx | null>(null);

/** Dark is `:root`; light is the `.light` class on `<html>` (and on portalled overlays, which live under `<html>` too). */
export function ThemeProvider({ children, initial }: { children: ReactNode; initial?: Theme }) {
  const [theme, setTheme] = useState<Theme>(initial ?? initialTheme());
  useEffect(() => {
    document.documentElement.classList.toggle('light', theme === 'light');
  }, [theme]);
  const toggle = useCallback(() => {
    setTheme((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark';
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        /* storage blocked: the choice lasts until reload */
      }
      return next;
    });
  }, []);
  const value = useMemo(() => ({ theme, toggle }), [theme, toggle]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheme(): ThemeCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useTheme needs a ThemeProvider');
  return v;
}
