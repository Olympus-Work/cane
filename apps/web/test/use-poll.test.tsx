import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePoll } from '../src/lib/usePoll';

function setHidden(hidden: boolean): void {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('usePoll', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    setHidden(false);
    vi.useRealTimers();
  });

  it('calls now and on every interval while the tab is visible', async () => {
    const fn = vi.fn(async () => 1);
    renderHook(() => usePoll(fn, 1000));
    expect(fn).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(fn).toHaveBeenCalledTimes(4);
  });

  it('skips calls while the tab is hidden and calls once when it shows again', async () => {
    const fn = vi.fn(async () => 1);
    renderHook(() => usePoll(fn, 1000));
    await act(async () => {
      setHidden(true);
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(fn).toHaveBeenCalledTimes(1);
    await act(async () => {
      setHidden(false);
    });
    expect(fn).toHaveBeenCalledTimes(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('a one-shot poll (no interval) does not refetch when the tab shows again', async () => {
    const fn = vi.fn(async () => 1);
    renderHook(() => usePoll(fn, null));
    await act(async () => {
      setHidden(true);
      setHidden(false);
    });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('stops after unmount', async () => {
    const fn = vi.fn(async () => 1);
    const { unmount } = renderHook(() => usePoll(fn, 1000));
    unmount();
    await act(async () => {
      setHidden(false);
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
