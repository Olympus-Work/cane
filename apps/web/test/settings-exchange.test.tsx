import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { ThemeProvider } from '../src/theme';
import { I18nProvider } from '../src/i18n/index';
import { setFetchForTests, type SettingsView } from '../src/api';
import { ToastProvider } from '../src/components/Toast';
import { ExchangeKeys } from '../src/pages/settings/ExchangeKeys';
import { TradingSettings } from '../src/pages/settings/TradingSettings';
import { afterEach, describe, expect, it, vi } from 'vitest';

const RAW_SECRET = 'super-secret-12345';

function savedSettings(overrides: Partial<SettingsView> = {}): SettingsView {
  return {
    secrets: {
      binance_api_key: '4F2A',
      binance_api_secret: '9B3C',
      jev_api_key: '77AA',
      line_channel_token: null,
      line_user_id: null,
      telegram_bot_token: null,
      telegram_chat_id: null,
    },
    jevTimeoutMs: 3000,
    ...overrides,
  };
}

function wrap(ui: ReactElement) {
  return (
    <I18nProvider initial="en">
      <ThemeProvider>
        <ToastProvider>{ui}</ToastProvider>
      </ThemeProvider>
    </I18nProvider>
  );
}

function mockFetch(body: unknown, status = 200) {
  const f = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(body), { status }));
  setFetchForTests(f);
  return f;
}

async function openTotpAndConfirm() {
  fireEvent.click(screen.getByRole('button', { name: 'Save with TOTP' }));
  const dialog = await screen.findByRole('dialog');
  const input = within(dialog).getByLabelText('Two-factor code') as HTMLInputElement;
  fireEvent.change(input, { target: { value: '123456' } });
  // The form's Save button is still in the DOM behind the modal; the modal's confirm is the last one.
  const confirms = screen.getAllByRole('button', { name: 'Save with TOTP' });
  fireEvent.click(confirms[confirms.length - 1] as HTMLButtonElement);
}

describe('ExchangeKeys', () => {
  afterEach(() => {
    cleanup();
  });

  it('shows the masked row with the hint and the restart note when a key is saved', () => {
    mockFetch({}, 200);
    render(wrap(<ExchangeKeys settings={savedSettings()} reload={vi.fn()} />));
    expect(screen.getByText('•••• 4F2A')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Replace' })).toBeTruthy();
    expect(screen.getByText('A new Binance key is used by the trading engine after the server restarts.')).toBeTruthy();
    // The form is not open yet.
    expect(screen.queryByLabelText('API key')).toBeNull();
  });

  it('saves through the TOTP modal with x-totp-code, clears the secret, and collapses to the masked row', async () => {
    const reload = vi.fn().mockResolvedValue(undefined);
    const f = mockFetch({ apiKey: '4F2A' }, 200);
    render(wrap(<ExchangeKeys settings={savedSettings()} reload={reload} />));

    fireEvent.click(screen.getByRole('button', { name: 'Replace' }));
    const keyInput = screen.getByLabelText('API key') as HTMLInputElement;
    const secretInput = screen.getByLabelText('API secret') as HTMLInputElement;
    expect(secretInput.type).toBe('password');
    // Neutral validation box before saving.
    expect(screen.getByText('Not validated yet')).toBeTruthy();

    fireEvent.change(keyInput, { target: { value: 'new-key' } });
    fireEvent.change(secretInput, { target: { value: RAW_SECRET } });
    await openTotpAndConfirm();

    await waitFor(() => expect(f).toHaveBeenCalledTimes(1));
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/v1/settings/binance-key');
    expect(init.method).toBe('PUT');
    expect((init.headers as Record<string, string>)['x-totp-code']).toBe('123456');
    expect(JSON.parse(String(init.body))).toEqual({ apiKey: 'new-key', apiSecret: RAW_SECRET });

    // Accepted box, toast, reload, back to the masked row — and the raw secret is gone from the DOM.
    await screen.findByText('Accepted');
    expect(screen.getByText('Read, Spot and Futures trading enabled. Withdrawals and universal transfer disabled.')).toBeTruthy();
    expect(screen.getByText('Saved')).toBeTruthy();
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(screen.getByText('•••• 4F2A')).toBeTruthy();
    expect(screen.queryByLabelText('API key')).toBeNull();
    expect(document.body.textContent).not.toContain(RAW_SECRET);
  });

  it('disables Save with TOTP until both fields are filled', () => {
    mockFetch({}, 200);
    render(wrap(<ExchangeKeys settings={savedSettings()} reload={vi.fn()} />));
    fireEvent.click(screen.getByRole('button', { name: 'Replace' }));

    const save = screen.getByRole('button', { name: 'Save with TOTP' });
    expect(save.hasAttribute('disabled')).toBe(true);

    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'new-key' } });
    expect(save.hasAttribute('disabled')).toBe(true);

    fireEvent.change(screen.getByLabelText('API secret'), { target: { value: 's' } });
    expect(save.hasAttribute('disabled')).toBe(false);
  });

  it('shows the withdrawal rejection on a 422, clears both inputs, and closes the modal', async () => {
    mockFetch({ message: 'Withdrawals are enabled on this key.', code: 'withdrawals_enabled' }, 422);
    render(wrap(<ExchangeKeys settings={savedSettings()} reload={vi.fn()} />));

    fireEvent.click(screen.getByRole('button', { name: 'Replace' }));
    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'new-key' } });
    fireEvent.change(screen.getByLabelText('API secret'), { target: { value: RAW_SECRET } });
    await openTotpAndConfirm();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Rejected: withdrawal permission is enabled');
    expect(alert.textContent).toContain('Create a key without withdrawal permission and paste it again.');
    // Modal is gone; the form stays open with cleared inputs.
    expect(screen.queryByLabelText('Two-factor code')).toBeNull();
    expect((screen.getByLabelText('API key') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('API secret') as HTMLInputElement).value).toBe('');
    expect(document.body.textContent).not.toContain(RAW_SECRET);
  });

  it('names the missing market on a market_not_enabled 422', async () => {
    mockFetch({ message: 'This key cannot trade futures.', code: 'market_not_enabled', markets: ['futures'] }, 422);
    render(wrap(<ExchangeKeys settings={savedSettings()} reload={vi.fn()} />));

    fireEvent.click(screen.getByRole('button', { name: 'Replace' }));
    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'new-key' } });
    fireEvent.change(screen.getByLabelText('API secret'), { target: { value: RAW_SECRET } });
    await openTotpAndConfirm();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Rejected: trading permission is missing');
    expect(alert.textContent).toContain('Futures trading is not enabled on this key.');
  });

  it('keeps the modal open with the code error on a 403', async () => {
    mockFetch({ message: 'totp rejected', code: 'totp_rejected' }, 403);
    render(wrap(<ExchangeKeys settings={savedSettings()} reload={vi.fn()} />));

    fireEvent.click(screen.getByRole('button', { name: 'Replace' }));
    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'new-key' } });
    fireEvent.change(screen.getByLabelText('API secret'), { target: { value: RAW_SECRET } });
    await openTotpAndConfirm();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Code not accepted. Wait for the next code and try again.');
    // The modal (and the TOTP input) is still open.
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('shows the not-configured note and no Cancel button when no key is saved', () => {
    mockFetch({}, 200);
    const settings = savedSettings();
    settings.secrets.binance_api_key = null;
    settings.secrets.binance_api_secret = null;
    render(wrap(<ExchangeKeys settings={settings} reload={vi.fn()} />));

    expect(screen.getByText('Not set up')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    expect(screen.getByLabelText('API key')).toBeTruthy();
  });
});

describe('TradingSettings', () => {
  afterEach(() => {
    cleanup();
  });

  it('rejects an out-of-range timeout with the range error and makes no request', async () => {
    const f = mockFetch({}, 200);
    render(wrap(<TradingSettings settings={savedSettings()} reload={vi.fn()} />));

    for (const bad of ['0.2', '11']) {
      fireEvent.change(screen.getByLabelText('Jev timeout'), { target: { value: bad } });
      fireEvent.click(screen.getByRole('button', { name: 'Save with TOTP' }));
      const error = screen.getByRole('alert');
      expect(error.textContent).toBe('Enter whole seconds from 0.5 to 10.');
      expect(screen.queryByLabelText('Two-factor code')).toBeNull();
    }
    expect(f).not.toHaveBeenCalled();
  });

  it('shows a saved Jev key masked inside its empty input, like the LINE fields', () => {
    render(wrap(<TradingSettings settings={savedSettings()} reload={vi.fn()} />));
    const input = screen.getByLabelText('Jev API key') as HTMLInputElement;
    expect(input.value).toBe('');
    expect(input.placeholder).toBe('•••• 77AA');
    expect(screen.getByText('Saved. Type a new value to replace it.')).toBeTruthy();
  });

  it('shows no mask and the write-only hint when no Jev key is saved', () => {
    const settings = savedSettings();
    render(wrap(<TradingSettings settings={{ ...settings, secrets: { ...settings.secrets, jev_api_key: null } }} reload={vi.fn()} />));
    expect((screen.getByLabelText('Jev API key') as HTMLInputElement).placeholder).toBe('');
    expect(screen.getByText('Write-only. Stored encrypted.')).toBeTruthy();
  });

  it('sends timeoutMs in milliseconds for a changed timeout', async () => {
    const f = mockFetch({ apiKey: '77AA', timeoutMs: 2500 }, 200);
    render(wrap(<TradingSettings settings={savedSettings()} reload={vi.fn()} />));

    fireEvent.change(screen.getByLabelText('Jev timeout'), { target: { value: '2.5' } });
    await openTotpAndConfirm();

    await waitFor(() => expect(f).toHaveBeenCalledTimes(1));
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/v1/settings/jev');
    expect((init.headers as Record<string, string>)['x-totp-code']).toBe('123456');
    expect(JSON.parse(String(init.body))).toEqual({ timeoutMs: 2500 });
    expect(screen.getByText('Saved')).toBeTruthy();
  });

  it('sends only the changed fields', async () => {
    // Timeout unchanged (3s), only the key is new -> only apiKey goes out.
    const f1 = mockFetch({ apiKey: '77AA', timeoutMs: 3000 }, 200);
    render(wrap(<TradingSettings settings={savedSettings()} reload={vi.fn()} />));
    fireEvent.change(screen.getByLabelText('Jev API key'), { target: { value: 'jev-key' } });
    await openTotpAndConfirm();
    await waitFor(() => expect(f1).toHaveBeenCalledTimes(1));
    expect(JSON.parse(String((f1.mock.calls[0] as unknown as [string, RequestInit])[1].body))).toEqual({ apiKey: 'jev-key' });
    cleanup();

    // Key empty, timeout changed -> only timeoutMs goes out.
    const f2 = mockFetch({ apiKey: null, timeoutMs: 5000 }, 200);
    setFetchForTests(f2);
    render(wrap(<TradingSettings settings={savedSettings()} reload={vi.fn()} />));
    fireEvent.change(screen.getByLabelText('Jev timeout'), { target: { value: '5' } });
    await openTotpAndConfirm();
    await waitFor(() => expect(f2).toHaveBeenCalledTimes(1));
    expect(JSON.parse(String((f2.mock.calls[0] as unknown as [string, RequestInit])[1].body))).toEqual({ timeoutMs: 5000 });
  });

  it('disables Save when nothing changed', () => {
    mockFetch({}, 200);
    render(wrap(<TradingSettings settings={savedSettings()} reload={vi.fn()} />));
    expect(screen.getByRole('button', { name: 'Save with TOTP' }).hasAttribute('disabled')).toBe(true);
  });
});
