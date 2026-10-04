import type { TradeSummary } from '../api.js';
import { exitReasonView } from '../lib/exitReason.js';
import { fmtDateTime, fmtPrice, pnlDir, signed } from '../lib/format.js';
import { useI18n } from '../i18n/index.js';
import { Icon } from './Icon.js';
import './grid-table.css';
import './trades-table.css';

export function TradesTable({ trades, onOpen }: { trades: TradeSummary[]; onOpen(id: number): void }) {
  const { t } = useI18n();
  if (trades.length === 0) return null;

  return (
    <div className="gt-scroll">
      <div className="gt-head trades-head">
        <span>{t('time')}</span>
        <span>{t('pair')}</span>
        <span>{t('market')}</span>
        <span>{t('side')}</span>
        <span>{t('entryExit')}</span>
        <span className="gt-num">{t('rpnl')}</span>
        <span>{t('exitReason')}</span>
        <span />
      </div>
      {trades.map((trade) => {
        const dir = pnlDir(trade.netPnl);
        const pnlIcon = dir === 'up' ? 'caret-up' : dir === 'down' ? 'caret-down' : 'minus';
        const reason = exitReasonView(trade.exitReason, t);
        return (
          <button
            key={trade.id}
            type="button"
            className="gt-row trades-row"
            aria-label={`${trade.pair} ${fmtDateTime(trade.closedAt)}`}
            onClick={() => onOpen(trade.id)}
          >
            <span className="trades-time">{fmtDateTime(trade.closedAt)}</span>
            <span className="gt-strong">{trade.pair}</span>
            <span>{trade.market === 'spot' ? t('spot') : t('futures')}</span>
            <span className="trades-side">
              <Icon name={trade.side === 'long' ? 'arrow-trend-up' : 'arrow-trend-down'} />
              {trade.side === 'long' ? t('long') : t('short')}
            </span>
            <span className="trades-range">
              {fmtPrice(trade.entryPrice)} → {fmtPrice(trade.exitPrice)}
            </span>
            <span className={`gt-num pnl-${dir}`}>
              <Icon name={pnlIcon} />
              {signed(trade.netPnl)}
            </span>
            <span className="trades-reason">
              <Icon name={reason.icon} family={reason.family} />
              {reason.label}
            </span>
            <span className="trades-chevron">
              <Icon name="chevron-right" />
            </span>
          </button>
        );
      })}
    </div>
  );
}
