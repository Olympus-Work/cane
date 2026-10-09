import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setFetchForTests, type SettingsView } from '../src/api';
import { ToastProvider } from '../src/components/Toast';
import { I18nProvider } from '../src/i18n/index';
import { Notifications } from '../src/pages/settings/Notifications';
import { ThemeProvider } from '../src/theme';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

function view(overrides: Partial<SettingsView['secrets']> = {}): SettingsView {
  return {
    secrets: {
      binance_api_key: null,
      binance_api_secret: null,
      jev_api_key: null,
      line_channel_token: null,
      line_user_id: null,
      telegram_bot_token: null,
      telegram_chat_id: null,
      ...overrides,
    },
    jevTimeoutMs: null,
  };
}

function renderNotif(settings: SettingsView, reload: () => Promise<void> = vi.fn(async () => undefined)) {
  return render(
    <ThemeProvider>
      <I18nProvider initial="en">
        <ToastProvider>
          <Notifications settings={settings} reload={reload} />
        </ToastProvider>
      </I18nProvider>
    </ThemeProvider>,
  );
}

const badge = (label: string, name: string) => screen.getByRole('region', { name: label }).querySelector(`.badge-${name}`);

describe('Settings > Notifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('shows a green configured badge only when BOTH secrets of a channel have hints', () => {
    renderNotif(view({ line_channel_token: 'AB12', line_user_id: 'CD34', telegram_bot_token: 'EF56' }));
    expect(badge('LINE', 'green')).toBeTruthy();
    // Telegram has only one of its two secrets: still amber.
    expect(badge('Telegram', 'amber')).toBeTruthy();
    expect(screen.getByText('Set up')).toBeTruthy();
    expect(screen.getByText('Not set up')).toBeTruthy();
  });

  it('shows a saved secret masked inside its empty input', () => {
    renderNotif(view({ line_channel_token: 'AB12', telegram_chat_id: '9012' }));
    expect(screen.getByPlaceholderText('•••• AB12')).toBeTruthy();
    expect(screen.getByPlaceholderText('•••• 9012')).toBeTruthy();
    expect(screen.getAllByText('Saved. Type a new value to replace it.').length).toBe(2);
    // Unsaved fields have no placeholder and keep the write-only hint.
    expect(screen.getAllByText('Write-only. Stored encrypted.').length).toBe(2);
  });

  it('shows a short saved secret (server hint ****) as the mask alone', () => {
    renderNotif(view({ telegram_chat_id: '****' }));
    expect(screen.getByPlaceholderText('••••')).toBeTruthy();
    expect(screen.queryByPlaceholderText('•••• ****')).toBeNull();
  });

  it('keeps Save disabled until at least one field has text', () => {
    renderNotif(view());
    const save = screen.getByRole('button', { name: 'Save with TOTP' });
    expect(save.hasAttribute('disabled')).toBe(true);
    fireEvent.change(screen.getByLabelText('Channel access token'), { target: { value: 'tok' } });
    expect(save.hasAttribute('disabled')).toBe(false);
  });

  it('saves with TOTP: the PUT carries only the filled fields, trimmed, with the x-totp-code header', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      expect(String(input)).toBe('/v1/settings/notifications');
      return json(200, { changed: ['line_channel_token', 'telegram_chat_id'] });
    });
    setFetchForTests(fetchMock);
    renderNotif(view());

    fireEvent.change(screen.getByLabelText('Channel access token'), { target: { value: '  LINE-TOKEN  ' } });
    fireEvent.change(screen.getByLabelText('Chat ID'), { target: { value: ' 12345 ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save with TOTP' }));

    const dialog = await screen.findByRole('dialog');
    const codeInput = within(dialog).getByLabelText('Two-factor code');
    fireEvent.change(codeInput, { target: { value: '123456' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save with TOTP' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('/v1/settings/notifications');
    expect(JSON.parse(String(init!.body))).toEqual({ lineChannelToken: 'LINE-TOKEN', telegramChatId: '12345' });
    expect(init!.headers).toMatchObject({ 'x-totp-code': '123456', 'content-type': 'application/json' });
  });

  it('clears the inputs, closes the modal and calls reload after a successful save', async () => {
    setFetchForTests(vi.fn(async () => json(200, { changed: ['line_channel_token'] })));
    const reload = vi.fn(async () => undefined);
    renderNotif(view(), reload);

    const tokenInput = screen.getByLabelText('Channel access token') as HTMLInputElement;
    fireEvent.change(tokenInput, { target: { value: 'tok' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save with TOTP' }));

    const dialog = await screen.findByRole('dialog');
    const codeInput = within(dialog).getByLabelText('Two-factor code');
    fireEvent.change(codeInput, { target: { value: '123456' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save with TOTP' }));

    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(tokenInput.value).toBe('');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.querySelector('.toast')).toBeTruthy();
    // No secret value remains in the document after save.
    expect(document.body.textContent).not.toContain('LINE-TOKEN');
  });

  it('sends a test message without a TOTP header and shows the delivered status on success', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('/v1/settings/notifications/test');
      expect(init!.headers).not.toMatchObject({ 'x-totp-code': expect.anything() });
      return json(200, { ok: true });
    });
    setFetchForTests(fetchMock);
    renderNotif(view());

    const buttons = screen.getAllByRole('button', { name: 'Send test message' });
    fireEvent.click(buttons[1]!); // Telegram
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]!.body))).toEqual({ channel: 'telegram' });
    expect(document.querySelector('.toast')).toBeTruthy();
    expect(screen.getByText('delivered')).toBeTruthy();
  });

  it('shows the server error in a negative status line when a test message fails', async () => {
    setFetchForTests(vi.fn(async () => json(200, { ok: false, error: 'LINE: channel token is invalid' })));
    renderNotif(view());

    const buttons = screen.getAllByRole('button', { name: 'Send test message' });
    fireEvent.click(buttons[0]!); // LINE
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Test message failed: LINE: channel token is invalid');
    expect(alert.className).toContain('notif-status-err');
  });
});
