import clsx from 'clsx';

import type { DesktopUpdateAction } from '../app-shell/useDesktopShellActions';

interface DesktopUpdateButtonProps {
  desktopUpdateVersion: string;
  desktopUpdateAction: DesktopUpdateAction;
  onCheckForUpdates: () => void;
}

export function DesktopUpdateButton({
  desktopUpdateVersion,
  desktopUpdateAction,
  onCheckForUpdates,
}: DesktopUpdateButtonProps) {
  const isBusy = desktopUpdateAction !== 'idle';
  const label =
    desktopUpdateAction === 'installing'
      ? 'Installing...'
      : desktopUpdateAction === 'checking'
        ? 'Checking...'
        : desktopUpdateVersion
          ? `Update ${desktopUpdateVersion}`
          : 'Check updates';

  return (
    <button
      type="button"
      className={clsx(
        'hidden items-center gap-2 rounded-full border border-blue-300/50',
        'bg-blue-400/15 px-4 py-2 text-sm font-semibold text-blue-100 shadow-[0_18px_42px_rgba(37,99,235,0.24)]',
        'backdrop-blur-xl transition hover:border-blue-200/70 hover:bg-blue-400/20 lg:inline-flex'
      )}
      onClick={onCheckForUpdates}
      disabled={isBusy}
      aria-busy={isBusy || undefined}
      aria-label={
        desktopUpdateAction === 'installing'
          ? `Installing TaskForceAI ${desktopUpdateVersion}`
          : `Install TaskForceAI ${desktopUpdateVersion}`
      }
    >
      <span
        className={clsx(
          'h-2 w-2 rounded-full bg-blue-200 shadow-[0_0_14px_rgba(191,219,254,0.9)]',
          isBusy && 'animate-pulse'
        )}
      />
      <span>{label}</span>
    </button>
  );
}
