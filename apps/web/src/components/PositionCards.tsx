import type { DashboardPosition } from '../api.js';
import { fmtPct, fmtPrice, pnlDir, signed } from '../lib/format.js';
import { useI18n } from '../i18n/index.js';
import { Icon } from './Icon.js';
import './grid-table.css';
import './position-cards.css';

const EM_DASH = '—';

const DIR_ICON = { up: 'caret-up', down: 'caret-down', flat: 'minus' } as const;
const DIR_CLASS = { up: 'pnl-up', down: 'pnl-down', flat: 'pnl-flat' } as const;

/** PnL always pairs a sign, an icon and a colour class — never colour alone. */
function Pnl({ value }: { value: string | null }) {
  const dir = pnlDir(value);
  if (value === null) return <span className={DIR_CLASS.flat}>{EM_DASH}</span>;
  return (
    <span className={DIR_CLASS[dir]}>
      <Icon name={DIR_ICON[dir]} /> {signed(value)}
    </span>
  );
}

export function PositionCards({ positions }: { positions: DashboardPosition[] }) {
  const { t } = useI18n();
  if (positions.length === 0) return null;

  return (
    <div className="position-cards">
      {positions.map((p) => {
        const sideIcon = p.side === 'long' ? 'arrow-trend-up' : 'arrow-trend-down';
        const sideLabel = p.side === 'long' ? t('long') : t('short');
        const marketLabel = p.market === 'spot' ? t('spot') : t('futures');
        const sub =
          p.market === 'futures' && p.leverage !== null
            ? `${sideLabel} · ${marketLabel} · ${p.leverage}x`
            : `${sideLabel} · ${marketLabel}`;
        const changeDir = pnlDir(p.change24hPct);
        return (
          <article className="position-card" key={`${p.strategyId}-${p.openedAt}`}>
            <div className="position-card-top">
              <div className="position-card-id">
                <span className="position-card-pair">{p.pair}</span>
                <span className="position-card-sub">
                  <Icon name={sideIcon} /> {sub}
                </span>
              </div>
              <div className="position-card-pnl">
                <Pnl value={p.unrealizedPnl} />
                {p.unrealizedPnlPct !== null && (
                  <span className={`position-card-pnl-pct ${DIR_CLASS[pnlDir(p.unrealizedPnl)]}`}>
                    {fmtPct(p.unrealizedPnlPct)}
                  </span>
                )}
              </div>
            </div>
            <div className="position-card-grid">
              <div className="position-card-cell">
                <span className="position-card-label">{t('entry')}</span>
                <span className="position-card-value">{fmtPrice(p.entryPrice)}</span>
              </div>
              <div className="position-card-cell">
                <span className="position-card-label">{t('mark')}</span>
                <span className="position-card-value">
                  {fmtPrice(p.markPrice)}
                  {p.change24hPct !== null && (
                    <span className={`position-card-chg ${DIR_CLASS[changeDir]}`}>
                      <Icon name={DIR_ICON[changeDir]} /> {fmtPct(p.change24hPct)}
                    </span>
                  )}
                </span>
              </div>
              <div className="position-card-cell">
                <span className="position-card-label">{t('stop')}</span>
                <span className="position-card-value">{fmtPrice(p.stopPrice)}</span>
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}
