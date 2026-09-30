import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { act } from 'react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setFetchForTests } from '../src/api';
import { ToastProvider } from '../src/components/Toast';
import { I18nProvider } from '../src/i18n/index';
import { Login } from '../src/pages/Login';
import { ThemeProvider } from '../src/theme';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

function wrap(ui: ReactElement, lang: 'en' | 'th' = 'en') {
  return (
    <I18nProvider initial={lang}>
      <ThemeProvider>
        <ToastProvider>{ui}</ToastProvider>
      </ThemeProvider>
    </I18nProvider>
  );
}

function renderLogin(onSignedIn: () => void = vi.fn(), lang: 'en' | 'th' = 'en') {
  return { onSignedIn, ...render(wrap(<Login onSignedIn={onSignedIn} />, lang)) };
}

/** Fills step 1, moves to step 2 and types a 6-digit code. */
async function reachStep2() {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'owner@cane.local' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'cane' } });
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  const code = (await screen.findByLabelText('Two-factor code')) as HTMLInputElement;
  fireEvent.change(code, { target: { value: '123456' } });
  return code;
}

function lastLoginCall(fetchMock: ReturnType<typeof vi.fn>) {
  const call = fetchMock.mock.calls.at(-1);
  const url = call ? String(call[0]) : '';
  const init = (call ? call[1] : undefined) as RequestInit | undefined;
  const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, string>) : {};
  const headers = (init?.headers ?? {}) as Record<string, string>;
  return { url, body, headers };
}

describe('Login', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('goes from step 1 to step 2 without any fetch, then sends one login call with the right body and no x-totp-code header', async () => {
    const fetchMock = vi.fn(async () => json(200, { expiresAt: '2026-10-01T00:00:00Z' }));
    setFetchForTests(fetchMock);
    const { onSignedIn } = renderLogin();

    await reachStep2();
    expect(fetchMock).not.toHaveBeenCalled(); // nothing is sent at step 1

    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
    await waitFor(() => expect(onSignedIn).toHaveBeenCalledTimes(1));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const { url, body, headers } = lastLoginCall(fetchMock);
    expect(url).toBe('/v1/auth/login');
    expect(body).toEqual({ email: 'owner@cane.local', password: 'cane', code: '123456' });
    expect('x-totp-code' in headers).toBe(false);
  });

  it('on 401: shows loginFailed, clears the password, returns to step 1 and keeps the email', async () => {
    setFetchForTests(vi.fn(async () => json(401, { message: 'Invalid credentials' })));
    renderLogin();
    await reachStep2();
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Email, password or code is incorrect.');
    // back on step 1: email kept, password cleared
    expect((screen.getByLabelText('Email') as HTMLInputElement).value).toBe('owner@cane.local');
    expect((screen.getByLabelText('Password') as HTMLInputElement).value).toBe('');
    expect(screen.getByRole('button', { name: 'Continue' })).toBeTruthy();
  });

  it('on 423: shows the locked alert with a 15:00 countdown that ticks to 14:59, disables Continue and re-enables it after 900 s', async () => {
    setFetchForTests(vi.fn(async () => json(423, { message: 'locked' })));
    renderLogin();
    await reachStep2();
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
    await act(async () => {
      /* flush the mocked fetch's microtasks */
    });
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Too many failed attempts. Sign-in is locked for 15 minutes.');
    expect(alert.textContent).toContain('15:00');
    expect(screen.getByRole('button', { name: 'Continue' }).hasAttribute('disabled')).toBe(true);

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(alert.textContent).toContain('14:59');

    act(() => {
      vi.advanceTimersByTime(899 * 1000);
    });
    // lock expired: the alert is gone and Continue works again once a password is entered
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'cane' } });
    expect(screen.getByRole('button', { name: 'Continue' }).hasAttribute('disabled')).toBe(false);
  });

  it('recovery-code mode: the input switches, Verify enables on a valid code and the code is sent as `code`', async () => {
    const fetchMock = vi.fn(async () => json(200, { expiresAt: '2026-10-01T00:00:00Z' }));
    setFetchForTests(fetchMock);
    const { onSignedIn } = renderLogin();
    await reachStep2();

    fireEvent.click(screen.getByRole('button', { name: 'Use a recovery code' }));
    const input = screen.getByLabelText('Recovery code') as HTMLInputElement;
    expect(input.getAttribute('placeholder')).toBe('xxxx-xxxx-xxxx');

    fireEvent.change(input, { target: { value: 'a1b2-c3d4' } });
    expect(screen.getByRole('button', { name: 'Verify' }).hasAttribute('disabled')).toBe(true);
    fireEvent.change(input, { target: { value: 'a1b2-c3d4-e5f6' } });
    expect(screen.getByRole('button', { name: 'Verify' }).hasAttribute('disabled')).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
    await waitFor(() => expect(onSignedIn).toHaveBeenCalledTimes(1));
    const { body } = lastLoginCall(fetchMock);
    expect(body.code).toBe('a1b2-c3d4-e5f6');
  });

  it('Verify stays disabled for 5 digits', async () => {
    setFetchForTests(vi.fn(async () => json(200, { expiresAt: '2026-10-01T00:00:00Z' })));
    renderLogin();
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'owner@cane.local' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'cane' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    const code = (await screen.findByLabelText('Two-factor code')) as HTMLInputElement;
    fireEvent.change(code, { target: { value: '12345' } });
    expect(screen.getByRole('button', { name: 'Verify' }).hasAttribute('disabled')).toBe(true);
  });

  it('shows the Thai title when the language is Thai', () => {
    renderLogin(vi.fn(), 'th');
    expect(screen.getByText('เข้าสู่ระบบ Cane')).toBeTruthy();
  });
});
