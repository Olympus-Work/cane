import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Icon } from './Icon.js';

const AUTO_HIDE_MS = 2600;

interface ToastCtx {
  show(message: string): void;
}

const Ctx = createContext<ToastCtx | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<number | null>(null);
  const clearTimer = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);
  const show = useCallback(
    (msg: string) => {
      clearTimer();
      setMessage(msg);
      timer.current = window.setTimeout(() => {
        timer.current = null;
        setMessage(null);
      }, AUTO_HIDE_MS);
    },
    [clearTimer],
  );
  useEffect(() => clearTimer, [clearTimer]);
  const value = useMemo(() => ({ show }), [show]);
  return (
    <Ctx.Provider value={value}>
      {children}
      {message ? (
        <div className="toast" role="status" aria-live="polite">
          <Icon name="circle-check" className="toast-icon" />
          {message}
        </div>
      ) : null}
    </Ctx.Provider>
  );
}

export function useToast(): ToastCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useToast needs a ToastProvider');
  return v;
}
