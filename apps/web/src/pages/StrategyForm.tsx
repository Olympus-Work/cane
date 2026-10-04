import { useEffect, useState } from 'react';
import { Decimal } from 'decimal.js';
import { ApiError, createStrategy, editStrategy, sizingPreview, type MarginMode, type Market, type SizingMode, type SizingPreview, type StrategyInput, type StrategyItem } from '../api.js';
import { Button } from '../components/Button.js';
import { Field } from '../components/Field.js';
import { Icon } from '../components/Icon.js';
import { useToast } from '../components/Toast.js';
import { errorText } from '../components/errors.js';
import { useI18n } from '../i18n/index.js';
import { fmtMoney } from '../lib/format.js';
import './strategy-form.css';

const PAIR_RE = /^[A-Z0-9]{1,20}USDT$/;
const MODES: { id: SizingMode; label: string; desc: string }[] = [
  { id: 'A', label: 'modeA', desc: 'modeAD' },
  { id: 'B', label: 'modeB', desc: 'modeBD' },
  { id: 'C', label: 'modeC', desc: 'modeCD' },
];

const inRange = (v: string, lo: number, hi: number): boolean => {
  if (v.trim() === '') return false;
  try {
    const d = new Decimal(v);
    return d.gte(lo) && d.lte(hi);
  } catch {
    return false;
  }
};

/** Create (existing = null) or edit a strategy (B10.1, B10.7). Locked fields follow the server's `locked` flag. */
export function StrategyForm({ existing, items, onDone }: { existing: StrategyItem | null; items: StrategyItem[]; onDone(): void }) {
  const { t } = useI18n();
  const toast = useToast();
  const locked = existing?.locked === true;

  const [pair, setPair] = useState(existing?.pair ?? '');
  const [market, setMarket] = useState<Market>(existing?.market ?? 'futures');
  const [leverage, setLeverage] = useState(existing?.leverageCeiling ?? 5);
  const [marginMode, setMarginMode] = useState<MarginMode>(existing?.marginMode ?? 'isolated');
  const [sizingMode, setSizingMode] = useState<SizingMode>(existing?.sizingMode ?? 'B');
  const [basePct, setBasePct] = useState(existing ? new Decimal(existing.basePct).toFixed() : '10');
  const [threshold, setThreshold] = useState(existing ? new Decimal(existing.confidenceThreshold).toFixed() : '0.70');
  const [riskPct, setRiskPct] = useState(existing?.riskPct ?? '2');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const futures = market === 'futures';
  const mode: SizingMode = futures ? sizingMode : 'B';

  const pairUpper = pair.trim().toUpperCase();
  const clash = items.find((s) => s.id !== existing?.id && s.pair === pairUpper && (s.status === 'enabled' || s.status === 'needs_attention'));
  const pairError = pair.trim() === '' ? undefined : !PAIR_RE.test(pairUpper) ? t('pairInvalid') : clash ? t('dup', { pair: pairUpper, id: clash.id, market: clash.market === 'spot' ? t('spot') : t('futures') }) : undefined;
  const baseError = inRange(basePct, 5, 20) ? undefined : t('errBaseRange');
  const thresholdError = inRange(threshold, 0, 1) ? undefined : t('errThresholdRange');
  const riskError = mode === 'C' && !(inRange(riskPct, 0, 100) && new Decimal(riskPct).gt(0)) ? t('errRiskRange') : undefined;
  const valid = PAIR_RE.test(pairUpper) && !clash && !baseError && !thresholdError && !riskError;

  const save = async () => {
    if (!valid || pending) return;
    setPending(true);
    setError(null);
    const input: StrategyInput = {
      pair: pairUpper,
      market,
      leverage: futures ? leverage : null,
      sizingMode: mode,
      marginMode: futures ? marginMode : null,
      basePct: new Decimal(basePct).toFixed(),
      confidenceThreshold: new Decimal(threshold).toFixed(),
      riskPct: mode === 'C' ? new Decimal(riskPct).toFixed() : null,
    };
    try {
      if (existing) {
        const patch: Partial<StrategyInput> = { ...input };
        if (locked) {
          // The server rejects a changed locked field; do not send them at all.
          delete patch.pair;
          delete patch.market;
          delete patch.leverage;
          delete patch.marginMode;
        }
        await editStrategy(existing.id, patch);
      } else {
        await createStrategy(input);
      }
      toast.show(t('tStrat'));
      onDone();
    } catch (err) {
      setError(saveError(err, t, pairUpper));
      setPending(false);
    }
  };

  return (
    <div className="page">
      <div>
        <button type="button" className="link-back" onClick={onDone}>
          <Icon name="arrow-left" /> {t('strategies')}
        </button>
        <h1 className="page-title">{existing ? `${t('editTitle')} · ${existing.id}` : t('newTitle')}</h1>
      </div>

      <div className="form-grid">
        <section className="card form-card">
          <Field id="sf-pair" label={t('pair')} value={pair} onChange={(v) => setPair(v.toUpperCase())} icon="magnifying-glass" mono placeholder={t('pairPlaceholder')} hint={t('pairHint')} error={pairError} disabled={locked} autoComplete="off" />

          <div className="field">
            <span className="field-label">{t('market')}</span>
            <div className="seg" role="group" aria-label={t('market')}>
              {(['spot', 'futures'] as const).map((m) => (
                <button key={m} type="button" className="seg-btn" aria-pressed={market === m} disabled={locked} onClick={() => setMarket(m)}>
                  {m === 'spot' ? t('spot') : t('futures')}
                </button>
              ))}
            </div>
          </div>

          {futures ? (
            <>
              <div className="field">
                <label className="field-label" htmlFor="sf-lev">
                  {t('levelLabel')} <span className="mono form-value">{leverage}x</span>
                </label>
                <input id="sf-lev" className="form-range" type="range" min={1} max={20} step={1} value={leverage} disabled={locked} onChange={(e) => setLeverage(Number(e.target.value))} />
                <p className="field-hint">{t('levHint')}</p>
              </div>

              <div className="field">
                <span className="field-label">{t('marginMode')}</span>
                <div className="seg" role="group" aria-label={t('marginMode')}>
                  {(['isolated', 'cross'] as const).map((m) => (
                    <button key={m} type="button" className="seg-btn" aria-pressed={marginMode === m} disabled={locked} onClick={() => setMarginMode(m)}>
                      {t(m)}
                    </button>
                  ))}
                </div>
              </div>

              <div className="field" role="radiogroup" aria-label={t('sizing')}>
                <span className="field-label">{t('sizing')}</span>
                <div className="mode-cards">
                  {MODES.map((m) => (
                    <button key={m.id} type="button" role="radio" aria-checked={sizingMode === m.id} className="mode-card" onClick={() => setSizingMode(m.id)}>
                      <Icon name={sizingMode === m.id ? 'circle-dot' : 'circle'} />
                      <span>
                        <span className="mode-card-title">{t(m.label)}</span>
                        <span className="mode-card-desc">{t(m.desc)}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {locked ? (
                <p className="form-lock">
                  <Icon name="lock" /> {t('lockText', { id: existing?.id ?? '' })}
                </p>
              ) : null}
            </>
          ) : null}

          <div className="field">
            <label className="field-label" htmlFor="sf-base">
              {t('baseSize')} <span className="mono form-value">{basePct}%</span>
            </label>
            <input id="sf-base" className="form-range" type="range" min={5} max={20} step={1} value={inRange(basePct, 5, 20) ? Number(basePct) : 10} onChange={(e) => setBasePct(e.target.value)} />
            <p className={baseError ? 'field-error' : 'field-hint'}>{baseError ?? t('baseHint')}</p>
          </div>

          <Field id="sf-thr" label={t('jevThr')} type="number" value={threshold} onChange={setThreshold} inputMode="decimal" mono error={thresholdError} />

          {mode === 'C' ? <Field id="sf-risk" label={t('riskFull')} type="number" value={riskPct} onChange={setRiskPct} inputMode="decimal" mono error={riskError} /> : null}

          {error ? (
            <div className="alert alert-red" role="alert">
              <Icon name="circle-xmark" /> <span>{error}</span>
            </div>
          ) : null}

          <div className="form-actions">
            <Button variant="ghost" onClick={onDone}>
              {t('cancel')}
            </Button>
            <Button icon="check" loading={pending} disabled={!valid} onClick={() => void save()}>
              {t('save')}
            </Button>
          </div>
        </section>

        <Preview market={market} mode={mode} basePct={basePct} leverage={leverage} baseValid={!baseError} riskPct={riskPct} riskValid={!riskError} />
      </div>
    </div>
  );
}

/** Maps the server's `code`s for create / edit to translated text; anything else falls back to the server message. */
function saveError(err: unknown, t: (k: string, v?: Record<string, string | number>) => string, pair: string): string {
  if (err instanceof ApiError) {
    if (err.code === 'locked_field') return t('errLockedField');
    if (err.code === 'disable_first') return t('errDisableFirst');
    if (err.code === 'pair_in_use') return t('errPairInUse', { pair });
  }
  return errorText(err, t);
}

/** Live sizing preview (B10.1): equity from the server, the headline and three rows. Debounced so dragging a slider is one request. */
function Preview({ market, mode, basePct, leverage, baseValid, riskPct, riskValid }: { market: Market; mode: SizingMode; basePct: string; leverage: number; baseValid: boolean; riskPct: string; riskValid: boolean }) {
  const { t } = useI18n();
  const [data, setData] = useState<SizingPreview | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!baseValid) return;
    let alive = true;
    const timer = window.setTimeout(() => {
      sizingPreview({ market, sizingMode: mode, basePct, ...(market === 'futures' ? { leverage } : {}) })
        .then((r) => {
          if (!alive) return;
          setData(r);
          setFailed(false);
        })
        .catch(() => {
          if (alive) setFailed(true);
        });
    }, 300);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [market, mode, basePct, leverage, baseValid]);

  const row = (factors: 0 | 2 | 3) => data?.rows.find((r) => r.factors === factors);
  const base = row(0);
  let headline: string | null = null;
  if (data && data.equity !== null && base) {
    const eq = fmtMoney(data.equity);
    if (market === 'spot') headline = t('exSpot', { eq, s: fmtMoney(base.sizePct, 0), n: fmtMoney(base.notional) });
    else if (mode === 'C') {
      if (riskValid) {
        // Effective risk = risk x size / 100 (spec B10.1 example for mode C).
        const eff = new Decimal(riskPct).times(base.sizePct).div(100);
        headline = t('exC', { eq, r: eff.toFixed(2), ru: new Decimal(data.equity).times(eff).div(100).toFixed(2) });
      }
    } else headline = t('exBase', { eq, lev: leverage, s: fmtMoney(base.sizePct, 0), n: fmtMoney(base.notional), m: fmtMoney(base.margin) });
  }

  const labels: Record<0 | 2 | 3, string> = { 0: t('rBase'), 2: t('rTwo'), 3: t('rFull') };
  return (
    <aside className="card form-preview" aria-live="polite">
      <h2 className="form-preview-title">{t('preview')}</h2>
      {headline ? <p className="form-preview-headline mono">{headline}</p> : null}
      {data && data.equity === null ? <p className="field-hint">{t('previewNoEquity')}</p> : null}
      {failed ? <p className="field-error">{t('loadingFailed')}</p> : null}
      {data?.stale ? <p className="field-hint">{t('stalePreview')}</p> : null}
      {data ? (
        <ul className="form-preview-rows">
          {([0, 2, 3] as const).map((f) => {
            const r = row(f);
            return (
              <li key={f}>
                <span>{labels[f]}</span>
                <span className="mono">
                  {r ? `${fmtMoney(r.sizePct, 0)}%` : '—'}
                  {r && r.notional !== null ? ` · ${t('notional')} ${fmtMoney(r.notional)}` : ''}
                  {r && r.margin !== null && market === 'futures' ? ` · ${t('margin')} ${fmtMoney(r.margin)}` : ''}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
      <p className="field-hint">{mode === 'C' && market === 'futures' ? t('exNoteC') : t('exNote')}</p>
    </aside>
  );
}
