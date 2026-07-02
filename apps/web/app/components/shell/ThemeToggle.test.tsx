import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'bun:test';

import '../../../../../tests/setup/dom';

vi.mock('../../lib/logger', () => ({
  logger: {
    warn: vi.fn(),
  },
}));

vi.mock('../../lib/platform/theme-preference', () => ({
  applyThemePreference: vi.fn(() => ({ ok: true, value: true })),
  readStoredThemePreference: vi.fn(() => ({ ok: false, error: { kind: 'missing' } })),
  resolveInitialThemePreference: vi.fn(() => 'system'),
  subscribeToSystemTheme: vi.fn(() => ({ ok: true, value: vi.fn() })),
}));

vi.mock('../../../lib/utils', () => ({
  cn: (...classes: (string | undefined | null | false)[]) => classes.filter(Boolean).join(' '),
}));

import ThemeToggle from './ThemeToggle';
import { logger } from '../../lib/logger';
import {
  applyThemePreference,
  readStoredThemePreference,
  subscribeToSystemTheme,
} from '../../lib/platform/theme-preference';

describe('ThemeToggle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders three theme options', () => {
    render(<ThemeToggle />);

    const systemButton = screen.getByRole('button', { name: /system/i });
    const lightButton = screen.getByRole('button', { name: /light/i });
    const darkButton = screen.getByRole('button', { name: /dark/i });

    expect(systemButton).toBeTruthy();
    expect(lightButton).toBeTruthy();
    expect(darkButton).toBeTruthy();
    expect(systemButton).toHaveAttribute('type', 'button');
    expect(lightButton).toHaveAttribute('type', 'button');
    expect(darkButton).toHaveAttribute('type', 'button');
  });

  it('calls onChange when theme button is clicked', () => {
    const handleChange = vi.fn();
    render(<ThemeToggle onChange={handleChange} />);

    const darkButton = screen.getByRole('button', { name: /dark/i });
    fireEvent.click(darkButton);

    expect(handleChange).toHaveBeenCalledWith('dark');
  });

  it('uses internal state when onChange is not provided', () => {
    render(<ThemeToggle />);

    const darkButton = screen.getByRole('button', { name: /dark/i });
    fireEvent.click(darkButton);

    expect(darkButton).toBeTruthy();
  });

  it('respects externally provided theme prop', () => {
    render(<ThemeToggle theme="dark" />);

    const darkButton = screen.getByRole('button', { name: /dark/i });
    expect(darkButton).toBeTruthy();
  });

  it('logs apply failures and missing system subscriptions', () => {
    (applyThemePreference as any).mockReturnValueOnce({
      ok: false,
      error: { kind: 'failed' },
    });
    (subscribeToSystemTheme as any).mockReturnValueOnce({
      ok: false,
      error: { kind: 'unavailable' },
    });

    render(<ThemeToggle />);

    expect(logger.warn).toHaveBeenCalledWith('Failed to apply theme preference', {
      error: { kind: 'failed' },
    });
  });

  it('applies system theme when the system preference changes', () => {
    let systemHandler: ((_theme: 'light' | 'dark') => void) | undefined;
    (subscribeToSystemTheme as any).mockImplementationOnce((handler: any) => {
      systemHandler = handler;
      return { ok: true, value: vi.fn() };
    });
    (readStoredThemePreference as any).mockReturnValueOnce({ ok: true, value: 'system' });

    render(<ThemeToggle theme="system" />);
    systemHandler?.('dark');

    expect(applyThemePreference).toHaveBeenCalledWith('system');
  });
});
