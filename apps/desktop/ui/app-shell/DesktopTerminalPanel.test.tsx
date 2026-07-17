import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';

import '../../../../tests/setup/dom';

const getDesktopTerminalLaunchConfig = mock();

mock.module('../platform/app-server', () => ({ getDesktopTerminalLaunchConfig }));
mock.module('./DesktopTerminalSession', () => ({
  DesktopTerminalSession: ({
    active,
    config,
    onExited,
  }: {
    active: boolean;
    config: { backend: string };
    onExited: () => void;
  }) => (
    <div data-active={String(active)} data-testid="terminal-session">
      {config.backend}
      <button type="button" onClick={onExited}>
        Exit session
      </button>
    </div>
  ),
}));

import { DesktopTerminalPanel } from './DesktopTerminalPanel';

const nativeConfig = {
  command: '/bin/zsh',
  args: ['-l'],
  cwd: '/workspace',
  workspaceRoot: '/workspace',
  backend: 'native',
  wslAvailable: false,
  wslDistributions: [],
};

describe('DesktopTerminalPanel', () => {
  beforeEach(() => {
    localStorage.clear();
    getDesktopTerminalLaunchConfig.mockReset();
    getDesktopTerminalLaunchConfig.mockResolvedValue(nativeConfig);
  });

  afterEach(() => cleanup());

  it('keeps the terminal shell mounted but hidden while closed', () => {
    render(<DesktopTerminalPanel open={false} onClose={mock()} />);

    expect(screen.getByLabelText('Desktop terminal').classList.contains('hidden')).toBe(true);
    expect(getDesktopTerminalLaunchConfig).not.toHaveBeenCalled();
  });

  it('starts an interactive terminal tab when opened', async () => {
    render(<DesktopTerminalPanel open={true} onClose={mock()} />);

    await waitFor(() => expect(getDesktopTerminalLaunchConfig).toHaveBeenCalled());
    expect(await screen.findByTestId('terminal-session')).toHaveTextContent('native');
    expect(screen.getByText('Shell')).toBeTruthy();
    expect(screen.getByText('workspace')).toBeTruthy();
  });

  it('creates additional terminal tabs', async () => {
    render(<DesktopTerminalPanel open={true} onClose={mock()} />);
    await screen.findByTestId('terminal-session');

    fireEvent.click(screen.getByLabelText('New terminal'));

    await waitFor(() => expect(screen.getAllByTestId('terminal-session')).toHaveLength(2));
    expect(getDesktopTerminalLaunchConfig).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole('button', { name: 'Shell' }));
    expect(screen.getAllByTestId('terminal-session')[0]?.dataset['active']).toBe('true');

    fireEvent.click(screen.getAllByRole('button', { name: 'Exit session' })[0]!);
    expect(screen.getByRole('button', { name: 'Shell (exited)' })).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Close Shell'));
    expect(screen.getAllByTestId('terminal-session')).toHaveLength(1);
    expect(screen.getByTestId('terminal-session').dataset['active']).toBe('true');
  });

  it('keeps terminal sessions mounted and restores the active tab per task', async () => {
    const view = render(
      <DesktopTerminalPanel open={true} onClose={mock()} scopeKey="task:first" />
    );
    await screen.findByTestId('terminal-session');

    view.rerender(<DesktopTerminalPanel open={true} onClose={mock()} scopeKey="task:second" />);
    await waitFor(() => expect(screen.getAllByTestId('terminal-session')).toHaveLength(2));
    expect(
      screen
        .getAllByTestId('terminal-session')
        .filter((session) => session.dataset['active'] === 'true')
    ).toHaveLength(1);

    view.rerender(<DesktopTerminalPanel open={true} onClose={mock()} scopeKey="task:first" />);
    await waitFor(() => expect(getDesktopTerminalLaunchConfig).toHaveBeenCalledTimes(3));
    expect(screen.getAllByTestId('terminal-session')).toHaveLength(2);
    expect(
      screen
        .getAllByTestId('terminal-session')
        .filter((session) => session.dataset['active'] === 'true')
    ).toHaveLength(1);
  });

  it('moves draft terminal sessions into a newly created task', async () => {
    const view = render(
      <DesktopTerminalPanel open={true} onClose={mock()} scopeKey="task:draft" />
    );
    await screen.findByTestId('terminal-session');

    view.rerender(<DesktopTerminalPanel open={false} onClose={mock()} scopeKey="task:created" />);
    view.rerender(<DesktopTerminalPanel open={true} onClose={mock()} scopeKey="task:created" />);

    await waitFor(() => expect(getDesktopTerminalLaunchConfig).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getAllByTestId('terminal-session')).toHaveLength(1));
    expect(screen.getByTestId('terminal-session').dataset['active']).toBe('true');
  });

  it('exposes WSL selection for new tabs when available', async () => {
    getDesktopTerminalLaunchConfig.mockResolvedValue({
      ...nativeConfig,
      wslAvailable: true,
      wslDistributions: ['Ubuntu', 'Debian'],
      wslDistribution: 'Ubuntu',
    });
    render(<DesktopTerminalPanel open={true} onClose={mock()} />);
    await screen.findByTestId('terminal-session');

    fireEvent.click(screen.getByLabelText('Terminal settings'));
    fireEvent.click(screen.getByLabelText('Use WSL for new terminals'));

    await waitFor(() =>
      expect(localStorage.getItem('taskforceai.desktop.terminal.v1')).toContain('preferWsl')
    );
    expect(screen.getByRole('option', { name: 'Debian' })).toBeTruthy();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Debian' } });
    await waitFor(() =>
      expect(localStorage.getItem('taskforceai.desktop.terminal.v1')).toContain('Debian')
    );
  });

  it('falls back from malformed preferences and reports launch failures', async () => {
    localStorage.setItem('taskforceai.desktop.terminal.v1', '{bad json');
    getDesktopTerminalLaunchConfig.mockRejectedValueOnce(new Error('terminal unavailable'));
    render(<DesktopTerminalPanel open={true} onClose={mock()} />);

    expect(await screen.findByText('terminal unavailable')).toBeTruthy();
    expect(screen.getByText('Open a new terminal tab.')).toBeTruthy();
  });

  it('closes from the close button', async () => {
    const onClose = mock();
    render(<DesktopTerminalPanel open={true} onClose={onClose} />);
    await screen.findByTestId('terminal-session');

    fireEvent.click(screen.getByLabelText('Close terminal'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
