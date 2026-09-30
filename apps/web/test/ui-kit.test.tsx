import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { act } from 'react';
import type { ReactElement } from 'react';
import { ThemeProvider } from '../src/theme';
import { I18nProvider } from '../src/i18n/index';
import { ApiError, NetworkError } from '../src/api';
import { Button } from '../src/components/Button';
import { Field } from '../src/components/Field';
import { TotpModal } from '../src/components/TotpModal';
import { ToastProvider, useToast } from '../src/components/Toast';
import { errorText } from '../src/components/errors';
import { afterEach, describe, expect, it, vi } from 'vitest';

function wrap(ui: ReactElement) {
  return (
    <I18nProvider initial="en">
      <ThemeProvider>{ui}</ThemeProvider>
    </I18nProvider>
  );
}

describe('UI kit', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('Button shows a spinner and is disabled while loading', () => {
    const { container } = render(
      wrap(
        <Button loading onClick={() => undefined}>
          Save
        </Button>,
      ),
    );
    const btn = screen.getByRole('button');
    expect(btn.hasAttribute('disabled')).toBe(true);
    expect(container.querySelector('.fa-circle-notch.fa-spin')).toBeTruthy();
  });

  it('Field links its error via aria-describedby and exposes role="alert"', () => {
    render(
      wrap(
        <Field id="email" label="Email" value="" onChange={() => undefined} error="Email is required" />,
      ),
    );
    const input = screen.getByLabelText('Email');
    const error = screen.getByRole('alert');
    expect(error.textContent).toBe('Email is required');
    expect(input.getAttribute('aria-describedby')).toBe('email-error');
    expect(error.id).toBe('email-error');
  });

  it('TotpModal: Confirm stays disabled until 6 digits, strips letters, calls onConfirm, and shows codeRejected on 403', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(
      wrap(
        <TotpModal title="Confirm" body="Enter a code." confirmLabel="Confirm" onConfirm={onConfirm} onClose={() => undefined} />,
      ),
    );
    const confirm = screen.getByRole('button', { name: 'Confirm' });
    expect(confirm.hasAttribute('disabled')).toBe(true);

    const input = screen.getByLabelText('Two-factor code') as HTMLInputElement;
    // Letters are stripped as the user types: 'ab12cd34' -> '1234' (4 digits, still disabled).
    fireEvent.change(input, { target: { value: 'ab12cd34' } });
    expect(input.value).toBe('1234');
    expect(confirm.hasAttribute('disabled')).toBe(true);
    // Complete the code to 6 digits: Confirm enables.
    fireEvent.change(input, { target: { value: '123456' } });
    expect(input.value).toBe('123456');
    expect(confirm.hasAttribute('disabled')).toBe(false);

    fireEvent.click(confirm);
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect(onConfirm).toHaveBeenCalledWith('123456');
  });

  it('TotpModal: a 403 rejection shows codeRejected and clears the input', async () => {
    const onConfirm = vi.fn().mockRejectedValue(new ApiError(403, '', null, {}));
    render(
      wrap(
        <TotpModal title="Confirm" body="Enter a code." confirmLabel="Confirm" onConfirm={onConfirm} onClose={() => undefined} />,
      ),
    );
    const input = screen.getByLabelText('Two-factor code') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Code not accepted. Wait for the next code and try again.');
    expect(input.value).toBe('');
  });

  it('TotpModal: a 500 rejection shows the serverError text', async () => {
    const onConfirm = vi.fn().mockRejectedValue(new ApiError(500, 'boom', null, {}));
    render(
      wrap(
        <TotpModal title="Confirm" body="Enter a code." confirmLabel="Confirm" onConfirm={onConfirm} onClose={() => undefined} />,
      ),
    );
    const input = screen.getByLabelText('Two-factor code') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Something went wrong on the server. Try again.');
  });

  it('Modal: Escape calls onClose', () => {
    const onClose = vi.fn();
    render(
      wrap(
        <TotpModal title="Confirm" body="Enter a code." confirmLabel="Confirm" onConfirm={async () => undefined} onClose={onClose} />,
      ),
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Toast appears and disappears after 2600 ms', () => {
    vi.useFakeTimers();
    function Trigger() {
      const { show } = useToast();
      return (
        <button type="button" onClick={() => show('Saved')}>
          show
        </button>
      );
    }
    render(
      wrap(
        <ToastProvider>
          <Trigger />
        </ToastProvider>,
      ),
    );
    expect(screen.queryByRole('status')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'show' }));
    const toast = screen.getByRole('status');
    expect(toast.textContent).toContain('Saved');
    act(() => {
      vi.advanceTimersByTime(2599);
    });
    expect(screen.getByRole('status')).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('errorText maps errors to the right messages', () => {
    const t = (key: string) => key;
    expect(errorText(new NetworkError(), t)).toBe('networkError');
    expect(errorText(new ApiError(401, '', null, {}), t)).toBe('sessionExpired');
    expect(errorText(new ApiError(502, 'bad gateway', null, {}), t)).toBe('serverError');
    expect(errorText(new ApiError(400, 'pair must be a USDT pair', null, {}), t)).toBe('pair must be a USDT pair');
    expect(errorText(new Error('unexpected'), t)).toBe('serverError');
  });
});
