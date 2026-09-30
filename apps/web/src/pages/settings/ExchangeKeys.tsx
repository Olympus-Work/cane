import { useState } from 'react';
import { ApiError, saveBinanceKey, type SettingsView } from '../../api.js';
import { Button } from '../../components/Button.js';
import { Field } from '../../components/Field.js';
import { Icon } from '../../components/Icon.js';
import { TotpModal } from '../../components/TotpModal.js';
import { useToast } from '../../components/Toast.js';
import { useI18n } from '../../i18n/index.js';
import '../settings.css';
import './exchange.css';

interface ValidationBox {
  kind: 'neutral' | 'accepted' | 'rejected';
  title: string;
  body: string;
}

function rejectedBox(err: ApiError, t: (key: string, vars?: Record<string, string | number>) => string): ValidationBox {
  const code = err.code ?? '';
  if (code === 'withdrawals_enabled') return { kind: 'rejected', title: t('keyRejectedWithdrawals'), body: t('keyRejectedWithdrawalsBody') };
  if (code === 'universal_transfer_enabled') return { kind: 'rejected', title: t('keyRejectedTransfer'), body: t('keyRejectedTransferBody') };
  if (code === 'market_not_enabled') {
    const raw = Array.isArray(err.extra.markets) ? (err.extra.markets as unknown[]) : [];
    const markets = raw
      .map((m) => (m === 'spot' ? t('marketSpot') : m === 'futures' ? t('marketFutures') : String(m)))
      .join(' + ');
    return { kind: 'rejected', title: t('keyRejectedNoTrading'), body: t('keyRejectedNoTradingBody', { market: markets }) };
  }
  if (code === 'no_trading') return { kind: 'rejected', title: t('keyRejectedNoTrading'), body: t('keyRejectedNoTradingAny') };
  // 'unusable' or anything else: the server's message is safe to show (it never carries secrets).
  return { kind: 'rejected', title: t('keyRejectedUnusable'), body: err.serverMessage };
}

/** Settings > Exchange keys (spec 5): a masked row, or the replace form with its validation box. */
export function ExchangeKeys({ settings, reload }: { settings: SettingsView; reload(): Promise<void> }) {
  const { t } = useI18n();
  const { show } = useToast();
  const hint = settings.secrets.binance_api_key;
  const saved = typeof hint === 'string';

  const [replacing, setReplacing] = useState(!saved);
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [modal, setModal] = useState(false);
  const [box, setBox] = useState<ValidationBox | null>(null);

  const openReplace = () => {
    setApiKey('');
    setApiSecret('');
    setBox({ kind: 'neutral', title: t('kNewT'), body: t('kNewB') });
    setReplacing(true);
  };

  const cancel = () => {
    setApiKey('');
    setApiSecret('');
    setBox(null);
    setReplacing(false);
  };

  const save = async (code: string) => {
    try {
      await saveBinanceKey(apiKey, apiSecret, code);
      setModal(false);
      setApiKey('');
      setApiSecret('');
      setBox({ kind: 'accepted', title: t('kOkT'), body: t('kOkB') });
      setReplacing(false);
      show(t('tSaved'));
      await reload();
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) throw err; // wrong TOTP: the modal shows the code error
      if (err instanceof ApiError && err.status === 422) {
        // Rejected key: close the modal, clear the inputs, keep the form open with the reason.
        setModal(false);
        setApiKey('');
        setApiSecret('');
        setBox(rejectedBox(err, t));
        return;
      }
      throw err; // the modal shows the generic error text
    }
  };

  const boxIcon = box?.kind === 'accepted' ? 'circle-check' : box?.kind === 'rejected' ? 'circle-xmark' : 'circle-info';
  const boxTone = box?.kind === 'accepted' ? 'alert-green' : box?.kind === 'rejected' ? 'alert-red' : 'alert-neutral';

  return (
    <div className="card">
      <h2 className="exchange-card-title">{t('exKeys')}</h2>
      {box ? (
        <div className={`alert ${boxTone}`} role={box.kind === 'rejected' ? 'alert' : undefined}>
          <Icon name={boxIcon} />
          <span>
            <strong>{box.title}</strong> {box.body}
          </span>
        </div>
      ) : null}
      {saved && !replacing ? (
        <>
          <div className="exchange-row">
            <Icon name="key" className="exchange-row-icon" />
            <span className="exchange-row-label">{t('apiKey')}</span>
            <span className="exchange-masked mono">•••• {hint}</span>
            <Button variant="secondary" size="sm" onClick={openReplace}>
              {t('replace')}
            </Button>
          </div>
          <p className="exchange-note">{t('keyRestartNote')}</p>
        </>
      ) : (
        <>
          {!saved && <p className="exchange-note">{t('notConfigured')}</p>}
          <p className="exchange-helper">
            <Icon name="circle-info" /> {t('kHelp')}
          </p>
          <div className="exchange-form">
            <Field id="binance-api-key" label={t('apiKey')} value={apiKey} onChange={setApiKey} placeholder={t('pasteKey')} autoComplete="off" />
            <Field
              id="binance-api-secret"
              label={t('apiSecret')}
              type="password"
              value={apiSecret}
              onChange={setApiSecret}
              placeholder={t('pasteSecret')}
              hint={t('fieldTargetHint')}
              autoComplete="off"
            />
            <div className="exchange-actions">
              {saved ? (
                <Button variant="ghost" onClick={cancel}>
                  {t('cancel')}
                </Button>
              ) : null}
              <Button variant="primary" disabled={apiKey === '' || apiSecret === ''} onClick={() => setModal(true)}>
                {t('saveTotp')}
              </Button>
            </div>
          </div>
        </>
      )}
      {modal ? (
        <TotpModal title={t('totpTitle')} body={t('totpSub')} confirmLabel={t('saveTotp')} onConfirm={save} onClose={() => setModal(false)} />
      ) : null}
    </div>
  );
}
