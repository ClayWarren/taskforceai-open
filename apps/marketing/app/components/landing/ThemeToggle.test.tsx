import '../../../../../tests/setup/dom';

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import { err, ok, type Result } from '@taskforceai/shared/result';

type ThemePreference = 'system' | 'light' | 'dark';
type ThemeApplyResult = Result<true, { kind: string; message: string }>;

const themeMocks = {
  applyThemePreference: vi.fn((_theme: ThemePreference): ThemeApplyResult => ok(true)),
  readStoredThemePreference: vi.fn(() => ({ ok: true, value: 'system' as ThemePreference })),
  resolveInitialThemePreference: vi.fn(() => 'system' as ThemePreference),
  subscribeToSystemTheme: vi.fn((_onChange: () => void) => ({ ok: true, value: vi.fn() })),
};

vi.mock('@taskforceai/ui-kit/theme/themePreference', () => ({
  applyThemePreference: themeMocks.applyThemePreference,
  readStoredThemePreference: themeMocks.readStoredThemePreference,
  resolveInitialThemePreference: themeMocks.resolveInitialThemePreference,
  subscribeToSystemTheme: themeMocks.subscribeToSystemTheme,
}));

const loggerMocks = {
  warn: vi.fn(),
};

vi.mock('../../lib/logger', () => ({
  logger: loggerMocks,
}));

import { ThemeToggle } from './ThemeToggle';

describe('ThemeToggle', () => {
  beforeEach(() => {
    themeMocks.applyThemePreference.mockReset();
    themeMocks.applyThemePreference.mockReturnValue(ok(true));
    themeMocks.readStoredThemePreference.mockReset();
    themeMocks.readStoredThemePreference.mockReturnValue({ ok: true, value: 'system' });
    themeMocks.resolveInitialThemePreference.mockReset();
    themeMocks.resolveInitialThemePreference.mockReturnValue('system');
    themeMocks.subscribeToSystemTheme.mockReset();
    themeMocks.subscribeToSystemTheme.mockReturnValue({ ok: true, value: vi.fn() });
    loggerMocks.warn.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('resolves the initial theme and applies user-selected themes', async () => {
    themeMocks.resolveInitialThemePreference.mockReturnValue('dark');
    const user = userEvent.setup({ pointerEventsCheck: 0 });

    render(<ThemeToggle className="custom-toggle" />);

    const group = screen.getByRole('radiogroup', { name: 'Color theme' });
    expect(group.className).toContain('custom-toggle');

    await waitFor(() => {
      expect(screen.getByRole('radio', { name: 'Dark theme' }).getAttribute('aria-checked')).toBe(
        'true'
      );
    });
    expect(themeMocks.applyThemePreference).toHaveBeenCalledWith('dark', { setDarkClass: true });

    await user.click(screen.getByRole('radio', { name: 'Light theme' }));

    await waitFor(() => {
      expect(screen.getByRole('radio', { name: 'Light theme' }).getAttribute('aria-checked')).toBe(
        'true'
      );
    });
    expect(themeMocks.applyThemePreference).toHaveBeenLastCalledWith('light', {
      setDarkClass: true,
    });
  });

  it('reapplies system theme changes while system preference is active and cleans up', () => {
    const unsubscribe = vi.fn();
    let onSystemThemeChange: (() => void) | undefined;
    themeMocks.subscribeToSystemTheme.mockImplementation((onChange: () => void) => {
      onSystemThemeChange = onChange;
      return { ok: true, value: unsubscribe };
    });

    const { unmount } = render(<ThemeToggle />);

    expect(themeMocks.subscribeToSystemTheme).toHaveBeenCalledWith(expect.any(Function));

    onSystemThemeChange?.();

    expect(themeMocks.readStoredThemePreference).toHaveBeenCalled();
    expect(themeMocks.applyThemePreference).toHaveBeenCalledWith('system', { setDarkClass: true });

    unmount();
    expect(unsubscribe).toHaveBeenCalled();
  });

  it('logs failed theme application attempts', async () => {
    themeMocks.applyThemePreference.mockReturnValue(
      err({ kind: 'failed', message: 'Theme write failed.' })
    );

    render(<ThemeToggle />);

    await waitFor(() => {
      expect(loggerMocks.warn).toHaveBeenCalledWith('Failed to apply theme preference', {
        error: { kind: 'failed', message: 'Theme write failed.' },
      });
    });
  });
});
