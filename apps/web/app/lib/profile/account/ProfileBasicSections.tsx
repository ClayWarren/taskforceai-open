'use client';

import clsx from 'clsx';

import ThemeToggle from '../../../components/shell/ThemeToggle';
import type { ThemePreference } from '../../platform/theme-preference';

export function FeedbackBanner(props: {
  className?: string;
  message: string | null;
  kind: 'success' | 'error';
}) {
  if (!props.message) {
    return null;
  }
  return (
    <div
      className={clsx(
        'mb-4 rounded-md border px-3 py-2 text-sm',
        props.kind === 'success'
          ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800/60 dark:bg-emerald-900/30 dark:text-emerald-100'
          : 'border-red-200 bg-red-50 text-red-700 dark:border-red-800/60 dark:bg-red-900/30 dark:text-red-100',
        props.className
      )}
      role="status"
    >
      {props.message}
    </div>
  );
}

export function ProfileDetailsSection(props: { fullName: string; email: string }) {
  return (
    <div className="space-y-4">
      <div>
        <label className="mb-1 block text-xs font-medium text-muted-foreground uppercase">
          Name
        </label>
        <div id="profile-fullname" className="text-sm font-medium">
          {props.fullName || 'Not set'}
        </div>
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-muted-foreground uppercase">
          Email
        </label>
        <div id="profile-email" className="text-sm font-medium">
          {props.email}
        </div>
      </div>
    </div>
  );
}

export function SettingsSection(props: {
  theme: ThemePreference;
  onThemeChange: (_theme: ThemePreference) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium">Theme</label>
        <ThemeToggle theme={props.theme} onChange={props.onThemeChange} />
      </div>
    </div>
  );
}
