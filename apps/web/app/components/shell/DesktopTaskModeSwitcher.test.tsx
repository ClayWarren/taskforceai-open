import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';

import '../../../../../tests/setup/dom';

const enableDesktopLocalCoding = vi.fn();
const disableDesktopLocalCoding = vi.fn();

vi.mock('../../lib/platform/desktop-api', () => ({
  enableDesktopLocalCoding,
  disableDesktopLocalCoding,
}));

import { DesktopTaskModeSwitcher } from './DesktopTaskModeSwitcher';
import {
  persistDesktopCodeWorkspace,
  persistDesktopCodeWorkspaceRoots,
  persistDesktopTaskMode,
} from '../../lib/desktop/task-mode';

describe('DesktopTaskModeSwitcher', () => {
  beforeEach(() => {
    window.localStorage.clear();
    enableDesktopLocalCoding.mockResolvedValue({
      workspace: '/tmp/project',
      serverName: 'workspace',
      serverNames: ['workspace'],
    });
    disableDesktopLocalCoding.mockResolvedValue({
      enabled: false,
      workspace: null,
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('shows only Chat and Work on the web', () => {
    const onModeChange = vi.fn();
    render(
      <DesktopTaskModeSwitcher mode="chat" desktopRuntime={false} onModeChange={onModeChange} />
    );

    expect(screen.queryByRole('button', { name: /Code mode/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Work mode/ }));
    expect(onModeChange).toHaveBeenCalledWith('work');
    expect(disableDesktopLocalCoding).not.toHaveBeenCalled();
  });

  it('enters desktop Code mode without requiring a workspace', async () => {
    const onModeChange = vi.fn();
    render(<DesktopTaskModeSwitcher mode="chat" desktopRuntime onModeChange={onModeChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Chat mode selector' }));
    fireEvent.click(screen.getByRole('button', { name: /Code mode/ }));

    await waitFor(() => expect(onModeChange).toHaveBeenCalledWith('code'));
    expect(enableDesktopLocalCoding).not.toHaveBeenCalled();
    expect(screen.queryByText('Choose Code workspace roots')).toBeNull();
  });

  it('activates multiple repository roots only in desktop Code mode', async () => {
    persistDesktopCodeWorkspaceRoots(['/tmp/project', '/tmp/shared', '/tmp/project']);
    enableDesktopLocalCoding.mockResolvedValueOnce({
      workspace: '/tmp/project',
      workspaceRoots: ['/tmp/project', '/tmp/shared'],
      serverName: 'workspace',
      serverNames: ['workspace'],
    });
    const onModeChange = vi.fn();
    render(<DesktopTaskModeSwitcher mode="chat" desktopRuntime onModeChange={onModeChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Chat mode selector' }));
    fireEvent.click(screen.getByRole('button', { name: /Code mode/ }));

    await waitFor(() =>
      expect(enableDesktopLocalCoding).toHaveBeenCalledWith({
        workspace: '/tmp/project',
        workspaceRoots: ['/tmp/project', '/tmp/shared'],
      })
    );
    expect(onModeChange).toHaveBeenCalledWith('code');
  });

  it('does not overwrite persisted Code mode while the desktop runtime is unavailable', async () => {
    persistDesktopTaskMode('code');
    const onModeChange = vi.fn();
    render(
      <DesktopTaskModeSwitcher mode="code" desktopRuntime={false} onModeChange={onModeChange} />
    );

    await Promise.resolve();
    expect(onModeChange).not.toHaveBeenCalled();
    expect(window.localStorage.getItem('taskforceai.desktop.task-mode.v1')).toBe('code');
  });

  it('keeps Code active when its persisted workspace cannot be restored', async () => {
    const onMissingWorkspace = vi.fn();
    const { unmount } = render(
      <DesktopTaskModeSwitcher mode="code" desktopRuntime onModeChange={onMissingWorkspace} />
    );
    await Promise.resolve();
    expect(onMissingWorkspace).not.toHaveBeenCalled();
    unmount();

    persistDesktopCodeWorkspace('/tmp/project');
    enableDesktopLocalCoding.mockRejectedValueOnce(new Error('workspace unavailable'));
    const onStartFailure = vi.fn();
    render(<DesktopTaskModeSwitcher mode="code" desktopRuntime onModeChange={onStartFailure} />);
    expect(await screen.findByText('Unable to restore the previous Code workspace.')).toBeTruthy();
    expect(onStartFailure).not.toHaveBeenCalled();
  });

  it('restores a persisted Code workspace once per activation', async () => {
    persistDesktopCodeWorkspace('/tmp/project');
    const firstModeChange = vi.fn();
    const { rerender } = render(
      <DesktopTaskModeSwitcher mode="code" desktopRuntime onModeChange={firstModeChange} />
    );
    await waitFor(() => expect(enableDesktopLocalCoding).toHaveBeenCalledTimes(1));

    rerender(<DesktopTaskModeSwitcher mode="code" desktopRuntime onModeChange={vi.fn()} />);
    await waitFor(() => expect(enableDesktopLocalCoding).toHaveBeenCalledTimes(1));
  });

  it('ignores a persisted Code restore that completes after Code mode is disabled', async () => {
    persistDesktopCodeWorkspace('/tmp/project');
    let finishRestore!: (value: {
      workspace: string;
      serverName: string;
      serverNames: string[];
    }) => void;
    enableDesktopLocalCoding.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishRestore = resolve;
        })
    );
    const onModeChange = vi.fn();
    const { rerender } = render(
      <DesktopTaskModeSwitcher mode="code" desktopRuntime onModeChange={onModeChange} />
    );
    await waitFor(() => expect(enableDesktopLocalCoding).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: 'Code mode selector' }));
    fireEvent.click(screen.getByRole('button', { name: /Work mode/ }));
    await waitFor(() => expect(disableDesktopLocalCoding).toHaveBeenCalledTimes(1));
    rerender(<DesktopTaskModeSwitcher mode="work" desktopRuntime onModeChange={onModeChange} />);

    finishRestore({
      workspace: '/tmp/project',
      serverName: 'workspace',
      serverNames: ['workspace'],
    });
    await Promise.resolve();
    rerender(<DesktopTaskModeSwitcher mode="code" desktopRuntime onModeChange={onModeChange} />);

    await waitFor(() => expect(enableDesktopLocalCoding).toHaveBeenCalledTimes(2));
  });

  it('opens a persisted workspace when Code is selected and reports startup failures', async () => {
    persistDesktopCodeWorkspace('/tmp/project');
    const onModeChange = vi.fn();
    const { unmount } = render(
      <DesktopTaskModeSwitcher mode="chat" desktopRuntime onModeChange={onModeChange} />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Chat mode selector' }));
    fireEvent.click(screen.getByRole('button', { name: /Code mode/ }));
    await waitFor(() => expect(onModeChange).toHaveBeenCalledWith('code'));
    unmount();

    enableDesktopLocalCoding.mockRejectedValueOnce(new Error('cannot start Code'));
    render(<DesktopTaskModeSwitcher mode="chat" desktopRuntime onModeChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Chat mode selector' }));
    fireEvent.click(screen.getByRole('button', { name: /Code mode/ }));
    expect(await screen.findByText('cannot start Code')).toBeTruthy();
  });

  it('disables local coding when leaving Code and keeps Code active on failure', async () => {
    persistDesktopCodeWorkspace('/tmp/project');
    const onModeChange = vi.fn();
    const { unmount } = render(
      <DesktopTaskModeSwitcher mode="code" desktopRuntime onModeChange={onModeChange} />
    );
    await waitFor(() => expect(enableDesktopLocalCoding).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'Code mode selector' }));
    fireEvent.click(screen.getByRole('button', { name: /Work mode/ }));
    await waitFor(() => expect(disableDesktopLocalCoding).toHaveBeenCalled());
    expect(onModeChange).toHaveBeenCalledWith('work');
    unmount();

    disableDesktopLocalCoding.mockRejectedValueOnce(new Error('cannot leave Code'));
    const onFailureModeChange = vi.fn();
    render(
      <DesktopTaskModeSwitcher mode="code" desktopRuntime onModeChange={onFailureModeChange} />
    );
    await waitFor(() => expect(enableDesktopLocalCoding).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'Code mode selector' }));
    fireEvent.click(screen.getByRole('button', { name: /Chat mode/ }));
    expect(await screen.findByText('cannot leave Code')).toBeTruthy();
    expect(onFailureModeChange).not.toHaveBeenCalledWith('chat');
  });
});
