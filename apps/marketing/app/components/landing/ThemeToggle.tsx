import { Monitor, Moon, Sun } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  type ThemePreference,
  applyThemePreference,
  readStoredThemePreference,
  resolveInitialThemePreference,
  subscribeToSystemTheme,
} from '@taskforceai/ui-kit/theme/themePreference';

import { logger } from '../../lib/logger';
import { cn } from '../../lib/utils';

const OPTIONS: Array<{ value: ThemePreference; label: string; Icon: typeof Sun }> = [
  { value: 'system', label: 'System theme', Icon: Monitor },
  { value: 'light', label: 'Light theme', Icon: Sun },
  { value: 'dark', label: 'Dark theme', Icon: Moon },
];

const apply = (theme: ThemePreference) => {
  const result = applyThemePreference(theme, { setDarkClass: true });
  if (!result.ok) {
    logger.warn('Failed to apply theme preference', { error: result.error });
  }
};

export function ThemeToggle({ className }: { className?: string }) {
  const [mounted, setMounted] = useState(false);
  const [theme, setTheme] = useState<ThemePreference>('system');
  const themeRef = useRef(theme);

  useEffect(() => {
    const initialTheme = resolveInitialThemePreference();
    themeRef.current = initialTheme;
    setTheme(initialTheme);
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) {
      return;
    }
    themeRef.current = theme;
    apply(theme);
  }, [mounted, theme]);

  const handleSystemThemeChange = useCallback(() => {
    const stored = readStoredThemePreference();
    if (!stored.ok || stored.value === 'system' || themeRef.current === 'system') {
      apply('system');
    }
  }, []);

  useEffect(() => {
    const subscription = subscribeToSystemTheme(handleSystemThemeChange);
    return subscription.ok ? subscription.value : undefined;
  }, [handleSystemThemeChange]);

  return (
    <div
      className={cn(
        'inline-flex items-center gap-0.5 rounded-full border border-slate-200 bg-slate-100/80 p-0.5 dark:border-white/10 dark:bg-white/5',
        className
      )}
      role="radiogroup"
      aria-label="Color theme"
    >
      {OPTIONS.map(({ value, label, Icon }) => {
        const active = theme === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={label}
            title={label}
            onClick={() => setTheme(value)}
            className={cn(
              'inline-flex h-7 w-7 items-center justify-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/70',
              active
                ? 'bg-white text-slate-900 shadow-sm dark:bg-white/15 dark:text-white'
                : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
            )}
          >
            <Icon className="h-3.5 w-3.5" />
          </button>
        );
      })}
    </div>
  );
}
