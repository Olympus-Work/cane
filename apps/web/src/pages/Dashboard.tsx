import { useCallback, useEffect, useRef, useState } from 'react';
import { DEFAULT_JEV_TIMEOUT_MS, listAudit, listTrades, readHeatmap, readSettings, readTrade, type AuditItem, type Dashboard as DashboardData, type DashboardAlert, type TradeDetail, type TradeSummary } from '../api.js';
import { AuditTable } from '../components/AuditTable.js';
import { Button } from '../components/Button.js';
import { Heatmap } from '../components/Heatmap.js';
import { Icon } from '../components/Icon.js';
import { PositionCards } from '../components/PositionCards.js';
import { PositionsTable } from '../components/PositionsTable.js';
import { TradeDrawer } from '../components/TradeDrawer.js';
import { TradesTable } from '../components/TradesTable.js';
import { errorText } from '../components/errors.js';
import { useI18n } from '../i18n/index.js';
import { bangkokDay, fmtClock, fmtMoney, pnlDir, signed } from '../lib/format.js';
import { useIsMobile } from '../lib/useIsMobile.js';
import { usePoll, type Poll } from '../lib/usePoll.js';
import './dashboard.css';
import '../components/grid-table.css';

export type Page = 'dashboard' | 'strategies' | 'settings' | 'killswitch';
type Tab = 'positions' | 'trades' | 'audit';

const HEATMAP_DAYS = 365;
const HEATMAP_WEEKS = 53;
const HEATMAP_WEEKS_MOBILE = 16;
const PAGE_SIZE = 50;

/** Dashboard (B16): stat cards, alerts, the three tabs, the consistency heatmap, and the trade drawer. */
export function Dashboard({ poll, onNavigate }: { poll: Poll<DashboardData>; onNavigate(page: Page): void }) {
  const { t } = useI18n();
  const mobile = useIsMobile();
  const [tab, setTab] = useState<Tab>('positions');
  const [openTrade, setOpenTrade] = useState<TradeDetail | null>(null);
  const [tradeError, setTradeError] = useState<string | null>(null);
  const dash = poll.data;
  const failing = poll.error !== null;
  const stale = failing || dash?.stale === true;

  const showTrade = useCallback(
    async (id: number) => {
      setTradeError(null);
      try {
        setOpenTrade(await readTrade(id));
      } catch (err) {
        setTradeError(errorText(err, t));
      }
    },
    [t],
  );

  const heatmap = usePoll(() => readHeatmap(HEATMAP_DAYS), 60_000);
  // The Jev timeout is only shown in a fallback trade's note; the trade record does not store the one that applied.
  const settings = usePoll(readSettings, null);
  const jevSeconds = (settings.data?.jevTimeoutMs ?? DEFAULT_JEV_TIMEOUT_MS) / 1000;

  return (
    <div className="page">
      <div className="page-title-row">
        <h1 className="page-title">{t('dashboard')}</h1>
        <SyncStatus poll={poll} />
      </div>

      <div className={`stat-grid${stale ? ' stale' : ''}`}>{dash ? <StatCards data={dash} /> : <StatSkeletons />}</div>

      {dash ? <Alerts alerts={dash.alerts} lastSyncAt={dash.lastSyncAt} onNavigate={onNavigate} onViewTrades={() => setTab('trades')} /> : null}

      <section className="card card-flush">
        <div className="tabs" role="tablist">
          <TabButton id="positions" tab={tab} onSelect={setTab} count={dash?.positions.length}>
            {t('positions')}
          </TabButton>
          <TabButton id="trades" tab={tab} onSelect={setTab} count={dash?.cards.tradeCount}>
            {t('history')}
          </TabButton>
          <TabButton id="audit" tab={tab} onSelect={setTab}>
            {t('audit')}
          </TabButton>
        </div>
        <div className="tab-panel" role="tabpanel">
          {tradeError ? (
            <div className="alert alert-amber" role="alert" style={{ margin: 16 }}>
              <Icon name="circle-exclamation" /> <span>{tradeError}</span>
            </div>
          ) : null}
          {tab === 'positions' ? <PositionsPanel data={dash} stale={stale} mobile={mobile} onNavigate={onNavigate} /> : null}
          {tab === 'trades' ? <TradesPanel onOpen={(id) => void showTrade(id)} /> : null}
          {tab === 'audit' ? <AuditPanel /> : null}
        </div>
      </section>

      <Heatmap items={heatmap.data?.items ?? []} today={bangkokDay(new Date().toISOString())} weeks={mobile ? HEATMAP_WEEKS_MOBILE : HEATMAP_WEEKS} />

      {openTrade ? <TradeDrawer trade={openTrade} jevTimeoutSeconds={jevSeconds} onClose={() => setOpenTrade(null)} /> : null}
    </div>
  );
}

function SyncStatus({ poll }: { poll: Poll<DashboardData> }) {
  const { t } = useI18n();
  const dash = poll.data;
  if (poll.loading && !dash) {
    return (
      <span className="sync-status" role="status">
        <Icon name="circle-notch" spin /> {t('syncing')}
      </span>
    );
  }
  const time = dash?.lastSyncAt ? fmtClock(dash.lastSyncAt) : null;
  if (poll.error !== null || dash?.stale) {
    return (
      <span className="sync-status" role="status">
        <Icon name="triangle-exclamation" /> {time ? t('syncFailAt', { time }) : t('syncFailNever')}
      </span>
    );
  }
  return (
    <span className="sync-status" role="status">
      <Icon name="rotate" /> {time ? t('syncedAt', { time }) : t('syncing')}
    </span>
  );
}

function StatSkeletons() {
  const { t } = useI18n();
  return (
    <>
      {[0, 1, 2, 3, 4].map((i) => (
        <div className="card stat-card" key={i} aria-busy="true">
          <span className="stat-skeleton" style={{ width: '50%' }} />
          <span className="stat-skeleton" style={{ width: '80%', height: 20 }} />
          <span className="stat-skeleton" style={{ width: '35%' }} />
          {i === 0 ? <span className="sr-only">{t('loadingData')}</span> : null}
        </div>
      ))}
    </>
  );
}

function Pnl({ value }: { value: string }) {
  const dir = pnlDir(value);
  return (
    <span className={`pnl-${dir}`}>
      <Icon name={dir === 'up' ? 'caret-up' : dir === 'down' ? 'caret-down' : 'minus'} /> {signed(value)} USDT
    </span>
  );
}

function StatCards({ data }: { data: DashboardData }) {
  const { t } = useI18n();
  const c = data.cards;
  return (
    <>
      <div className="card stat-card">
        <span className="stat-label">{t('spotEq')}</span>
        <span className="stat-value">
          <Icon name="wallet" /> {c.spotEquity === null ? '—' : `${fmtMoney(c.spotEquity)} USDT`}
        </span>
        <span className="stat-sub">{t('spot')}</span>
      </div>
      <div className="card stat-card">
        <span className="stat-label">{t('futEq')}</span>
        <span className="stat-value">
          <Icon name="scale-balanced" /> {c.futuresEquity === null ? '—' : `${fmtMoney(c.futuresEquity)} USDT`}
        </span>
        <span className="stat-sub">USDⓈ-M</span>
      </div>
      <div className="card stat-card">
        <span className="stat-label">{t('todayPnl')}</span>
        <span className="stat-value">
          <Pnl value={c.realisedToday} />
        </span>
        <span className="stat-sub mono">{bangkokDay(new Date().toISOString())}</span>
      </div>
      <div className="card stat-card">
        <span className="stat-label">{t('totalPnl')}</span>
        <span className="stat-value">
          <Pnl value={c.realisedTotal} />
        </span>
        <span className="stat-sub">{`${c.tradeCount} ${t('hmTrades').toLowerCase()}`}</span>
      </div>
      <div className="card stat-card">
        <span className="stat-label">{t('openPos')}</span>
        <span className="stat-value">
          <Icon name="layer-group" /> {c.openPositions.spot + c.openPositions.futures}
        </span>
        <span className="stat-sub">{`${t('spot')} ${c.openPositions.spot} · ${t('futures')} ${c.openPositions.futures}`}</span>
      </div>
    </>
  );
}

function Alerts({ alerts, lastSyncAt, onNavigate, onViewTrades }: { alerts: DashboardAlert[]; lastSyncAt: string | null; onNavigate(page: Page): void; onViewTrades(): void }) {
  const { t } = useI18n();
  const attention = alerts.filter((a): a is Extract<DashboardAlert, { kind: 'needs_attention' }> => a.kind === 'needs_attention');
  const others = alerts.filter((a) => a.kind !== 'needs_attention');
  if (alerts.length === 0) return null;
  return (
    <div className="alerts">
      {attention.length > 0 ? (
        <div className="dash-alert dash-alert-orange" role="alert">
          <Icon name="triangle-exclamation" />
          <div className="dash-alert-body">
            <div className="dash-alert-title">{attention.length === 1 ? t('alAttT', { pair: attention[0]?.pair ?? '' }) : t('alAttNT', { n: attention.length })}</div>
            <div className="dash-alert-text">{t('alAttB')}</div>
            <ul className="dash-alert-list">
              {attention.map((a) => (
                <li key={a.strategyId}>
                  <span className="dash-alert-pair">{a.pair}</span>
                  <span>{a.reason ?? '—'}</span>
                </li>
              ))}
            </ul>
          </div>
          <Button variant="secondary" size="sm" onClick={() => onNavigate('strategies')}>
            {t('review')}
          </Button>
        </div>
      ) : null}
      {others.map((a) => {
        switch (a.kind) {
          case 'jev_fallback':
            return (
              <div className="dash-alert dash-alert-sky" role="status" key={a.kind}>
                <Icon name="robot" />
                <div className="dash-alert-body">
                  <div className="dash-alert-title">{t('alFbT')}</div>
                  <div className="dash-alert-text">{t('alFbCount', { n: a.count })}</div>
                </div>
                <Button variant="secondary" size="sm" onClick={onViewTrades}>
                  {t('view')}
                </Button>
              </div>
            );
          case 'exchange_unreachable':
            return (
              <div className="alert alert-amber" role="alert" key={a.kind}>
                <Icon name="plug-circle-xmark" />
                <div className="dash-alert-body">
                  <div className="dash-alert-title">{t('alUnreachT')}</div>
                  <div className="dash-alert-text">{lastSyncAt ? t('alUnreachBody', { time: fmtClock(lastSyncAt) }) : t('alUnreachBodyNever')}</div>
                </div>
              </div>
            );
          case 'key_error':
            return (
              <div className="alert alert-red" role="alert" key={a.kind}>
                <Icon name="key" />
                <div className="dash-alert-body">
                  <div className="dash-alert-title">{t('alKeyT')}</div>
                  <div className="dash-alert-text">{t('alKeyB')}</div>
                </div>
                <Button variant="secondary" size="sm" onClick={() => onNavigate('settings')}>
                  {t('openSettings')}
                </Button>
              </div>
            );
          default:
            return null;
        }
      })}
    </div>
  );
}

function TabButton({ id, tab, onSelect, count, children }: { id: Tab; tab: Tab; onSelect(tab: Tab): void; count?: number | undefined; children: string }) {
  return (
    <button type="button" role="tab" className="tab" aria-selected={tab === id} onClick={() => onSelect(id)}>
      {children}
      {count !== undefined ? <span className="tab-count">{count}</span> : null}
    </button>
  );
}

function PositionsPanel({ data, stale, mobile, onNavigate }: { data: DashboardData | null; stale: boolean; mobile: boolean; onNavigate(page: Page): void }) {
  const { t } = useI18n();
  if (!data) {
    return (
      <div className="loading-row" role="status">
        <Icon name="circle-notch" spin /> {t('loadingData')}
      </div>
    );
  }
  if (data.positions.length === 0) {
    return (
      <div className="gt-empty">
        <Icon name="layer-group" />
        <div className="gt-empty-title">{t('noPositions')}</div>
        <div>{t('emptyPosRun')}</div>
        <Button variant="secondary" icon="plus" onClick={() => onNavigate('strategies')}>
          {t('newStrategy')}
        </Button>
      </div>
    );
  }
  return (
    <div className={stale ? 'stale' : undefined}>
      {mobile ? <div style={{ padding: 16 }}><PositionCards positions={data.positions} /></div> : <PositionsTable positions={data.positions} />}
    </div>
  );
}

/** Newest-first pages; the first page refreshes every 10 s, older pages are appended on request. */
function TradesPanel({ onOpen }: { onOpen(id: number): void }) {
  const { t } = useI18n();
  const first = usePoll(() => listTrades(PAGE_SIZE), 10_000);
  const [older, setOlder] = useState<TradeSummary[]>([]);
  const [cursor, setCursor] = useState<number | null | undefined>(undefined); // undefined = follow the first page
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);

  const nextBefore = cursor === undefined ? (first.data?.nextBefore ?? null) : cursor;
  const firstItems = first.data?.items ?? [];
  const seen = new Set(firstItems.map((x) => x.id));
  const items = [...firstItems, ...older.filter((x) => !seen.has(x.id))];

  const loadMore = async () => {
    if (nextBefore === null) return;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const page = await listTrades(PAGE_SIZE, nextBefore);
      setOlder((prev) => [...prev, ...page.items]);
      setCursor(page.nextBefore);
    } catch (err) {
      setMoreError(errorText(err, t));
    } finally {
      setLoadingMore(false);
    }
  };

  if (first.data === null) {
    return first.error !== null ? (
      <div className="alert alert-amber" role="alert" style={{ margin: 16 }}>
        <Icon name="circle-exclamation" /> <span>{t('loadingFailed')}</span>
      </div>
    ) : (
      <div className="loading-row" role="status">
        <Icon name="circle-notch" spin /> {t('loadingData')}
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <div className="gt-empty">
        <Icon name="clock-rotate-left" />
        <div className="gt-empty-title">{t('noTrades')}</div>
        <div>{t('noTradesSub')}</div>
      </div>
    );
  }
  return (
    <>
      <TradesTable trades={items} onOpen={onOpen} />
      {moreError ? (
        <div className="alert alert-amber" role="alert" style={{ margin: 16 }}>
          <Icon name="circle-exclamation" /> <span>{moreError}</span>
        </div>
      ) : null}
      {nextBefore !== null ? (
        <div className="tab-footer">
          <Button variant="secondary" loading={loadingMore} onClick={() => void loadMore()}>
            {t('loadMore')}
          </Button>
        </div>
      ) : null}
    </>
  );
}

/** Mounted only while its tab is open, so the log is fetched on demand. */
function AuditPanel() {
  const { t } = useI18n();
  const first = usePoll(() => listAudit(PAGE_SIZE), null);
  const [older, setOlder] = useState<AuditItem[]>([]);
  const [cursor, setCursor] = useState<number | null | undefined>(undefined);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const nextBefore = cursor === undefined ? (first.data?.nextBefore ?? null) : cursor;
  const items = [...(first.data?.items ?? []), ...older];

  const loadMore = async () => {
    if (nextBefore === null) return;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const page = await listAudit(PAGE_SIZE, nextBefore);
      if (!alive.current) return;
      setOlder((prev) => [...prev, ...page.items]);
      setCursor(page.nextBefore);
    } catch (err) {
      if (alive.current) setMoreError(errorText(err, t));
    } finally {
      if (alive.current) setLoadingMore(false);
    }
  };

  if (first.data === null) {
    return first.error !== null ? (
      <div className="alert alert-amber" role="alert" style={{ margin: 16 }}>
        <Icon name="circle-exclamation" /> <span>{t('loadingFailed')}</span>
      </div>
    ) : (
      <div className="loading-row" role="status">
        <Icon name="circle-notch" spin /> {t('loadingData')}
      </div>
    );
  }
  return (
    <>
      <AuditTable items={items} />
      {moreError ? (
        <div className="alert alert-amber" role="alert" style={{ margin: 16 }}>
          <Icon name="circle-exclamation" /> <span>{moreError}</span>
        </div>
      ) : null}
      {nextBefore !== null ? (
        <div className="tab-footer">
          <Button variant="secondary" loading={loadingMore} onClick={() => void loadMore()}>
            {t('loadMore')}
          </Button>
        </div>
      ) : null}
    </>
  );
}
