import type { DashboardPosition } from '../api.js';
import { fmtPct, fmtPrice, fmtQty, pnlDir, signed } from '../lib/format.js';
import { useI18n } from '../i18n/index.js';
import { Icon } from './Icon.js';
import './grid-table.css';
import './positions-table.css';

const EM_DASH = '—';

const DIR_ICON = { up: 'caret-up', down: 'caret-down', flat: 'minus' } as const;
const DIR_CLASS = { up: 'pnl-up', down: 'pnl-down', flat: 'pnl-flat' } as const;

/** PnL always pairs a sign, an icon and a colour class — never colour alone. */
function Pnl({ value, extra }: { value: string | null; extra?: string }) {
  const dir = pnlDir(value);
  if (value === null) return <span className={DIR_CLASS.flat}>{EM_DASH}</span>;
  return (
    <span className={DIR_CLASS[dir]}>
      <Icon name={DIR_ICON[dir]} /> {signed(value)}
      {extra ? ` (${extra})` : ''}
    </span>
  );
}

export function PositionsTable({ positions }: { positions: DashboardPosition[] }) {
  const { t } = useI18n();
  if (positions.length === 0) return null;

  const head = [t('pair'), t('market'), t('side'), t('qty'), t('entry'), t('markChg'), t('upnl'), t('stop'), t('tp'), t('liq'), t('lev')];

  return (
    <div className="gt-scroll">
      <div className="positions-table">
        <div className="gt-head">
          {head.map((label, i) => (
            <span key={i} className={i < 3 ? undefined : 'gt-num'}>
              {label}
            </span>
          ))}
        </div>
        {positions.map((p) => {
          const sideIcon = p.side === 'long' ? 'arrow-trend-up' : 'arrow-trend-down';
          const sideLabel = p.side === 'long' ? t('long') : t('short');
          const marketLabel = p.market === 'spot' ? t('spot') : t('futures');
          const changeDir = pnlDir(p.change24hPct);
          const leverage = p.market === 'spot' || p.leverage === null ? EM_DASH : `${p.leverage}x`;
          return (
            <div className="gt-row" key={`${p.strategyId}-${p.openedAt}`}>
              <span className="gt-strong">{p.pair}</span>
              <span>{marketLabel}</span>
              <span>
                <Icon name={sideIcon} /> {sideLabel}
              </span>
              <span className="gt-num">{fmtQty(p.qty)}</span>
              <span className="gt-num">{fmtPrice(p.entryPrice)}</span>
              <span className="gt-num">
                <span>{fmtPrice(p.markPrice)}</span>
                <span className={`gt-sub ${p.change24hPct === null ? 'pnl-flat' : DIR_CLASS[changeDir]}`}>
                  {p.change24hPct === null ? EM_DASH : (
                    <>
                      <Icon name={DIR_ICON[changeDir]} /> {fmtPct(p.change24hPct)}
                    </>
                  )}
                </span>
              </span>
              <span className="gt-num">
                <Pnl value={p.unrealizedPnl} extra={fmtPct(p.unrealizedPnlPct)} />
              </span>
              <span className="gt-num">{fmtPrice(p.stopPrice)}</span>
              <span className="gt-num">{fmtPrice(p.takeProfitPrice)}</span>
              <span className="gt-num">{fmtPrice(p.liquidationPrice)}</span>
              <span className="gt-num">{leverage}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
