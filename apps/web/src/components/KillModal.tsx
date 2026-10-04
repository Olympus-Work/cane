import { useState } from 'react';
import { activateKillSwitch, ApiError, type KillResult } from '../api.js';
import { useI18n } from '../i18n/index.js';
import { Button } from './Button.js';
import { Icon } from './Icon.js';
import { Modal } from './Modal.js';
import { errorText } from './errors.js';

/** B11: one confirmation step, no TOTP. The server does the work; this only asks and reports. */
export function KillModal({ onClose, onDone }: { onClose(): void; onDone(result: KillResult): void }) {
  const { t } = useI18n();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    setPending(true);
    setError(null);
    try {
      onDone(await activateKillSwitch());
    } catch (err) {
      // 404 = this server has no kill switch endpoint yet (S11).
      setError(err instanceof ApiError && err.status === 404 ? t('killUnavailable') : errorText(err, t));
      setPending(false);
    }
  };

  return (
    <Modal
      title={t('mKillT')}
      body={t('mKillB')}
      icon="power-off"
      tone="danger"
      onClose={onClose}
      footer={
        <div className="modal-actions">
          <Button variant="ghost" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button variant="danger" icon="power-off" loading={pending} onClick={() => void confirm()}>
            {t('mKillOk')}
          </Button>
        </div>
      }
    >
      <ul className="modal-list">
        <li>
          <Icon name="ban" /> {t('mKillL1')}
        </li>
        <li>
          <Icon name="xmark" /> {t('mKillL2')}
        </li>
        <li>
          <Icon name="circle-stop" /> {t('mKillL3')}
        </li>
        <li className="modal-list-neutral">
          <Icon name="shield-halved" /> {t('mKillL4')}
        </li>
      </ul>
      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : null}
    </Modal>
  );
}
