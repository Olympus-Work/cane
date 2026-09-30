import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setFetchForTests, type SessionInfo } from '../src/api';
import { ToastProvider } from '../src/components/Toast';
import { I18nProvider } from '../src/i18n/index';
import { Security } from '../src/pages/settings/Security';
import { ThemeProvider } from '../src/theme';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

// jest-dom is not installed; a small local stand-in for its `toHaveTextContent`.
declare module 'vitest' {
  interface Assertion {
    toContainText(text: string): void;
  }
}
expect.extend({
  toContainText(received: unknown, text: string) {
    const ok = typeof received === 'object' && received !== null && 'textContent' in received && (received.textContent as string).includes(text);
    return { pass: ok, message: () => `expected element text "${(received as { textContent?: string }).textContent ?? ''}" to contain "${text}"` };
  },
});

const session = (over: Partial<SessionInfo> = {}): SessionInfo => ({
  id: 's1',
  device: 'Chrome on macOS',
  ip: '203.0.113.7',
  createdAt: '2026-09-26T08:00:00.000Z',
  expiresAt: '2026-10-03T08:00:00.000Z',
  current: false,
  ...over,
});

const defaultSessions: SessionInfo[] = [
  session({ id: 'cur', current: true, device: 'Chrome on macOS', ip: '203.0.113.7' }),
  session({ id: 'other', device: 'Firefox on Linux', ip: '198.51.100.9' }),
];

const codes10 = Array.from({ length: 10 }, (_, i) => `abcd${i}efgh`);

type Handler = (url: string, init?: RequestInit) => Response;

function mockFetch(handler: Handler) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => handler(String(input), init));
  setFetchForTests(fn);
  return fn;
}

function baseHandler(url: string, _init?: RequestInit): Response {
  if (url.endsWith('/v1/auth/sessions')) return json(200, { sessions: defaultSessions });
  return json(404, {});
}

function renderSecurity(fetchFn: ReturnType<typeof mockFetch>, onSignedOut: () => void = vi.fn()) {
  const utils = render(
    <I18nProvider initial="en">
      <ThemeProvider>
        <ToastProvider>
          <Security onSignedOut={onSignedOut} />
        </ToastProvider>
      </ThemeProvider>
    </I18nProvider>,
  );
  return { fetchFn, onSignedOut, ...utils };
}

async function fillPassword(cur: string, next: string, confirm: string) {
  fireEvent.change(screen.getByLabelText('Current password'), { target: { value: cur } });
  fireEvent.change(screen.getByLabelText('New password'), { target: { value: next } });
  fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: confirm } });
}

async function openRegenAndConfirm(code: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Regenerate' }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.change(within(dialog).getByLabelText('Two-factor code'), { target: { value: code } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Regenerate' }));
  return dialog;
}

describe('Settings > Security', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('keeps Save disabled until all three password fields are filled', async () => {
    const { fetchFn } = renderSecurity(mockFetch(baseHandler));
    await screen.findByText('Chrome on macOS');
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save.hasAttribute('disabled')).toBe(true);
    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'old-pass' } });
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'a'.repeat(12) } });
    expect(save.hasAttribute('disabled')).toBe(true);
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'a'.repeat(12) } });
    expect(save.hasAttribute('disabled')).toBe(false);
    expect(fetchFn).not.toHaveBeenCalledWith('/v1/auth/password', expect.anything());
  });

  it('rejects a short new password client-side without any request', async () => {
    const { fetchFn } = renderSecurity(mockFetch(baseHandler));
    await screen.findByText('Chrome on macOS');
    await fillPassword('old-pass', 'short-11ch', 'short-11ch');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toContainText('New password must be at least 12 characters.');
    expect(fetchFn).not.toHaveBeenCalledWith('/v1/auth/password', expect.anything());
  });

  it('rejects a mismatched confirm client-side without any request', async () => {
    const { fetchFn } = renderSecurity(mockFetch(baseHandler));
    await screen.findByText('Chrome on macOS');
    await fillPassword('old-pass', 'a'.repeat(12), 'b'.repeat(12));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toContainText('The two new passwords do not match.');
    expect(fetchFn).not.toHaveBeenCalledWith('/v1/auth/password', expect.anything());
  });

  it('changes the password and clears the fields on success', async () => {
    const { fetchFn } = renderSecurity(
      mockFetch((url, init) => (url.endsWith('/v1/auth/password') ? json(200, {}) : baseHandler(url, init))),
    );
    await screen.findByText('Chrome on macOS');
    await fillPassword('old-pass', 'c'.repeat(12), 'c'.repeat(12));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(fetchFn).toHaveBeenCalledWith('/v1/auth/password', expect.objectContaining({ method: 'POST' })));
    const call = fetchFn.mock.calls.find(([u]) => String(u).endsWith('/v1/auth/password'))?.[1];
    expect(JSON.parse(String(call?.body))).toEqual({ currentPassword: 'old-pass', newPassword: 'c'.repeat(12) });
    expect(await screen.findByText('Password changed. Other sessions were signed out.')).toBeTruthy();
    expect((screen.getByLabelText('Current password') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('New password') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('Confirm new password') as HTMLInputElement).value).toBe('');
  });

  it('shows passwordWrong on the current field when the server answers 401', async () => {
    renderSecurity(mockFetch((url, init) => (url.endsWith('/v1/auth/password') ? json(401, { message: 'wrong' }) : baseHandler(url, init))));
    await screen.findByText('Chrome on macOS');
    await fillPassword('old-pass', 'c'.repeat(12), 'c'.repeat(12));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toContainText('Current password is wrong.');
  });

  it('runs the TOTP re-setup: fresh-code modal, secret display, confirm, recovery codes', async () => {
    const { fetchFn } = renderSecurity(
      mockFetch((url, init) => {
        if (url.endsWith('/v1/auth/totp/setup')) return json(200, { secret: 'SECRET123', uri: 'otpauth://totp/Cane:owner?secret=SECRET123' });
        if (url.endsWith('/v1/auth/totp/confirm')) return json(200, { recoveryCodes: codes10 });
        return baseHandler(url, init);
      }),
    );
    await screen.findByText('Chrome on macOS');

    fireEvent.click(screen.getByRole('button', { name: 'Set up a new authenticator' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Confirm with authenticator' })).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText('Two-factor code'), { target: { value: '123456' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(fetchFn).toHaveBeenCalledWith('/v1/auth/totp/setup', expect.objectContaining({ method: 'POST' })));
    const setupCall = fetchFn.mock.calls.find(([u]) => String(u).endsWith('/v1/auth/totp/setup'))?.[1];
    expect(setupCall?.headers).toMatchObject({ 'x-totp-code': '123456' });
    // The modal closes and the secret + uri are shown for scanning.
    expect(await screen.findByText('SECRET123')).toBeTruthy();
    expect(screen.getByText('otpauth://totp/Cane:owner?secret=SECRET123')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'QR code for adding the account to your authenticator app' })).toBeTruthy(); // scannable setup
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.change(screen.getByLabelText('Two-factor code'), { target: { value: '234567' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(fetchFn).toHaveBeenCalledWith('/v1/auth/totp/confirm', expect.objectContaining({ method: 'POST' })));
    const confirmCall = fetchFn.mock.calls.find(([u]) => String(u).endsWith('/v1/auth/totp/confirm'))?.[1];
    expect(JSON.parse(String(confirmCall?.body))).toEqual({ code: '234567' });

    expect(await screen.findByText('Authenticator changed. New recovery codes were issued and other sessions were signed out.')).toBeTruthy();
    expect(screen.getByText('These codes are shown once. Store them offline now. Earlier codes no longer work.')).toBeTruthy();
    expect(screen.getByText('ABCD0EFGH')).toBeTruthy();
  });

  it('regenerates recovery codes after a fresh TOTP and shows the amber shown-once warning', async () => {
    const { fetchFn } = renderSecurity(
      mockFetch((url, init) => (url.endsWith('/v1/auth/recovery-codes') ? json(200, { recoveryCodes: codes10 }) : baseHandler(url, init))),
    );
    await screen.findByText('Chrome on macOS');

    await openRegenAndConfirm('111111');
    await waitFor(() => expect(fetchFn).toHaveBeenCalledWith('/v1/auth/recovery-codes', expect.objectContaining({ method: 'POST' })));
    const call = fetchFn.mock.calls.find(([u]) => String(u).endsWith('/v1/auth/recovery-codes'))?.[1];
    expect(call?.headers).toMatchObject({ 'x-totp-code': '111111' });

    expect(await screen.findByText('These codes are shown once. Store them offline now. Earlier codes no longer work.')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    const shown = codes10.map((c) => c.toUpperCase());
    for (const code of shown) expect(screen.getByText(code)).toBeTruthy();
  });

  it('keeps the regenerate modal open with the code error on 403', async () => {
    renderSecurity(mockFetch((url, init) => (url.endsWith('/v1/auth/recovery-codes') ? json(403, { message: 'bad code' }) : baseHandler(url, init))));
    await screen.findByText('Chrome on macOS');

    await openRegenAndConfirm('000000');
    const alert = await screen.findByRole('alert');
    expect(alert).toContainText('Code not accepted. Wait for the next code and try again.');
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('drops the codes from the document once the component unmounts and a fresh one renders', async () => {
    const first = renderSecurity(
      mockFetch((url, init) => (url.endsWith('/v1/auth/recovery-codes') ? json(200, { recoveryCodes: codes10 }) : baseHandler(url, init))),
    );
    await screen.findByText('Chrome on macOS');
    await openRegenAndConfirm('111111');
    expect(await screen.findByText('ABCD0EFGH')).toBeTruthy();
    first.unmount();

    renderSecurity(mockFetch(baseHandler));
    expect(await screen.findByText('Chrome on macOS')).toBeTruthy();
    expect(screen.queryByText('ABCD0EFGH')).toBeNull();
    expect(screen.queryByText('ABCD9EFGH')).toBeNull();
  });

  it('copies all codes to the clipboard when the API is available', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderSecurity(
      mockFetch((url, init) => (url.endsWith('/v1/auth/recovery-codes') ? json(200, { recoveryCodes: codes10 }) : baseHandler(url, init))),
    );
    await screen.findByText('Chrome on macOS');
    await openRegenAndConfirm('111111');
    fireEvent.click(await screen.findByRole('button', { name: 'Copy all' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(codes10.join('\n')));
    expect(await screen.findByText('Copied')).toBeTruthy();
  });

  it('downloads the codes as a text Blob file', async () => {
    const createSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock');
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    renderSecurity(
      mockFetch((url, init) => (url.endsWith('/v1/auth/recovery-codes') ? json(200, { recoveryCodes: codes10 }) : baseHandler(url, init))),
    );
    await screen.findByText('Chrome on macOS');
    await openRegenAndConfirm('111111');
    fireEvent.click(await screen.findByRole('button', { name: 'Download' }));

    expect(createSpy).toHaveBeenCalledTimes(1);
    const blob = createSpy.mock.calls[0]?.[0] as Blob;
    expect(await blob.text()).toBe(codes10.join('\n'));
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(revokeSpy).toHaveBeenCalledWith('blob:mock');
  });

  it('lists sessions with device and IP, and marks the current one', async () => {
    renderSecurity(mockFetch(baseHandler));
    expect(await screen.findByText('Chrome on macOS')).toBeTruthy();
    expect(screen.getByText('Firefox on Linux')).toBeTruthy();
    expect(screen.getByText('203.0.113.7')).toBeTruthy();
    expect(screen.getByText('198.51.100.9')).toBeTruthy();
    expect(screen.getByText('This session')).toBeTruthy();
    // Only the current session has a Sign out button.
    expect(screen.getAllByRole('button', { name: 'Sign out' })).toHaveLength(1);
  });

  it('shows an error when the session list cannot be loaded', async () => {
    renderSecurity(
      mockFetch((url, _init) => (url.endsWith('/v1/auth/sessions') ? json(500, { message: 'boom' }) : json(200, { sessions: [] }))),
    );
    expect(await screen.findByRole('alert')).toContainText('Something went wrong on the server. Try again.');
  });

  it('signs out: POST /v1/auth/logout then onSignedOut', async () => {
    const { fetchFn, onSignedOut } = renderSecurity(mockFetch((url, init) => (url.endsWith('/v1/auth/logout') ? json(200, {}) : baseHandler(url, init))));
    await screen.findByText('Chrome on macOS');
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(fetchFn).toHaveBeenCalledWith('/v1/auth/logout', expect.objectContaining({ method: 'POST' })));
    await waitFor(() => expect(onSignedOut).toHaveBeenCalledTimes(1));
  });

  it('still signs out when logout answers 401 (the session is gone anyway)', async () => {
    const { onSignedOut } = renderSecurity(mockFetch((url, init) => (url.endsWith('/v1/auth/logout') ? json(401, { message: 'expired' }) : baseHandler(url, init))));
    await screen.findByText('Chrome on macOS');
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(onSignedOut).toHaveBeenCalledTimes(1));
  });
});
