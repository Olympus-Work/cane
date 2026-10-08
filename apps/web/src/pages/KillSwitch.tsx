import type { KillResult, KillResultRow } from '../api.js';
import { Button } from '../components/Button.js';
import { Icon } from '../components/Icon.js';
import { useI18n } from '../i18n/index.js';
import { fmtDateTime } from '../lib/format.js';
import type { Page } from './Dashboard.js';
import './dashboard.css';
import './kill-switch.css';

/** Kill switch page (B11, B16): the entry point before it is used, the per-pair result after. */
export function KillSwitch({ result, onRequestKill, onNavigate }: { result: KillResult | null; onRequestKill(): void; onNavigate(page: Page): void }) {
  const { t } = useI18n();

  if (!result) {
    return (
      <div className="page kill-intro">
        <span className="kill-ring" aria-hidden="true">
          <Icon name="power-off" />
        </span>
        <h1 className="page-title">{t('killSwitch')}</h1>
        <p className="page-sub">{t('killIntro')}</p>
        <Button variant="danger" size="lg" icon="power-off" onClick={onRequestKill}>
          {t('killCta')}
        </Button>
      </div>
    );
  }

  const ok = result.results.filter((r) => r.status !== 'failed').length;
  return (
    <div className="page">
      <div>
        <h1 className="page-title kill-title">
          <Icon name="circle-stop" /> {t('tradingStopped')}
        </h1>
        <p className="page-sub">
          {t('killedAt')} <span className="mono">{fmtDateTime(result.activatedAt)}</span>
        </p>
      </div>

      <section className="card card-flush">
        <div className="kill-card-head">
          <h2 className="kill-card-title">{t('perPair')}</h2>
          <span className="mono">{t('killResultCount', { ok, n: result.results.length })}</span>
        </div>
        {result.results.length === 0 ? <p className="kill-empty">{t('killNothing')}</p> : <ul className="kill-rows">{result.results.map((r) => <ResultRow key={`${r.market}-${r.pair}`} row={r} />)}</ul>}
      </section>

      <p className="page-sub">
        <Icon name="shield-halved" />{' '}
        {result.untouched === null
          ? t('killNotTouchedUnknown')
          : result.untouched.length > 0
            ? t('killNotTouched', { n: result.untouched.map((u) => `${u.pair} ${u.market === 'spot' ? t('spot') : t('futures')}`).join(', ') })
            : t('killNotTouchedNone')}
      </p>

      <section className="card">
        <h2 className="kill-card-title">{t('howResume')}</h2>
        <p className="page-sub">{t('howResumeSub')}</p>
        <Button variant="secondary" icon="chess-knight" onClick={() => onNavigate('strategies')}>
          {t('goStrategies')}
        </Button>
      </section>
    </div>
  );
}

function ResultRow({ row }: { row: KillResultRow }) {
  const { t } = useI18n();
  const status =
    row.status === 'closed' ? (
      <span className="pnl-up">
        <Icon name="circle-check" /> {t('killStatusClosed')}
      </span>
    ) : row.status === 'cancelled' ? (
      <span>
        <Icon name="ban" /> {t('killStatusCancelled')}
      </span>
    ) : (
      <span className="kill-failed">
        <Icon name="rotate" spin /> {t('killStatusFailed')}
      </span>
    );
  return (
    <li className="kill-row">
      <span className="gt-strong">
        {row.pair} · {row.market === 'spot' ? t('spot') : t('futures')}
      </span>
      <span className="mono">{row.what}</span>
      {status}
    </li>
  );
}
