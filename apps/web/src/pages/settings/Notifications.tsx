import { useState } from 'react';
import { saveNotifications, sendTestMessage, type SecretKey, type SettingsView } from '../../api.js';
import { Badge } from '../../components/Badge.js';
import { Button } from '../../components/Button.js';
import { Field } from '../../components/Field.js';
import { Icon } from '../../components/Icon.js';
import { TotpModal } from '../../components/TotpModal.js';
import { useToast } from '../../components/Toast.js';
import { errorText } from '../../components/errors.js';
import { useI18n } from '../../i18n/index.js';
import './notifications.css';

type Channel = 'line' | 'telegram';

interface TestState {
  ok: boolean;
  text: string;
}

/** Settings > Notifications (spec 5): one card per channel, one shared "Save with TOTP". */
export function Notifications({ settings, reload }: { settings: SettingsView; reload(): Promise<void> }) {
  const { t } = useI18n();
  const { show } = useToast();
  const [lineToken, setLineToken] = useState('');
  const [lineTarget, setLineTarget] = useState('');
  const [tgToken, setTgToken] = useState('');
  const [tgChat, setTgChat] = useState('');
  const [testing, setTesting] = useState<Channel | null>(null);
  const [testLine, setTestLine] = useState<TestState | null>(null);
  const [testTg, setTestTg] = useState<TestState | null>(null);
  const [totpOpen, setTotpOpen] = useState(false);

  const secrets = settings.secrets;
  const lineConfigured = Boolean(secrets.line_channel_token && secrets.line_user_id);
  const tgConfigured = Boolean(secrets.telegram_bot_token && secrets.telegram_chat_id);
  const anyText = [lineToken, lineTarget, tgToken, tgChat].some((v) => v.trim().length > 0);

  const hintFor = (key: SecretKey): string => (secrets[key] ? `•••• ${secrets[key]}` : t('fieldTargetHint'));

  const runTest = async (channel: Channel) => {
    const set = channel === 'line' ? setTestLine : setTestTg;
    setTesting(channel);
    set(null);
    try {
      const r = await sendTestMessage(channel);
      if (r.ok) {
        set({ ok: true, text: t('testDelivered') });
        show(t('testSent'));
      } else {
        set({ ok: false, text: `${t('testFailed')}: ${r.error ?? t('serverError')}` });
      }
    } catch (err) {
      set({ ok: false, text: errorText(err, t) });
    } finally {
      setTesting(null);
    }
  };

  const save = async (code: string) => {
    // Write-only secrets: clear the inputs on every attempt, success or failure.
    const clear = () => {
      setLineToken('');
      setLineTarget('');
      setTgToken('');
      setTgChat('');
    };
    try {
      await saveNotifications(
        {
          lineChannelToken: lineToken.trim() || undefined,
          lineUserId: lineTarget.trim() || undefined,
          telegramBotToken: tgToken.trim() || undefined,
          telegramChatId: tgChat.trim() || undefined,
        },
        code,
      );
      clear();
      setTotpOpen(false);
      show(t('tSaved'));
      await reload();
    } catch (err) {
      clear();
      throw err; // the modal shows it
    }
  };

  const statusLine = (state: TestState | null) =>
    state ? (
      <p className={`notif-status ${state.ok ? 'notif-status-ok' : 'notif-status-err'}`} role={state.ok ? 'status' : 'alert'}>
        <Icon name={state.ok ? 'circle-check' : 'circle-xmark'} /> {state.text}
      </p>
    ) : (
      <p className="notif-status notif-status-muted">
        <Icon name="circle-info" /> {t('never')}
      </p>
    );

  return (
    <div className="notif-section">
      <p className="notif-note">
        <Icon name="circle-info" /> {t('notifSavedNote')}
      </p>

      <section className="card notif-card" aria-label={t('line')}>
        <header className="notif-card-header">
          <h3 className="notif-card-title">
            <Icon family="brands" name="line" className="notif-brand" /> {t('line')}
          </h3>
          {lineConfigured ? (
            <Badge color="green" icon="circle-check">
              {t('configured')}
            </Badge>
          ) : (
            <Badge color="amber" icon="circle-exclamation">
              {t('notConfigured')}
            </Badge>
          )}
        </header>
        <div className="notif-fields">
          <Field id="notif-line-token" label={t('token')} type="password" autoComplete="off" value={lineToken} onChange={setLineToken} hint={hintFor('line_channel_token')} />
          <Field id="notif-line-target" label={t('target')} type="password" autoComplete="off" value={lineTarget} onChange={setLineTarget} hint={hintFor('line_user_id')} />
        </div>
        <footer className="notif-card-footer">
          <Button variant="secondary" size="sm" icon="paper-plane" loading={testing === 'line'} onClick={() => void runTest('line')}>
            {t('sendTest')}
          </Button>
          {statusLine(testLine)}
        </footer>
      </section>

      <section className="card notif-card" aria-label={t('telegram')}>
        <header className="notif-card-header">
          <h3 className="notif-card-title">
            <Icon family="brands" name="telegram" className="notif-brand" /> {t('telegram')}
          </h3>
          {tgConfigured ? (
            <Badge color="green" icon="circle-check">
              {t('configured')}
            </Badge>
          ) : (
            <Badge color="amber" icon="circle-exclamation">
              {t('notConfigured')}
            </Badge>
          )}
        </header>
        <div className="notif-fields">
          <Field id="notif-tg-token" label={t('botToken')} type="password" autoComplete="off" value={tgToken} onChange={setTgToken} hint={hintFor('telegram_bot_token')} />
          <Field id="notif-tg-chat" label={t('chatId')} type="password" autoComplete="off" value={tgChat} onChange={setTgChat} hint={hintFor('telegram_chat_id')} />
        </div>
        <footer className="notif-card-footer">
          <Button variant="secondary" size="sm" icon="paper-plane" loading={testing === 'telegram'} onClick={() => void runTest('telegram')}>
            {t('sendTest')}
          </Button>
          {statusLine(testTg)}
        </footer>
      </section>

      <Button icon="check" disabled={!anyText} onClick={() => setTotpOpen(true)}>
        {t('saveTotp')}
      </Button>

      {totpOpen && (
        <TotpModal title={t('mTotpT')} body={t('mTotpB')} confirmLabel={t('saveTotp')} confirmIcon="check" onConfirm={save} onClose={() => setTotpOpen(false)} />
      )}
    </div>
  );
}
