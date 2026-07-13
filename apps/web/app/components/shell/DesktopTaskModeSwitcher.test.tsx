import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import path from 'path';

import '../../../../../tests/setup/dom';

const appPath = (value: string) => path.resolve(process.cwd(), 'apps/web/app', value);
const enableDesktopLocalCoding = vi.fn();
const disableDesktopLocalCoding = vi.fn();

vi.mock(appPath('lib/platform/desktop/app-server'), () => ({
  enableDesktopLocalCoding,
  disableDesktopLocalCoding,
}));

import { DesktopTaskModeSwitcher } from './DesktopTaskModeSwitcher';
import { persistDesktopCodeWorkspace } from '../../lib/desktop/task-mode';

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

  it('requires and activates a scoped workspace for desktop Code mode', async () => {
    const onModeChange = vi.fn();
    render(<DesktopTaskModeSwitcher mode="chat" desktopRuntime onModeChange={onModeChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Chat mode selector' }));
    fireEvent.click(screen.getByRole('button', { name: /Code mode/ }));
    fireEvent.input(screen.getByLabelText('Repository directories (one per line)'), {
      target: { value: '/tmp/project' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Open in Code' }));

    await waitFor(() =>
      expect(enableDesktopLocalCoding).toHaveBeenCalledWith({
        workspace: '/tmp/project',
      })
    );
    expect(onModeChange).toHaveBeenCalledWith('code');
  });

  it('activates multiple repository roots only in desktop Code mode', async () => {
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
    fireEvent.input(screen.getByLabelText('Repository directories (one per line)'), {
      target: { value: '/tmp/project\n/tmp/shared\n/tmp/project' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Open in Code' }));

    await waitFor(() =>
      expect(enableDesktopLocalCoding).toHaveBeenCalledWith({
        workspace: '/tmp/project',
        workspaceRoots: ['/tmp/project', '/tmp/shared'],
      })
    );
    expect(onModeChange).toHaveBeenCalledWith('code');
  });

  it('rejects persisted Code mode on the web', async () => {
    const onModeChange = vi.fn();
    render(
      <DesktopTaskModeSwitcher mode="code" desktopRuntime={false} onModeChange={onModeChange} />
    );

    await waitFor(() => expect(onModeChange).toHaveBeenCalledWith('chat'));
  });

  it('falls back when a persisted desktop Code workspace is missing or cannot start', async () => {
    const onMissingWorkspace = vi.fn();
    const { unmount } = render(
      <DesktopTaskModeSwitcher mode="code" desktopRuntime onModeChange={onMissingWorkspace} />
    );
    await waitFor(() => expect(onMissingWorkspace).toHaveBeenCalledWith('chat'));
    unmount();

    persistDesktopCodeWorkspace('/tmp/project');
    enableDesktopLocalCoding.mockRejectedValueOnce(new Error('workspace unavailable'));
    const onStartFailure = vi.fn();
    render(<DesktopTaskModeSwitcher mode="code" desktopRuntime onModeChange={onStartFailure} />);
    await waitFor(() => expect(onStartFailure).toHaveBeenCalledWith('chat'));
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

  it('keeps the workspace dialog open when Code activation fails', async () => {
    enableDesktopLocalCoding.mockRejectedValueOnce(new Error('invalid workspace'));
    render(<DesktopTaskModeSwitcher mode="chat" desktopRuntime onModeChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Chat mode selector' }));
    fireEvent.click(screen.getByRole('button', { name: /Code mode/ }));
    fireEvent.input(screen.getByLabelText('Repository directories (one per line)'), {
      target: { value: '/tmp/missing' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Open in Code' }));

    expect(await screen.findByText('invalid workspace')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open in Code' })).toBeTruthy();
  });
});
