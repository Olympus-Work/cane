import { useCallback, useEffect, useState } from 'react';
import { ApiError, beginTotpSetup, changePassword, confirmTotpSetup, listSessions, logout, regenerateRecoveryCodes, type SessionInfo } from '../../api.js';
import { Badge } from '../../components/Badge.js';
import { Button } from '../../components/Button.js';
import { Field } from '../../components/Field.js';
import { Icon } from '../../components/Icon.js';
import { TotpModal } from '../../components/TotpModal.js';
import { useToast } from '../../components/Toast.js';
import { errorText } from '../../components/errors.js';
import { useI18n } from '../../i18n/index.js';
import './security.css';

const MIN_PASSWORD_LENGTH = 12;
const DEVICE_MAX_CHARS = 60;

function formatTime(iso: string, lang: 'en' | 'th'): string {
  return new Date(iso).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB', { timeZone: 'Asia/Bangkok' });
}

/** Copies text when the clipboard API is available; otherwise does nothing. */
function copyText(text: string): void {
  if (navigator.clipboard?.writeText) void navigator.clipboard.writeText(text);
}

/** The 10 recovery codes, shown once. They live only in component state — never in storage or logs. */
export function RecoveryCodes({ codes }: { codes: string[] }) {
  const { t } = useI18n();
  const { show } = useToast();

  const copyAll = () => {
    copyText(codes.join('\n'));
    show(t('copied'));
  };

  const download = () => {
    const url = URL.createObjectURL(new Blob([codes.join('\n')], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'cane-recovery-codes.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="security-codes">
      <div className="alert alert-amber" role="alert">
        <Icon name="triangle-exclamation" />
        <span>{t('shownOnce')}</span>
      </div>
      <h3 className="security-codes-title">{t('codesTitle')}</h3>
      <div className="security-codes-grid">
        {codes.map((code) => (
          <span key={code} className="mono">
            {code.toUpperCase()}
          </span>
        ))}
      </div>
      <div className="security-codes-actions">
        <Button variant="secondary" size="sm" icon="copy" onClick={copyAll}>
          {t('copyAll')}
        </Button>
        <Button variant="secondary" size="sm" icon="download" onClick={download}>
          {t('download')}
        </Button>
      </div>
    </div>
  );
}

export function Security({ onSignedOut }: { onSignedOut(): void }) {
  const { t, lang } = useI18n();
  const { show } = useToast();

  // --- Change password ---
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [pwErrors, setPwErrors] = useState<{ current?: string; next?: string }>({});
  const [pwBusy, setPwBusy] = useState(false);

  const submitPassword = async () => {
    // Client checks before any request.
    if (newPw.length < MIN_PASSWORD_LENGTH) {
      setPwErrors({ next: t('passwordShort') });
      return;
    }
    if (newPw !== confirmPw) {
      setPwErrors({ next: t('passwordMismatch') });
      return;
    }
    setPwErrors({});
    setPwBusy(true);
    try {
      await changePassword(currentPw, newPw);
      setCurrentPw('');
      setNewPw('');
      setConfirmPw('');
      show(t('passwordChanged'));
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setPwErrors({ current: t('passwordWrong') });
      else if (err instanceof ApiError && err.status === 400) setPwErrors({ next: t('passwordShort') });
      else setPwErrors({ next: errorText(err, t) });
    } finally {
      setPwBusy(false);
    }
  };

  // --- Authenticator (TOTP) re-setup ---
  const [setupOpen, setSetupOpen] = useState(false);
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [setupCode, setSetupCode] = useState('');
  const [setupError, setSetupError] = useState<string | null>(null);
  const [setupBusy, setSetupBusy] = useState(false);
  const [codes, setCodes] = useState<string[] | null>(null);

  const closeSetup = () => {
    setSetupOpen(false);
    setSetup(null);
    setSetupCode('');
    setSetupError(null);
  };

  const confirmSetup = async (code: string) => {
    setSetupBusy(true);
    setSetupError(null);
    try {
      const res = await confirmTotpSetup(code);
      closeSetup();
      setCodes(res.recoveryCodes);
      show(t('totpSetupDone'));
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) setSetupError(t('codeRejected'));
      else setSetupError(errorText(err, t));
    } finally {
      setSetupBusy(false);
    }
  };

  // --- Recovery codes ---
  const [regenOpen, setRegenOpen] = useState(false);

  const regenerate = async (code: string) => {
    const res = await regenerateRecoveryCodes(code);
    setRegenOpen(false);
    setCodes(res.recoveryCodes);
  };

  // --- Sessions ---
  const [sessions, setSessions] = useState<SessionInfo[] | null>(null);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [signOutBusy, setSignOutBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    listSessions()
      .then((res) => {
        if (!cancelled) {
          setSessions(res.sessions);
          setSessionsError(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setSessionsError(errorText(err, t));
      });
    return () => {
      cancelled = true;
    };
  }, [t]);

  const signOut = useCallback(async () => {
    setSignOutBusy(true);
    try {
      await logout();
    } catch (err) {
      // A 401 means the session is already gone: sign out anyway.
      if (!(err instanceof ApiError && err.status === 401)) return;
    } finally {
      setSignOutBusy(false);
    }
    onSignedOut();
  }, [onSignedOut]);

  return (
    <div className="security-layout">
      <section className="card">
        <h2 className="security-card-title">{t('changePw')}</h2>
        <div className="security-pw-form">
          <Field
            id="pw-current"
            label={t('curPw')}
            type="password"
            autoComplete="current-password"
            value={currentPw}
            onChange={(v) => {
              setCurrentPw(v);
              setPwErrors((e) => ({ ...e, current: undefined }));
            }}
            error={pwErrors.current}
          />
          <Field
            id="pw-new"
            label={t('newPw')}
            type="password"
            autoComplete="new-password"
            value={newPw}
            onChange={(v) => {
              setNewPw(v);
              setPwErrors((e) => ({ ...e, next: undefined }));
            }}
            error={pwErrors.next}
          />
          <Field
            id="pw-confirm"
            label={t('confirmPw')}
            type="password"
            autoComplete="new-password"
            value={confirmPw}
            onChange={(v) => {
              setConfirmPw(v);
              setPwErrors((e) => ({ ...e, next: undefined }));
            }}
          />
          <Button className="security-pw-submit" variant="primary" icon="save" loading={pwBusy} disabled={!currentPw || !newPw || !confirmPw} onClick={() => void submitPassword()}>
            {t('save')}
          </Button>
        </div>
      </section>

      <section className="card">
        <h2 className="security-card-title">{t('totpSetup')}</h2>
        <p className="security-card-sub">{t('totpSetupSub')}</p>
        {!setup && (
          <Button variant="secondary" icon="mobile-screen" onClick={() => setSetupOpen(true)}>
            {t('setupAuthenticator')}
          </Button>
        )}
        {setup && (
          <div className="security-setup">
            <p className="security-setup-scan">{t('totpSetupScan')}</p>
            <div className="security-setup-row">
              <span className="security-setup-label">{t('totpSetupSecret')}</span>
              <code className="mono security-setup-value">{setup.secret}</code>
              <Button variant="ghost" size="sm" icon="copy" aria-label={t('copy')} onClick={() => { copyText(setup.secret); show(t('copied')); }} />
            </div>
            <div className="security-setup-row">
              <span className="security-setup-label">{t('totpSetupUri')}</span>
              <code className="mono security-setup-value security-setup-uri">{setup.uri}</code>
              <Button variant="ghost" size="sm" icon="copy" aria-label={t('copy')} onClick={() => { copyText(setup.uri); show(t('copied')); }} />
            </div>
            <div className="security-setup-confirm">
              <input
                className="totp-input"
                value={setupCode}
                onChange={(e) => {
                  setSetupCode(e.target.value.replace(/\D/g, '').slice(0, 6));
                  setSetupError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && setupCode.length === 6) void confirmSetup(setupCode);
                }}
                inputMode="numeric"
                autoComplete="one-time-code"
                aria-label={t('totpTitle')}
              />
              <Button variant="primary" loading={setupBusy} disabled={setupCode.length !== 6} onClick={() => void confirmSetup(setupCode)}>
                {t('totpSetupConfirm')}
              </Button>
            </div>
            {setupError ? (
              <p className="field-error" role="alert">
                {setupError}
              </p>
            ) : null}
          </div>
        )}
        {codes && <RecoveryCodes codes={codes} />}
        {setupOpen && (
          <TotpModal
            title={t('mTotpT')}
            body={t('mTotpB')}
            confirmLabel={t('save')}
            onConfirm={async (code) => {
              const res = await beginTotpSetup(code);
              setSetup(res);
              setSetupOpen(false);
            }}
            onClose={closeSetup}
          />
        )}
      </section>

      <section className="card">
        <h2 className="security-card-title">{t('recovery')}</h2>
        <p className="security-card-sub">{t('recoverySub')}</p>
        <Button className="security-regen" variant="secondary" icon="arrows-rotate" onClick={() => setRegenOpen(true)}>
          {t('regen')}
        </Button>
        {regenOpen && (
          <TotpModal
            title={t('mRegenT')}
            body={t('mRegenB')}
            confirmLabel={t('regen')}
            confirmIcon="arrows-rotate"
            destructive
            onConfirm={regenerate}
            onClose={() => setRegenOpen(false)}
          />
        )}
      </section>

      <section className="card">
        <h2 className="security-card-title">{t('sessionsTitle')}</h2>
        {sessionsError ? (
          <div className="alert alert-red" role="alert">
            <Icon name="triangle-exclamation" />
            <span>{sessionsError}</span>
          </div>
        ) : !sessions ? (
          <div className="security-sessions-loading" role="status">
            <Icon name="circle-notch" spin /> {t('sessionsLoading')}
          </div>
        ) : (
          <div className="security-sessions">
            <div className="security-sessions-head">
              <span>{t('device')}</span>
              <span>{t('ip')}</span>
              <span>{t('signedIn')}</span>
              <span>{t('expires')}</span>
              <span />
            </div>
            {sessions.map((s) => (
              <div key={s.id} className="security-sessions-row">
                <span className="security-sessions-device">
                  {s.device ? s.device.slice(0, DEVICE_MAX_CHARS) : t('unknownDevice')}
                  {s.current ? (
                    <Badge color="teal" icon="circle-check">
                      {t('currentSession')}
                    </Badge>
                  ) : null}
                </span>
                <span className="mono">{s.ip ?? '—'}</span>
                <span>{formatTime(s.createdAt, lang)}</span>
                <span>{formatTime(s.expiresAt, lang)}</span>
                {s.current ? (
                  <Button variant="ghost" size="sm" icon="right-from-bracket" loading={signOutBusy} onClick={() => void signOut()}>
                    {t('signOut')}
                  </Button>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
