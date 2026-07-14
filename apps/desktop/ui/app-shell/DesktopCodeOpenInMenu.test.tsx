import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import type { ReactNode } from 'react';

import '../../../../tests/setup/dom';

const openDesktopWorkspaceIn = vi.fn(async () => undefined);

vi.mock('@taskforceai/ui-kit/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onSelect }: { children: ReactNode; onSelect?: () => void }) => (
    <button type="button" onClick={onSelect}>
      {children}
    </button>
  ),
  DropdownMenuLabel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('../platform/app-server', () => ({
  openDesktopWorkspaceIn,
}));

import { DesktopCodeOpenInMenu } from './DesktopCodeOpenInMenu';

const ROOTS_KEY = 'taskforceai.desktop.code-workspace-roots.v2';

describe('DesktopCodeOpenInMenu', () => {
  beforeEach(() => {
    window.localStorage.clear();
    openDesktopWorkspaceIn.mockReset();
    openDesktopWorkspaceIn.mockResolvedValue(undefined);
  });

  afterEach(() => cleanup());

  it('disables opening applications until a workspace is selected', () => {
    render(<DesktopCodeOpenInMenu />);

    expect(screen.getByRole('button', { name: 'Open workspace in' }).hasAttribute('disabled')).toBe(
      true
    );
    fireEvent.click(screen.getByRole('button', { name: 'VS Code' }));
    expect(openDesktopWorkspaceIn).not.toHaveBeenCalled();
  });

  it('selects a workspace and opens every supported application target', async () => {
    window.localStorage.setItem(ROOTS_KEY, JSON.stringify(['/tmp/first', '/tmp/second']));
    render(<DesktopCodeOpenInMenu />);

    fireEvent.click(screen.getByRole('button', { name: 'second' }));
    for (const [name, target] of [
      ['VS Code', 'vscode'],
      ['Cursor', 'cursor'],
      ['Finder', 'finder'],
      ['Terminal', 'terminal'],
      ['Xcode', 'xcode'],
    ] as const) {
      fireEvent.click(screen.getByRole('button', { name }));
      await waitFor(() =>
        expect(openDesktopWorkspaceIn).toHaveBeenCalledWith({ root: '/tmp/second', target })
      );
    }
  });

  it('falls back to the current stored root when the selected root disappears', async () => {
    window.localStorage.setItem(ROOTS_KEY, JSON.stringify(['/tmp/first', '/tmp/second']));
    const { rerender } = render(<DesktopCodeOpenInMenu />);
    fireEvent.click(screen.getByRole('button', { name: 'second' }));

    window.localStorage.setItem(ROOTS_KEY, JSON.stringify(['/tmp/replacement']));
    rerender(<DesktopCodeOpenInMenu />);
    fireEvent.click(screen.getByRole('button', { name: 'Terminal' }));

    await waitFor(() =>
      expect(openDesktopWorkspaceIn).toHaveBeenCalledWith({
        root: '/tmp/replacement',
        target: 'terminal',
      })
    );
  });

  it('shows errors returned while opening an application', async () => {
    window.localStorage.setItem(ROOTS_KEY, JSON.stringify(['/tmp/project']));
    openDesktopWorkspaceIn
      .mockRejectedValueOnce(new Error('Application unavailable'))
      .mockRejectedValueOnce('Permission denied');
    render(<DesktopCodeOpenInMenu />);

    fireEvent.click(screen.getByRole('button', { name: 'Cursor' }));
    expect(await screen.findByText('Application unavailable')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Finder' }));
    expect(await screen.findByText('Permission denied')).toBeTruthy();
  });
});
