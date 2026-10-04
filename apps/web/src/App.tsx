import { useCallback, useEffect, useState } from 'react';
import { ApiError, listSessions, readDashboard, type Dashboard as DashboardData, type KillResult } from './api.js';
import { Button } from './components/Button.js';
import { Icon } from './components/Icon.js';
import { LangSwitch, ThemeToggle } from './components/HeaderControls.js';
import { KillModal } from './components/KillModal.js';
import { useI18n } from './i18n/index.js';
import { useIsMobile } from './lib/useIsMobile.js';
import { usePoll } from './lib/usePoll.js';
import { Dashboard, type Page } from './pages/Dashboard.js';
import { KillSwitch } from './pages/KillSwitch.js';
import { Login } from './pages/Login.js';
import { Settings } from './pages/Settings.js';
import { Strategies } from './pages/Strategies.js';
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

const NAV: { page: Page; icon: string; label: string }[] = [
  { page: 'dashboard', icon: 'gauge', label: 'dashboard' },
  { page: 'strategies', icon: 'chess-knight', label: 'strategies' },
  { page: 'settings', icon: 'gear', label: 'settings' },
];

/** Header, kill switch, the "Trading stopped" banner, and the page router. The dashboard poll lives here so the status pill and the page share it. */
function Shell({ onSignedOut }: { onSignedOut(): void }) {
  const { t } = useI18n();
  const mobile = useIsMobile();
  const [requested, setPage] = useState<Page>('dashboard');
  const [killOpen, setKillOpen] = useState(false);
  const [killResult, setKillResult] = useState<KillResult | null>(null);
  const poll = usePoll<DashboardData>(readDashboard, 10_000);

  // A 401 from the poll means the session ended while the page was open.
  useEffect(() => {
    if (poll.error instanceof ApiError && poll.error.status === 401) onSignedOut();
  }, [poll.error, onSignedOut]);

  const page: Page = mobile && (requested === 'strategies' || requested === 'settings') ? 'dashboard' : requested;
  const killed = killResult !== null || poll.data?.status === 'stopped_by_kill_switch';
  const pill = killed ? 'stoppedKill' : poll.data?.status === 'exchange_unreachable' || poll.error !== null ? 'unreachable' : 'running';
  const pillIcon = pill === 'running' ? 'circle-check' : pill === 'stoppedKill' ? 'circle-stop' : 'plug-circle-xmark';

  return (
    <div className="shell">
      <header className="shell-header">
        <div className="shell-brand">
          <Icon name="wave-square" />
          <span>Cane</span>
        </div>
        {mobile ? null : (
          <nav className="shell-nav" aria-label="Main">
            {NAV.map((n) => (
              <button key={n.page} type="button" className={`shell-nav-item${page === n.page ? ' shell-nav-active' : ''}`} aria-current={page === n.page ? 'page' : undefined} onClick={() => setPage(n.page)}>
                <Icon name={n.icon} /> {t(n.label)}
              </button>
            ))}
          </nav>
        )}
        <div className="shell-spacer" />
        <span className={`status-pill status-${pill}`} role="status" aria-label={t('statusPillLabel')}>
          <Icon name={pillIcon} /> <span className="status-pill-text">{t(pill)}</span>
        </span>
        <LangSwitch />
        <ThemeToggle />
        {mobile ? null : (
          <>
            <span className="shell-divider" aria-hidden="true" />
            <button type="button" className="kill-button" onClick={() => setKillOpen(true)}>
              <Icon name="power-off" /> {t('killSwitch')}
            </button>
          </>
        )}
      </header>

      {killed ? (
        <div className="kill-banner" role="alert">
          <Icon name="circle-stop" />
          <div className="kill-banner-text">
            <strong>{t('tradingStopped')}</strong>
            <span>{t('tradingStoppedSub')}</span>
          </div>
          {mobile ? null : (
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPage('strategies')}>
              {t('goStrategies')}
            </button>
          )}
        </div>
      ) : null}

      <main className="shell-main">
        {page === 'dashboard' ? <Dashboard poll={poll} onNavigate={setPage} /> : null}
        {page === 'strategies' ? (
          <Strategies
            onEnabled={() => {
              setKillResult(null);
              poll.reload();
            }}
          />
        ) : null}
        {page === 'settings' ? <Settings onSignedOut={onSignedOut} /> : null}
        {page === 'killswitch' ? <KillSwitch result={killResult} onRequestKill={() => setKillOpen(true)} onNavigate={setPage} /> : null}
      </main>

      {mobile ? (
        <div className="kill-bar">
          <button type="button" className="kill-bar-button" onClick={() => setKillOpen(true)}>
            <Icon name="power-off" /> {t('killSwitch')}
          </button>
        </div>
      ) : null}

      {killOpen ? (
        <KillModal
          onClose={() => setKillOpen(false)}
          onDone={(r) => {
            setKillResult(r);
            setKillOpen(false);
            setPage('killswitch');
            poll.reload();
          }}
        />
      ) : null}
    </div>
  );
}
