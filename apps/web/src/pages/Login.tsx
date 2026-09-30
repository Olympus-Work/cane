import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, login } from '../api.js';
import { Button } from '../components/Button.js';
import { Field } from '../components/Field.js';
import { LangSwitch, ThemeToggle } from '../components/HeaderControls.js';
import { Icon } from '../components/Icon.js';
import { errorText } from '../components/errors.js';
import { useI18n } from '../i18n/index.js';
import './login.css';

/** Recovery codes are three hex groups of four, e.g. `a1b2-c3d4-e5f6`. */
const RECOVERY_RE = /^[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}$/;
const LOCK_SECONDS = 15 * 60;

function mmss(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** Login (spec 1): credentials, then a single 6-digit TOTP or a one-use recovery code. */
export function Login({ onSignedIn }: { onSignedIn(): void }) {
  const { t } = useI18n();
  const [step, setStep] = useState<1 | 2>(1);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [mode, setMode] = useState<'totp' | 'recovery'>('totp');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lockRemaining, setLockRemaining] = useState(0);

  const locked = lockRemaining > 0;

  useEffect(() => {
    if (!locked) return;
    const id = setInterval(() => setLockRemaining((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [locked]);

  const credentialsReady = email !== '' && password !== '' && !locked;
  const codeValid = mode === 'totp' ? code.length === 6 : RECOVERY_RE.test(code.trim());

  const onCodeChange = (value: string) => {
    setCode(mode === 'totp' ? value.replace(/\D/g, '').slice(0, 6) : value.slice(0, 14));
  };

  const goStep2 = (e: FormEvent) => {
    e.preventDefault();
    if (!credentialsReady) return;
    setError(null);
    setStep(2);
  };

  const back = () => {
    setError(null);
    setStep(1);
  };

  const verify = async (e: FormEvent) => {
    e.preventDefault();
    if (!codeValid || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await login(email, password, code);
      onSignedIn();
    } catch (err) {
      // The server never says which of the three was wrong; clear the secrets, keep the email.
      setPassword('');
      setCode('');
      setMode('totp');
      setStep(1);
      if (err instanceof ApiError && err.status === 423) {
        setError(null);
        setLockRemaining(LOCK_SECONDS);
      } else {
        setLockRemaining(0);
        setError(err instanceof ApiError && err.status === 401 ? t('loginFailed') : errorText(err, t));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-toprow">
          <div className="login-wordmark">
            <Icon name="wave-square" />
            <span>Cane</span>
          </div>
          <div className="login-toprow-controls">
            <LangSwitch />
            <ThemeToggle />
          </div>
        </div>

        {step === 1 ? (
          <>
            <div className="login-head">
              <h1 className="login-title">{t('loginTitle')}</h1>
              <p className="login-sub">{t('loginSub')}</p>
            </div>
            {locked ? (
              <div className="alert alert-red" role="alert">
                <Icon name="lock" />
                <div>
                  <div>{t('loginLocked')}</div>
                  <div className="login-lock-note">
                    <span>{t('tryAgainIn')}</span>
                    <span className="login-countdown">{mmss(lockRemaining)}</span>
                  </div>
                </div>
              </div>
            ) : error ? (
              <div className="alert alert-amber" role="alert">
                <Icon name="circle-exclamation" />
                <span>{error}</span>
              </div>
            ) : null}
            <form className="login-form" onSubmit={goStep2}>
              <Field
                id="login-email"
                label={t('email')}
                type="email"
                icon="envelope"
                autoComplete="username"
                value={email}
                onChange={setEmail}
                disabled={submitting}
              />
              <Field
                id="login-password"
                label={t('password')}
                type="password"
                icon="key"
                autoComplete="current-password"
                value={password}
                onChange={setPassword}
                disabled={submitting}
              />
              <Button type="submit" size="lg" block iconRight="arrow-right" disabled={!credentialsReady} loading={submitting}>
                {t('continue')}
              </Button>
            </form>
          </>
        ) : (
          <>
            <div className="login-shield">
              <Icon name="shield-halved" />
            </div>
            <div className="login-head">
              <h1 className="login-title">{t('totpTitle')}</h1>
              <p className="login-sub">{t('totpSub')}</p>
            </div>
            <form className="login-form" onSubmit={verify}>
              <input
                className={`login-code-input${mode === 'recovery' ? ' login-code-input-recovery' : ''}`}
                aria-label={mode === 'totp' ? t('totpTitle') : t('recoveryCodeLabel')}
                value={code}
                onChange={(e) => onCodeChange(e.target.value)}
                inputMode={mode === 'totp' ? 'numeric' : 'text'}
                autoComplete={mode === 'totp' ? 'one-time-code' : 'off'}
                maxLength={mode === 'totp' ? 6 : 14}
                placeholder={mode === 'recovery' ? 'xxxx-xxxx-xxxx' : undefined}
                autoFocus
                disabled={submitting}
              />
              <button type="button" className="login-textlink" onClick={() => setMode(mode === 'totp' ? 'recovery' : 'totp')} disabled={submitting}>
                {mode === 'totp' ? t('useRecovery') : t('useAuthenticator')}
              </button>
              <Button type="submit" size="lg" block disabled={!codeValid} loading={submitting}>
                {t('verify')}
              </Button>
              <button type="button" className="login-textlink" onClick={back} disabled={submitting}>
                {t('back')}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
