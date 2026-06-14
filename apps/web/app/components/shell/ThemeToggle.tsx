import React, { useCallback, useEffect, useRef, useState } from 'react';

import { logger } from '../../lib/logger';
import {
  type ThemePreference,
  applyThemePreference,
  readStoredThemePreference,
  resolveInitialThemePreference,
  subscribeToSystemTheme,
} from '../../lib/platform/theme-preference';
import { cn } from '../../../lib/utils';

interface ThemeToggleProps {
  theme?: ThemePreference;
  onChange?: (_theme: ThemePreference) => void;
}

const ThemeToggle: React.FC<ThemeToggleProps> = ({ theme: propsTheme, onChange }) => {
  const [internalTheme, setInternalTheme] = useState<ThemePreference>(
    () => propsTheme ?? resolveInitialThemePreference()
  );

  const currentTheme = propsTheme ?? internalTheme;
  const currentThemeRef = useRef<ThemePreference>(currentTheme);

  useEffect(() => {
    currentThemeRef.current = currentTheme;
  }, [currentTheme]);

  useEffect(() => {
    if (propsTheme) {
      setInternalTheme(propsTheme);
    }
  }, [propsTheme]);

  useEffect(() => {
    const result = applyThemePreference(currentTheme);
    if (!result.ok) {
      logger.warn('Failed to apply theme preference', { error: result.error });
    }
  }, [currentTheme]);

  const handleSystemThemeChange = useCallback((_nextTheme: 'light' | 'dark') => {
    const stored = readStoredThemePreference();
    if (!stored.ok || stored.value === 'system' || currentThemeRef.current === 'system') {
      const result = applyThemePreference('system');
      if (!result.ok) {
        logger.warn('Failed to apply system theme preference', { error: result.error });
      }
    }
  }, []);

  useEffect(() => {
    const subscription = subscribeToSystemTheme(handleSystemThemeChange);

    if (!subscription.ok) {
      return undefined;
    }

    return subscription.value;
  }, [handleSystemThemeChange]);

  const handleThemeChange = (value: ThemePreference) => {
    if (onChange) {
      onChange(value);
    } else {
      setInternalTheme(value);
    }
  };

  const options: Array<{ value: ThemePreference; label: string }> = [
    { value: 'system', label: 'System' },
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
  ];

  return (
    <div className="flex items-center rounded-lg bg-black/20 p-1">
      {options.map((option) => (
        <button
          type="button"
          key={option.value}
          onClick={() => handleThemeChange(option.value)}
          className={cn(
            'rounded-md px-3 py-1.5 text-xs font-medium transition-all',
            currentTheme === option.value
              ? 'bg-white/10 text-white shadow-sm'
              : 'text-muted-foreground hover:text-slate-200'
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
};

export default ThemeToggle;
