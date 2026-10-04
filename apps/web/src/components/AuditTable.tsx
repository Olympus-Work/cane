import type { AuditItem } from '../api.js';
import { fmtDateTime } from '../lib/format.js';
import { useI18n } from '../i18n/index.js';
import { Icon } from './Icon.js';
import './grid-table.css';
import './audit-table.css';

function actionLabel(action: string): string {
  const words = action.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function actionIcon(action: string): string {
  if (action.startsWith('strategy_')) return 'chess-knight';
  if (/^(login|logout|password|totp|recovery)/.test(action)) return 'shield-halved';
  if (/^(settings|key|notification)/.test(action)) return 'gear';
  if (action.startsWith('kill')) return 'power-off';
  return 'clipboard-list';
}

function detailsOf(item: AuditItem): string {
  const parts = [item.target, item.ip ? `from ${item.ip}` : null].filter((p): p is string => p !== null && p !== '');
  // Summarise `after` as a few key=value pairs; never dump raw JSON of unknown size.
  const after = item.after;
  if (typeof after === 'object' && after !== null && !Array.isArray(after)) {
    const keys = Object.keys(after);
    if (keys.length >= 1 && keys.length <= 4) {
      const pairs = keys.map((k) => `${k}=${String((after as Record<string, unknown>)[k]).slice(0, 40)}`);
      parts.push(pairs.join(', '));
    }
  }
  return parts.join(' · ');
}

export function AuditTable({ items }: { items: AuditItem[] }) {
  const { t } = useI18n();
  return (
    <div>
      <div className="gt-scroll">
        <div className="gt-head audit-head">
          <span>{t('time')}</span>
          <span>{t('action')}</span>
          <span>{t('details')}</span>
        </div>
        {items.map((item) => (
          <div key={item.id} className="gt-row audit-row">
            <span className="audit-time">{fmtDateTime(item.at)}</span>
            <span className="audit-action">
              <Icon name={actionIcon(item.action)} />
              {actionLabel(item.action)}
            </span>
            <span className="audit-details">{detailsOf(item)}</span>
          </div>
        ))}
      </div>
      <div className="audit-note">
        <Icon name="eye-slash" />
        {t('auditNote')}
      </div>
    </div>
  );
}
