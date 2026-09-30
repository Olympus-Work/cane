import { useState } from 'react';
import { DEFAULT_JEV_TIMEOUT_MS, saveJev, type SettingsView } from '../../api.js';
import { Button } from '../../components/Button.js';
import { Field } from '../../components/Field.js';
import { TotpModal } from '../../components/TotpModal.js';
import { useToast } from '../../components/Toast.js';
import { useI18n } from '../../i18n/index.js';
import '../settings.css';
import './exchange.css';

/** Settings > Trading (spec 5): the Jev timeout and the write-only Jev API key. */
export function TradingSettings({ settings, reload }: { settings: SettingsView; reload(): Promise<void> }) {
  const { t } = useI18n();
  const { show } = useToast();
  const jevHint = settings.secrets.jev_api_key;

  const initialSeconds = settings.jevTimeoutMs === null ? DEFAULT_JEV_TIMEOUT_MS / 1000 : settings.jevTimeoutMs / 1000;
  const [timeout, setTimeoutValue] = useState(String(initialSeconds));
  const [jevKey, setJevKey] = useState('');
  const [timeoutError, setTimeoutError] = useState<string | null>(null);
  const [modal, setModal] = useState(false);

  const timeoutChanged = timeout !== String(initialSeconds);
  const dirty = timeoutChanged || jevKey !== '';

  const openModal = () => {
    const seconds = Number(timeout);
    if (!Number.isFinite(seconds) || seconds < 0.5 || seconds > 10) {
      setTimeoutError(t('jevTimeoutRange'));
      return;
    }
    setTimeoutError(null);
    setModal(true);
  };

  const save = async (code: string) => {
    const fields: { timeoutMs?: number; apiKey?: string } = {};
    if (timeoutChanged) fields.timeoutMs = Math.round(Number(timeout) * 1000);
    if (jevKey !== '') fields.apiKey = jevKey;
    await saveJev(fields, code);
    setModal(false);
    setJevKey('');
    show(t('tSaved'));
    await reload();
  };

  return (
    <div className="card">
      <h2 className="exchange-card-title">{t('trading')}</h2>
      <div className="exchange-form">
        <div className="exchange-field-saved">
          <Field
            id="jev-timeout"
            label={t('jevTimeout')}
            type="number"
            inputMode="decimal"
            value={timeout}
            onChange={(v) => {
              setTimeoutValue(v);
              if (timeoutError) setTimeoutError(null);
            }}
            hint={t('jevTimeoutHint')}
            error={timeoutError ?? undefined}
            autoComplete="off"
          />
          <span className="exchange-unit">{t('seconds')}</span>
        </div>
        <div className="exchange-field-saved">
          <Field id="jev-key" label={t('jevKey')} type="password" value={jevKey} onChange={setJevKey} hint={t('jevKeyHint')} autoComplete="off" />
          {jevHint ? <span className="exchange-saved mono">•••• {jevHint}</span> : null}
        </div>
        <div className="exchange-actions">
          <Button variant="primary" disabled={!dirty} onClick={openModal}>
            {t('saveTotp')}
          </Button>
        </div>
      </div>
      {modal ? (
        <TotpModal title={t('totpTitle')} body={t('totpSub')} confirmLabel={t('saveTotp')} onConfirm={save} onClose={() => setModal(false)} />
      ) : null}
    </div>
  );
}
