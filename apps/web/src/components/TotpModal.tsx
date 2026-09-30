import { useState } from 'react';
import { ApiError } from '../api.js';
import { useI18n } from '../i18n/index.js';
import { Button } from './Button.js';
import { Modal } from './Modal.js';
import { errorText } from './errors.js';

export interface TotpModalProps {
  title: string;
  body: string;
  confirmLabel: string;
  confirmIcon?: string;
  destructive?: boolean;
  onConfirm(code: string): Promise<void>;
  onClose(): void;
}

export function TotpModal({ title, body, confirmLabel, confirmIcon, destructive, onConfirm, onClose }: TotpModalProps) {
  const { t } = useI18n();
  const [code, setCode] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = code.length === 6 && !pending;

  const submit = async () => {
    if (!ready) return;
    setPending(true);
    setError(null);
    try {
      await onConfirm(code);
      // On success the caller closes the modal.
    } catch (err) {
      // A code is single-use, so it is cleared after any failed attempt.
      setError(err instanceof ApiError && err.status === 403 ? t('codeRejected') : errorText(err, t));
      setCode('');
    } finally {
      setPending(false);
    }
  };

  return (
    <Modal
      title={title}
      body={body}
      icon="key"
      tone={destructive ? 'danger' : 'accent'}
      onClose={onClose}
      footer={
        <div className="modal-actions">
          <Button variant="ghost" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button variant={destructive ? 'danger' : 'primary'} icon={confirmIcon} loading={pending} disabled={!ready} onClick={submit}>
            {confirmLabel}
          </Button>
        </div>
      }
    >
      <input
        className="totp-input"
        value={code}
        onChange={(e) => {
          setCode(e.target.value.replace(/\D/g, '').slice(0, 6));
          setError(null);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void submit();
        }}
        inputMode="numeric"
        autoComplete="one-time-code"
        autoFocus
        aria-label={t('totpTitle')}
      />
      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : null}
    </Modal>
  );
}
