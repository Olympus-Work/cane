import { useState } from 'react';
import { ApiError, closeStrategy, disableStrategy, enableStrategy, listStrategies, type StrategyItem, type StrategyList } from '../api.js';
import { Button } from '../components/Button.js';
import { Icon } from '../components/Icon.js';
import { Modal } from '../components/Modal.js';
import { StrategyTable } from '../components/StrategyTable.js';
import { TotpModal } from '../components/TotpModal.js';
import { useToast } from '../components/Toast.js';
import { errorText } from '../components/errors.js';
import { useI18n } from '../i18n/index.js';
import { fmtPrice, fmtQty } from '../lib/format.js';
import { usePoll } from '../lib/usePoll.js';
import { StrategyForm } from './StrategyForm.js';
import './dashboard.css';
import '../components/grid-table.css';

type Dialog = { kind: 'enable'; s: StrategyItem } | { kind: 'close'; s: StrategyItem } | null;
type View = { kind: 'list' } | { kind: 'form'; id: string | null };

/** Strategies (B10): list, enable (fresh TOTP), disable, close, and the create / edit form. */
export function Strategies({ onEnabled }: { onEnabled(): void }) {
  const { t } = useI18n();
  const toast = useToast();
  const poll = usePoll(listStrategies, 10_000);
  const [view, setView] = useState<View>({ kind: 'list' });
  const [dialog, setDialog] = useState<Dialog>(null);

  const data = poll.data;
  const items = data?.items ?? [];

  if (view.kind === 'form') {
    const editing = view.id === null ? null : (items.find((s) => s.id === view.id) ?? null);
    return (
      <StrategyForm
        existing={editing}
        items={items}
        onDone={() => {
          setView({ kind: 'list' });
          poll.reload();
        }}
      />
    );
  }

  const enable = (s: StrategyItem) => {
    const other = items.find((x) => x.id !== s.id && x.pair === s.pair && (x.status === 'enabled' || x.status === 'needs_attention'));
    if (other) {
      toast.show(t('stratEnableConflict', { pair: s.pair, id: other.id }));
      return;
    }
    setDialog({ kind: 'enable', s });
  };

  const disable = async (s: StrategyItem) => {
    try {
      await disableStrategy(s.id);
      toast.show(t(s.position ? 'tDisabled' : 'tDisabledNoPos', { id: s.id }));
      poll.reload();
    } catch (err) {
      toast.show(errorText(err, t));
    }
  };

  return (
    <div className="page">
      <div className="page-title-row">
        <div>
          <h1 className="page-title">{t('strategies')}</h1>
          <p className="page-sub">{t('stratSub')}</p>
        </div>
        <Button icon="plus" disabled={poll.loading && !data} onClick={() => setView({ kind: 'form', id: null })}>
          {t('newStrategy')}
        </Button>
      </div>

      <ExchangeBanner data={data} failed={poll.error !== null} />

      <section className="card card-flush">
        {!data ? (
          poll.error !== null ? (
            <div className="alert alert-amber" role="alert" style={{ margin: 16 }}>
              <Icon name="circle-exclamation" /> <span>{t('loadingFailed')}</span>
            </div>
          ) : (
            <div className="loading-row" role="status">
              <Icon name="circle-notch" spin /> {t('loadingData')}
            </div>
          )
        ) : items.length === 0 ? (
          <div className="gt-empty">
            <Icon name="chess-knight" />
            <div className="gt-empty-title">{t('noStrats')}</div>
            <div>{t('noStratsSub')}</div>
            <Button icon="plus" onClick={() => setView({ kind: 'form', id: null })}>
              {t('newStrategy')}
            </Button>
          </div>
        ) : (
          <StrategyTable
            items={items}
            actions={{
              onEnable: enable,
              onDisable: (s) => void disable(s),
              onEdit: (s) => setView({ kind: 'form', id: s.id }),
              onClose: (s) => setDialog({ kind: 'close', s }),
            }}
          />
        )}
      </section>

      {dialog?.kind === 'enable' ? (
        <TotpModal
          title={t('mEnableT', { id: dialog.s.id })}
          body={t('mEnableB', { pair: dialog.s.pair })}
          confirmLabel={t('enable')}
          confirmIcon="play"
          onClose={() => setDialog(null)}
          onConfirm={async (code) => {
            await enableStrategy(dialog.s.id, code);
            toast.show(t('tEnabled', { id: dialog.s.id }));
            onEnabled();
            setDialog(null);
            poll.reload();
          }}
        />
      ) : null}

      {dialog?.kind === 'close' ? (
        <CloseDialog
          s={dialog.s}
          onClose={() => setDialog(null)}
          onClosed={() => {
            toast.show(t('tClosed', { pair: dialog.s.pair }));
            setDialog(null);
            poll.reload();
          }}
        />
      ) : null}
    </div>
  );
}

function ExchangeBanner({ data, failed }: { data: StrategyList | null; failed: boolean }) {
  const { t } = useI18n();
  if (!failed && data?.exchangeError !== 'unreachable') return null;
  return (
    <div className="alert alert-amber" role="alert">
      <Icon name="plug-circle-xmark" />
      <span>
        <strong>{t('unreachable')}</strong> — {t('stratErrorSub')}
      </span>
    </div>
  );
}

/** B10.5: the server closes a strategy with nothing open; with a position it answers 409 until the kill switch step. */
function CloseDialog({ s, onClose, onClosed }: { s: StrategyItem; onClose(): void; onClosed(): void }) {
  const { t } = useI18n();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pos = s.position;

  const confirm = async () => {
    setPending(true);
    setError(null);
    try {
      await closeStrategy(s.id);
      onClosed();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'position_open') setError(t('errPositionOpen', { id: s.id }));
      else if (err instanceof ApiError && err.code === 'orders_open') setError(t('errOrdersOpen', { id: s.id }));
      else setError(errorText(err, t));
      setPending(false);
    }
  };

  return (
    <Modal
      title={t('mCloseT', { pair: s.pair })}
      body={pos ? t('mCloseB') : t('mCloseNoPos')}
      icon="xmark"
      tone="danger"
      onClose={onClose}
      footer={
        <div className="modal-actions">
          <Button variant="ghost" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button variant="danger" loading={pending} onClick={() => void confirm()}>
            {pos ? t('mCloseOk') : t('close')}
          </Button>
        </div>
      }
    >
      {pos ? (
        <ul className="modal-list">
          <li>{t('mCloseL1', { pos: `${pos.side === 'long' ? t('long') : t('short')} ${fmtQty(pos.qty)} @ ${fmtPrice(pos.entryPrice)}` })}</li>
          <li>{t('mCloseL2')}</li>
        </ul>
      ) : null}
      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : null}
    </Modal>
  );
}
