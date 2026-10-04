import { cleanup, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { I18nProvider } from '../src/i18n/index.js';
import type { AuditItem } from '../src/api.js';
import { AuditTable } from '../src/components/AuditTable.js';
import { afterEach, describe, expect, it } from 'vitest';

function wrap(ui: ReactElement) {
  return <I18nProvider initial="en">{ui}</I18nProvider>;
}

function item(over: Partial<AuditItem>): AuditItem {
  return {
    id: 1,
    at: '2026-02-08T09:00:00Z',
    actor: 'user',
    action: 'login_success',
    target: null,
    before: null,
    after: null,
    ip: null,
    ...over,
  };
}

describe('AuditTable', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders rows with a sentence-case action label and a one-line details string', () => {
    render(
      wrap(
        <AuditTable
          items={[
            item({ id: 1, action: 'strategy_enable', target: 'S-01', ip: '203.0.113.7', after: { status: 'enabled' } }),
            item({ id: 2, action: 'login_success', ip: '203.0.113.8' }),
            item({ id: 3, action: 'settings_changed' }),
          ]}
        />,
      ),
    );
    expect(screen.getByText('Strategy enable')).toBeTruthy();
    expect(screen.getByText('S-01 · from 203.0.113.7 · status=enabled')).toBeTruthy();
    expect(screen.getByText('Login success')).toBeTruthy();
    expect(screen.getByText('from 203.0.113.8')).toBeTruthy();
    expect(screen.getByText('Settings changed')).toBeTruthy();
  });

  it('shows the footer note even with zero items', () => {
    render(wrap(<AuditTable items={[]} />));
    expect(screen.getByText('Secrets are never written to the audit log.')).toBeTruthy();
  });
});
