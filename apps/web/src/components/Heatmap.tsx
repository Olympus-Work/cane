import { useMemo, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import type { HeatmapDay } from '../api.js';
import { pnlDir, signed } from '../lib/format.js';
import { buildGrid, flatCells, monthLabels, summarize, type HeatmapCell } from '../lib/heatmap.js';
import { useI18n, type Lang } from '../i18n/index.js';
import { useTheme } from '../theme.js';
import { Icon } from './Icon.js';
import './grid-table.css';
import './heatmap.css';

const DIR_ICON = { up: 'caret-up', down: 'caret-down', flat: 'minus' } as const;
const DIR_CLASS = { up: 'pnl-up', down: 'pnl-down', flat: 'pnl-flat' } as const;

const LEVEL_EN = ['None', 'Low', 'Normal', 'High', 'Very high'];
const LEVEL_TH = ['ไม่มี', 'น้อย', 'ปกติ', 'สูง', 'สูงมาก'];

// Fixed reference year for month names; only the month part is rendered.
const MONTH_REF_YEAR = 2026;

function dayHeader(day: string, lang: Lang): string {
  const d = new Date(day);
  if (lang === 'th') {
    const locale = 'th-TH-u-ca-buddhist';
    const date = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: '2-digit', timeZone: 'UTC' }).format(d);
    const weekday = new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' }).format(d);
    return `${date} · ${weekday}`;
  }
  const date = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(d);
  const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'UTC' }).format(d);
  return `${date} · ${weekday}`;
}

function winLoss(cell: HeatmapCell): string {
  const total = cell.wins + cell.losses;
  const pct = total === 0 ? 0 : Math.round((cell.wins / total) * 100);
  return `${cell.wins}W / ${cell.losses}L · ${pct}%`;
}

// Centred on the cell, clamped 142px from both viewport edges; above the cell
// unless it would clip the top, then below.
function tipPos(rect: DOMRect): CSSProperties {
  const cx = rect.left + rect.width / 2;
  const left = Math.min(Math.max(cx, 142), window.innerWidth - 142);
  const below = rect.top < 230;
  return {
    left,
    top: below ? rect.bottom + 8 : rect.top - 8,
    transform: below ? 'translate(-50%, 0)' : 'translate(-50%, -100%)',
  };
}

export function Heatmap({ items, today, weeks }: { items: HeatmapDay[]; today: string; weeks: number }) {
  const { t, lang } = useI18n();
  const { theme } = useTheme();
  const [hover, setHover] = useState<{ cell: HeatmapCell; rect: DOMRect } | null>(null);

  const grid = useMemo(() => buildGrid(items, today, weeks), [items, today, weeks]);
  const labels = useMemo(() => monthLabels(grid), [grid]);
  const sum = useMemo(() => summarize(flatCells(grid)), [grid]);
  const monthFmt = useMemo(
    () => new Intl.DateTimeFormat(lang === 'th' ? 'th-TH' : 'en-US', { month: 'short', timeZone: 'UTC' }),
    [lang],
  );

  const cols: CSSProperties = { gridTemplateColumns: `repeat(${weeks}, minmax(0, 1fr))` };
  const show = (cell: HeatmapCell, el: HTMLElement) => setHover({ cell, rect: el.getBoundingClientRect() });
  const hide = () => setHover(null);

  return (
    <section className="card heatmap">
      <div className="heatmap-head">
        <h2 className="heatmap-title">
          <span>{t('hmTitle')}</span> <span className="heatmap-title-sub">- {t('hmSub')}</span>
        </h2>
        <span className="heatmap-range mono">{weeks >= 53 ? t('hmRange') : t('hmRangeShort')}</span>
      </div>
      <div className="heatmap-scroll">
        <div className="heatmap-inner" style={{ minWidth: weeks >= 53 ? 720 : 0 }}>
          <div className="heatmap-months" style={cols}>
            {labels.map(({ col, month }) => {
              const name = monthFmt.format(new Date(Date.UTC(MONTH_REF_YEAR, month, 1)));
              return (
                <span key={col} className="heatmap-month" style={{ gridColumn: col + 1 }}>
                  {lang === 'th' ? name : name.toUpperCase()}
                </span>
              );
            })}
          </div>
          <div className="heatmap-grid" style={cols}>
            {grid.map((column, col) =>
              column.map((cell, row) => {
                if (!cell) return <span key={`${col}-${row}`} className="heatmap-pad" />;
                const hot = hover?.cell.day === cell.day;
                return (
                  <span
                    key={`${col}-${row}`}
                    className={`heatmap-cell heatmap-l${cell.level}${hot ? ' heatmap-cell-hot' : ''}`}
                    data-day={cell.day}
                    tabIndex={0}
                    aria-label={`${cell.day}: ${cell.trades} trades`}
                    onMouseEnter={(e) => show(cell, e.currentTarget)}
                    onMouseLeave={hide}
                    onFocus={(e) => show(cell, e.currentTarget)}
                    onBlur={hide}
                  />
                );
              }),
            )}
          </div>
        </div>
      </div>
      <div className="heatmap-foot">
        <span>{t('hmSum', { d: sum.activeDays, n: sum.totalDays, s: sum.longestStreak })}</span>
        <span className="heatmap-legend">
          {t('hmLess')}
          {[0, 1, 2, 3, 4].map((l) => (
            <span key={l} className={`heatmap-legend-swatch heatmap-l${l}`} />
          ))}
          {t('hmMore')}
        </span>
      </div>
      {hover
        ? createPortal(
            <div className={theme === 'light' ? 'light' : ''}>
              <div className="heatmap-tip" role="tooltip" style={tipPos(hover.rect)}>
                <div className="heatmap-tip-head">{dayHeader(hover.cell.day, lang)}</div>
                <div className="heatmap-tip-row">
                  <span>{t('hmTrades')}</span>
                  <span className="mono">{hover.cell.trades}</span>
                </div>
                <div className="heatmap-tip-row">
                  <span>{t('hmPnl')}</span>
                  <span className={`mono ${DIR_CLASS[pnlDir(hover.cell.pnl)]}`}>
                    <Icon name={DIR_ICON[pnlDir(hover.cell.pnl)]} /> {signed(hover.cell.pnl)} USDT
                  </span>
                </div>
                <div className="heatmap-tip-row">
                  <span>{t('hmWinLoss')}</span>
                  <span className="mono">{winLoss(hover.cell)}</span>
                </div>
                <div className="heatmap-tip-div" />
                <div className="heatmap-tip-level">
                  {t('hmLevel')}: {(lang === 'th' ? LEVEL_TH : LEVEL_EN)[hover.cell.level]}
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </section>
  );
}
