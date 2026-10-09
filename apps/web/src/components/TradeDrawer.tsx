import { useEffect, useId, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Decimal } from 'decimal.js';
import type { TradeDetail } from '../api.js';
import { useI18n } from '../i18n/index.js';
import { useTheme } from '../theme.js';
import { exitReasonView } from '../lib/exitReason.js';
import { fmtDateTime, fmtMoney, fmtPrice, pnlDir, signed } from '../lib/format.js';
import { Badge } from './Badge.js';
import { Icon } from './Icon.js';
import './grid-table.css';
import './trade-drawer.css';

const EM_DASH = '—';

/** Factor codes as sent by the server (core FACTOR_NAMES), mapped to the side-specific labels; an unknown code shows raw. */
const FACTOR_KEYS: Record<string, string> = {
  channel_breakout: 'f_channel',
  capitulation: 'f_capit',
  higher_low: 'f_hl',
  channel_breakdown: 'f_breakdown',
  euphoria: 'f_euphoria',
  lower_high: 'f_lh',
};

function factorName(name: string, t: (key: string) => string): string {
  const k = FACTOR_KEYS[name];
  return k ? t(k) : name;
}

/** confidence is a 0..1 decimal string; the bar width is its percentage, clamped. */
function barWidth(confidence: string): number {
  return new Decimal(confidence).times(100).clamp(0, 100).toNumber();
}

export function TradeDrawer({
  trade,
  onClose,
  jevTimeoutSeconds = 3,
}: {
  trade: TradeDetail;
  onClose(): void;
  jevTimeoutSeconds?: number;
}) {
  const { theme } = useTheme();
  const { t } = useI18n();
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  // Move focus into the panel on open; restore it to the previously focused element on close.
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const target = panelRef.current?.querySelector<HTMLElement>('input, button, [tabindex]') ?? panelRef.current;
    target?.focus();
    return () => {
      previous?.focus();
    };
  }, []);

  // Layout effect: the listener is attached in the same commit that shows the dialog, so an early Escape is never lost.
  useLayoutEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const reason = exitReasonView(trade.exitReason, t);
  const netDir = pnlDir(trade.pnl.net);
  const netIcon = netDir === 'up' ? 'caret-up' : netDir === 'down' ? 'caret-down' : 'minus';
  const lev = trade.leverage;
  const counted = trade.factors ? trade.factors.filter((f) => f.counted).length : 0;

  return createPortal(
    <div className={`drawer-root${theme === 'light' ? ' light' : ''}`}>
      <div className="drawer-backdrop" onClick={onClose} />
      <div className="drawer" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={panelRef}>
        <div className="drawer-header">
          <div>
            <div className="drawer-id">T-{trade.id}</div>
            <h2 className="drawer-title" id={titleId}>
              {trade.pair} · {trade.market === 'spot' ? t('spot') : t('futures')} · {trade.side === 'long' ? t('long') : t('short')}
            </h2>
            <div className="drawer-time">{fmtDateTime(trade.closedAt)}</div>
          </div>
          <button type="button" className="drawer-close" aria-label={t('close')} onClick={onClose}>
            <Icon name="xmark" />
          </button>
        </div>

        {trade.jevFallback ? (
          <Badge color="amber" icon="robot">
            {t('fallbackBadge')}
          </Badge>
        ) : null}

        <div className="drawer-tiles">
          <div className="drawer-tile">
            <div className="drawer-tile-label">{t('tf')}</div>
            <div className="drawer-tile-value">{trade.entryKind === 'late' ? t('late') : trade.signalTimeframe}</div>
          </div>
          <div className="drawer-tile">
            <div className="drawer-tile-label">{t('trend1w')}</div>
            <div className="drawer-tile-value">
              {trade.trend1w === 'up' ? (
                <>
                  <Icon name="arrow-trend-up" />
                  {t('up')}
                </>
              ) : trade.trend1w === 'down' ? (
                <>
                  <Icon name="arrow-trend-down" />
                  {t('down')}
                </>
              ) : (
                EM_DASH
              )}
            </div>
          </div>
          <div className="drawer-tile">
            <div className="drawer-tile-label">{t('entry')}</div>
            <div className="drawer-tile-value drawer-mono">{fmtPrice(trade.entryPrice)}</div>
          </div>
          <div className="drawer-tile">
            <div className="drawer-tile-label">{t('exitReason')}</div>
            <div className="drawer-tile-value">
              <Icon name={reason.icon} family={reason.family} />
              {reason.label}
            </div>
          </div>
        </div>

        {trade.entryKind === 'flip' ? (
          <div className="drawer-flip">
            <Icon name="right-left" className="drawer-flip-icon" />
            <div>
              <div className="drawer-flip-title">{t('flipInT')}</div>
              <div className="drawer-flip-note">
                {t('flipInNote', {
                  prev: trade.side === 'short' ? t('sideLong') : t('sideShort'),
                  sig: trade.side === 'short' ? t('sigRed') : t('sigGreen'),
                  n: counted,
                  side: trade.side === 'short' ? t('sideShort') : t('sideLong'),
                })}
              </div>
            </div>
          </div>
        ) : null}

        <section className="drawer-section">
          <div className="drawer-section-head">
            <span>{t('confluence')}</span>
            {trade.threshold !== null ? (
              <span className="drawer-section-sub">
                {t('threshold')} {fmtMoney(trade.threshold, 2)}
              </span>
            ) : null}
          </div>
          {trade.factors ? (
            trade.factors.map((f) => (
              <div className="drawer-factor" key={f.name}>
                <Icon name={f.present ? 'check' : 'xmark'} className={f.present ? 'pnl-up' : 'pnl-down'} />
                <span className="drawer-factor-name">{factorName(f.name, t)}</span>
                <span className="drawer-factor-bar" aria-hidden="true">
                  <span
                    className={`drawer-factor-fill${f.counted ? '' : ' drawer-factor-fill-muted'}`}
                    style={{ width: `${barWidth(f.confidence)}%` }}
                  />
                </span>
                <span className="drawer-factor-conf drawer-mono">{fmtMoney(f.confidence, 2)}</span>
                <span className="drawer-factor-state">{f.present ? t('present') : t('absent')}</span>
              </div>
            ))
          ) : (
            <p className="drawer-note">{trade.jevFallback ? t('fbNote', { timeout: jevTimeoutSeconds }) : t('lateNote')}</p>
          )}
        </section>

        <div className="drawer-box">
          <div className="drawer-box-row">
            <span>{t('resSize')}</span>
            <span className="drawer-mono">{fmtMoney(trade.sizePct, 0)}%</span>
          </div>
          <div className="drawer-box-row">
            <span>{t('sizeMode')}</span>
            <span>{trade.sizingMode}</span>
          </div>
          <div className="drawer-box-row">
            <span>{t('levUsed')}</span>
            <span>
              {trade.market === 'futures' && lev.used !== null ? (
                <>
                  {lev.used}x
                  {lev.lowered && lev.configured !== null ? (
                    <span className="gt-sub"> {t('lowered', { a: lev.configured, b: lev.used })}</span>
                  ) : null}
                </>
              ) : (
                EM_DASH
              )}
            </span>
          </div>
        </div>

        <div className="drawer-box">
          <div className="drawer-box-row">
            <span>{t('gross')}</span>
            <span className="drawer-mono">{signed(trade.pnl.gross)}</span>
          </div>
          <div className="drawer-box-row">
            <span>{t('fees')}</span>
            <span className="drawer-mono">{signed(new Decimal(trade.pnl.fees).abs().neg().toString())}</span>
          </div>
          <div className="drawer-box-row">
            <span>{t('funding')}</span>
            <span className="drawer-mono">{trade.market === 'spot' ? EM_DASH : signed(trade.pnl.funding)}</span>
          </div>
          <div className={`drawer-box-row drawer-box-net pnl-${netDir}`}>
            <span>{t('net')}</span>
            <span className="drawer-mono">
              <Icon name={netIcon} />
              {signed(trade.pnl.net)}
            </span>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
