import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, mock, vi } from 'bun:test';

import '../../../../tests/setup/dom';

import { DesktopCompanion } from './DesktopCompanion';

const basePet = {
  visible: true,
  name: 'Orbit',
  message: 'Standing by',
  mood: 'idle',
} as const;

const originalClearInterval = window.clearInterval;

describe('DesktopCompanion', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    window.clearInterval = originalClearInterval;
    cleanup();
    vi.useRealTimers();
  });

  it('renders nothing when the desktop pet is hidden or missing', () => {
    const { rerender } = render(<DesktopCompanion pet={null} />);

    expect(screen.queryByLabelText(/companion/)).toBeNull();

    rerender(<DesktopCompanion pet={{ ...basePet, visible: false }} />);

    expect(screen.queryByLabelText(/companion/)).toBeNull();
  });

  it('renders the companion label, message, and idle mood colors', () => {
    render(<DesktopCompanion pet={basePet} />);

    const companion = screen.getByLabelText('Orbit companion');

    expect(companion).toBeTruthy();
    expect(companion.getAttribute('title')).toBe('Standing by');
    expect(companion.querySelector('.from-slate-300')).toBeTruthy();
  });

  it('maps alert, celebrate, and default moods to the expected colors', () => {
    const { rerender } = render(<DesktopCompanion pet={{ ...basePet, mood: 'alert' }} />);

    expect(screen.getByLabelText('Orbit companion').querySelector('.from-rose-300')).toBeTruthy();

    rerender(<DesktopCompanion pet={{ ...basePet, mood: 'celebrate' }} />);
    expect(
      screen.getByLabelText('Orbit companion').querySelector('.from-emerald-200')
    ).toBeTruthy();

    rerender(<DesktopCompanion pet={{ ...basePet, mood: 'working' as any }} />);
    expect(screen.getByLabelText('Orbit companion').querySelector('.from-sky-200')).toBeTruthy();
  });

  it('blinks on an interval and clears the timer on unmount', () => {
    const clearIntervalSpy = mock(window.clearInterval);
    window.clearInterval = clearIntervalSpy as typeof window.clearInterval;

    const { unmount } = render(<DesktopCompanion pet={basePet} />);

    const companion = screen.getByLabelText('Orbit companion');
    expect(companion.querySelector('.h-2\\.5')).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(2600);
    });

    expect(companion.querySelector('.h-1.w-3')).toBeTruthy();

    unmount();

    expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
  });
});
