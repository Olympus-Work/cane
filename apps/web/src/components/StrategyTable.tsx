import type { StrategyItem } from '../api.js';
import { fmtPct, fmtPrice, fmtQty, pnlDir, signed } from '../lib/format.js';
import { useI18n } from '../i18n/index.js';
import { Badge } from './Badge.js';
import { Button } from './Button.js';
import { Icon } from './Icon.js';
import { Sparkline } from './Sparkline.js';
import './grid-table.css';
import './strategy-table.css';

export interface StrategyActions {
  onEnable(s: StrategyItem): void;
  onDisable(s: StrategyItem): void;
  onEdit(s: StrategyItem): void;
  onClose(s: StrategyItem): void;
}

function StateBadge({ s }: { s: StrategyItem }) {
  const { t } = useI18n();
  switch (s.status) {
    case 'closed':
      return (
        <span className="badge badge-neutral">
          <Icon name="flag-checkered" />
          {t('st_closed')}
        </span>
      );
    case 'needs_attention':
      return (
        <Badge color="orange" icon="triangle-exclamation">
          {t('st_attention')}
        </Badge>
      );
    case 'disabled':
      return (
        <span className="badge badge-neutral">
          <Icon name="pause" />
          {t('st_disabled')}
        </span>
      );
    case 'enabled':
      return s.position ? (
        <Badge color="green" icon="circle-dot">
          {t('st_inPos')}
        </Badge>
      ) : (
        <Badge color="purple" icon="clock">
          {t('st_waiting')}
        </Badge>
      );
  }
}

export function StrategyTable({ items, actions }: { items: StrategyItem[]; actions: StrategyActions }) {
  const { t } = useI18n();
  if (items.length === 0) return null;

  return (
    <div>
      {items.map((s) => {
        const chgDir = pnlDir(s.change24hPct);
        const chgIcon = chgDir === 'up' ? 'caret-up' : chgDir === 'down' ? 'caret-down' : 'minus';
        const pnlDir30 = pnlDir(s.pnl30d.total);
        const pnlIcon = pnlDir30 === 'up' ? 'caret-up' : pnlDir30 === 'down' ? 'caret-down' : 'minus';
        const sizingLabel =
          s.market === 'spot' ? null : s.sizingMode === 'A' ? 'A · margin' : s.sizingMode === 'B' ? 'B · notional' : 'C · risk';
        const leverage =
          s.market === 'spot' || s.leverageCeiling === null
            ? null
            : s.leverageInUse !== null && s.leverageInUse !== s.leverageCeiling
              ? `${s.leverageCeiling}x (${s.leverageInUse}x)`
              : `${s.leverageCeiling}x`;
        const marginLabel = s.marginMode === 'isolated' ? t('isolated') : s.marginMode === 'cross' ? t('cross') : null;
        // Line 2 settings, e.g. "Futures · B · notional · 5x · Isolated"; spot has no sizing, leverage or margin mode.
        const meta = [s.market === 'spot' ? t('spot') : t('futures'), sizingLabel, leverage, marginLabel]
          .filter((v) => v !== null)
          .join(' · ');
        return (
          <div key={s.id} className="gt-row strat-row">
            <div className="strat-line">
              <span>
                <span className="gt-strong">{s.pair}</span>
                <span className="gt-sub mono">{s.id}</span>
              </span>
              <span className="gt-num strat-price">
                <span className="mono" style={{ fontWeight: 500 }}>
                  {fmtPrice(s.price)}
                </span>
                <span className={`gt-sub pnl-${chgDir}`}>
                  <Icon name={chgIcon} />
                  {fmtPct(s.change24hPct)}
                </span>
              </span>
              <span>
                <StateBadge s={s} />
                {s.status === 'needs_attention' && s.attentionReason ? (
                  <span className="gt-sub strat-note">{s.attentionReason}</span>
                ) : null}
              </span>
              <span>
                <span className="gt-sub">{t('position')}</span>
                <span className="mono strat-pos">
                  {s.position
                    ? `${s.position.side === 'long' ? t('long') : t('short')} ${fmtQty(s.position.qty)} @ ${fmtPrice(s.position.entryPrice)}`
                    : '—'}
                </span>
              </span>
              <span>
                <span className="gt-sub">{t('pnl30')}</span>
                <span className="strat-pnl">
                  <Sparkline values={s.pnl30d.daily.map((d) => d.pnl)} total={s.pnl30d.total} />
                  <span className={`mono pnl-${pnlDir30}`} style={{ fontWeight: 500 }}>
                    <Icon name={pnlIcon} />
                    {signed(s.pnl30d.total)}
                  </span>
                </span>
              </span>
            </div>
            <div className="strat-line-2">
              <span className="strat-meta">{meta}</span>
              <span className="strat-actions">
                {s.status === 'disabled' ? (
                  <Button variant="primary" size="sm" icon="play" onClick={() => actions.onEnable(s)}>
                    {t('enable')}
                  </Button>
                ) : null}
                {s.status === 'enabled' || s.status === 'needs_attention' ? (
                  <Button variant="secondary" size="sm" icon="pause" onClick={() => actions.onDisable(s)}>
                    {t('disable')}
                  </Button>
                ) : null}
                {s.status !== 'closed' ? (
                  <>
                    <Button variant="ghost" size="sm" icon="pen" onClick={() => actions.onEdit(s)}>
                      {t('edit')}
                    </Button>
                    <Button variant="secondary" size="sm" icon="xmark" className="strategy-close" onClick={() => actions.onClose(s)}>
                      {t('close')}
                    </Button>
                  </>
                ) : null}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
