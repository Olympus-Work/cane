import { useCallback, useEffect, useState } from 'react';
import { ApiError, listSessions } from './api.js';
import { Button } from './components/Button.js';
import { Icon } from './components/Icon.js';
import { LangSwitch, ThemeToggle } from './components/HeaderControls.js';
import { useI18n } from './i18n/index.js';
import { Login } from './pages/Login.js';
import { Settings } from './pages/Settings.js';
import './pages/shell.css';

type Phase = 'checking' | 'login' | 'app' | 'unreachable';

/**
 * Session gate + app shell. There is no "am I signed in" endpoint, so the
 * session list doubles as the probe: 200 = signed in, 401 = show Login.
 */
export function App() {
  const { t } = useI18n();
  const [phase, setPhase] = useState<Phase>('checking');

  const check = useCallback(async () => {
    setPhase('checking');
    try {
      await listSessions();
      setPhase('app');
    } catch (err) {
      // Only a 401 means "signed out"; anything unexpected shows the retry screen rather than a login wall.
      setPhase(err instanceof ApiError && err.status === 401 ? 'login' : 'unreachable');
    }
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  if (phase === 'checking') {
    return (
      <div className="shell-center" role="status">
        <Icon name="circle-notch" spin /> <span>{t('syncing')}</span>
      </div>
    );
  }
  if (phase === 'unreachable') {
    return (
      <div className="shell-center">
        <div className="alert alert-amber" role="alert">
          <Icon name="plug-circle-xmark" /> <span>{t('networkError')}</span>
        </div>
        <Button variant="secondary" icon="rotate" onClick={() => void check()}>
          {t('retry')}
        </Button>
      </div>
    );
  }
  if (phase === 'login') return <Login onSignedIn={() => setPhase('app')} />;
  return <Shell onSignedOut={() => setPhase('login')} />;
}

/** Header + the pages that exist so far. Dashboard and Strategies arrive with S10b. */
function Shell({ onSignedOut }: { onSignedOut(): void }) {
  const { t } = useI18n();
  return (
    <div className="shell">
      <header className="shell-header">
        <div className="shell-brand">
          <Icon name="wave-square" />
          <span>Cane</span>
        </div>
        <nav className="shell-nav" aria-label="Main">
          <button type="button" className="shell-nav-item" disabled title={t('comingSoon')}>
            <Icon name="gauge" /> {t('dashboard')}
          </button>
          <button type="button" className="shell-nav-item" disabled title={t('comingSoon')}>
            <Icon name="chess-knight" /> {t('strategies')}
          </button>
          <button type="button" className="shell-nav-item shell-nav-active" aria-current="page">
            <Icon name="gear" /> {t('settings')}
          </button>
        </nav>
        <div className="shell-spacer" />
        <LangSwitch />
        <ThemeToggle />
      </header>
      <main className="shell-main">
        <Settings onSignedOut={onSignedOut} />
      </main>
    </div>
  );
}
