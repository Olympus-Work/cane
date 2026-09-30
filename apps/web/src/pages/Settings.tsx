import { useCallback, useEffect, useState } from 'react';
import { readSettings, type SettingsView } from '../api.js';
import { Icon } from '../components/Icon.js';
import { errorText } from '../components/errors.js';
import { useI18n } from '../i18n/index.js';
import { ExchangeKeys } from './settings/ExchangeKeys.js';
import { Notifications } from './settings/Notifications.js';
import { Security } from './settings/Security.js';
import { TradingSettings } from './settings/TradingSettings.js';
import './settings.css';

type Tab = 'keys' | 'notif' | 'trading' | 'security';
const TABS: Array<{ id: Tab; icon: string; label: string }> = [
  { id: 'keys', icon: 'key', label: 'exKeys' },
  { id: 'notif', icon: 'bell', label: 'notif' },
  { id: 'trading', icon: 'sliders', label: 'trading' },
  { id: 'security', icon: 'lock', label: 'security' },
];

/** Settings (spec 5): a 220 px sub-nav and a 720 px content column. */
export function Settings({ onSignedOut }: { onSignedOut(): void }) {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>('keys');
  const [settings, setSettings] = useState<SettingsView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setSettings(await readSettings());
      setError(null);
    } catch (err) {
      setError(errorText(err, t));
    }
  }, [t]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <div className="settings-layout">
      <nav className="settings-subnav" aria-label={t('settings')}>
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`settings-subnav-item${tab === item.id ? ' settings-subnav-active' : ''}`}
            aria-current={tab === item.id ? 'page' : undefined}
            onClick={() => setTab(item.id)}
          >
            <Icon name={item.icon} /> {t(item.label)}
          </button>
        ))}
      </nav>
      <section className="settings-content">
        <h1 className="settings-title">{t('settings')}</h1>
        {error && (
          <div className="alert alert-amber" role="alert">
            <Icon name="triangle-exclamation" /> <span>{error}</span>
          </div>
        )}
        {tab === 'security' && <Security onSignedOut={onSignedOut} />}
        {tab !== 'security' && !settings && !error && (
          <div role="status">
            <Icon name="circle-notch" spin /> {t('syncing')}
          </div>
        )}
        {settings && tab === 'keys' && <ExchangeKeys settings={settings} reload={reload} />}
        {settings && tab === 'notif' && <Notifications settings={settings} reload={reload} />}
        {settings && tab === 'trading' && <TradingSettings settings={settings} reload={reload} />}
      </section>
    </div>
  );
}
