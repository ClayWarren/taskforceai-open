import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';

import '../../../../../tests/setup/dom';
import { useMobileViewport } from './useMobileViewport';

describe('useMobileViewport', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const setViewportWidth = (width: number) => {
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: width,
    });
  };

  it('detects initial mobile and desktop viewport widths', () => {
    setViewportWidth(640);
    const mobile = renderHook(() => useMobileViewport());
    expect(mobile.result.current).toBe(true);
    mobile.unmount();

    setViewportWidth(1024);
    const desktop = renderHook(() => useMobileViewport());
    expect(desktop.result.current).toBe(false);
  });

  it('debounces resize updates and clears pending timers on unmount', () => {
    setViewportWidth(1024);
    const { result, unmount } = renderHook(() => useMobileViewport());
    expect(result.current).toBe(false);

    setViewportWidth(480);
    act(() => {
      window.dispatchEvent(new Event('resize'));
      vi.advanceTimersByTime(149);
    });
    expect(result.current).toBe(false);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe(true);

    setViewportWidth(900);
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    unmount();
    act(() => {
      vi.advanceTimersByTime(150);
    });
  });
});
