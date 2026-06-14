import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'bun:test';

import OfflineIndicator from './OfflineIndicator';

describe('OfflineIndicator', () => {
  let addEventListenerSpy: ReturnType<typeof vi.fn>;
  let removeEventListenerSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    addEventListenerSpy = vi.fn();
    removeEventListenerSpy = vi.fn();

    window.addEventListener = addEventListenerSpy;
    window.removeEventListener = removeEventListenerSpy;
    Object.defineProperty(navigator, 'onLine', {
      value: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders nothing when online', () => {
    Object.defineProperty(navigator, 'onLine', {
      value: true,
      configurable: true,
    });
    const { container } = render(<OfflineIndicator />);
    expect(container.firstChild).toBeNull();
  });

  it('adds event listeners on mount', () => {
    render(<OfflineIndicator />);

    expect(addEventListenerSpy).toHaveBeenCalledWith('online', expect.any(Function));
    expect(addEventListenerSpy).toHaveBeenCalledWith('offline', expect.any(Function));
  });

  it('removes event listeners on unmount', () => {
    const { unmount } = render(<OfflineIndicator />);
    unmount();

    expect(removeEventListenerSpy).toHaveBeenCalledWith('online', expect.any(Function));
    expect(removeEventListenerSpy).toHaveBeenCalledWith('offline', expect.any(Function));
  });

  it('shows offline message when navigator.onLine is false', () => {
    Object.defineProperty(navigator, 'onLine', {
      value: false,
      configurable: true,
    });
    render(<OfflineIndicator />);

    expect(screen.getByText(/you're offline/i)).toBeTruthy();
  });

  it('shows a temporary back-online transition after reconnecting', () => {
    vi.useFakeTimers();
    let onlineHandler: (() => void) | undefined;
    let offlineHandler: (() => void) | undefined;
    addEventListenerSpy.mockImplementation((event: string, handler: () => void) => {
      if (event === 'online') onlineHandler = handler;
      if (event === 'offline') offlineHandler = handler;
    });

    render(<OfflineIndicator />);

    act(() => {
      offlineHandler?.();
    });
    expect(screen.getByText(/you're offline/i)).toBeTruthy();

    act(() => {
      onlineHandler?.();
    });
    expect(screen.getByText('Back online')).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.queryByText('Back online')).toBeNull();
    vi.useRealTimers();
  });
});
