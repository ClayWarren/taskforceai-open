import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';

import '../../../../tests/setup/dom';

const invokeTauri = mock();
const loggerError = mock();

mock.module('../platform/bridge', () => ({
  invokeTauri,
}));

mock.module('@taskforceai/web/app/lib/logger', () => ({
  logger: {
    error: loggerError,
  },
}));

import { DesktopTerminalPanel } from './DesktopTerminalPanel';

describe('DesktopTerminalPanel', () => {
  beforeEach(() => {
    invokeTauri.mockReset();
    loggerError.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders nothing while closed', () => {
    render(<DesktopTerminalPanel open={false} onClose={mock()} />);

    expect(screen.queryByLabelText('Desktop terminal')).toBeNull();
    expect(invokeTauri).not.toHaveBeenCalled();
  });

  it('runs a desktop terminal command and renders stdout, stderr, cwd, and exit code', async () => {
    invokeTauri.mockResolvedValueOnce({
      command: 'pwd',
      cwd: '/workspace',
      exitCode: 0,
      stdout: '/workspace\n',
      stderr: 'warning\n',
    });

    render(<DesktopTerminalPanel open={true} onClose={mock()} />);

    const user = userEvent.setup({ document: globalThis.document });
    await user.type(screen.getByPlaceholderText('Command'), ' pwd ');
    fireEvent.submit(screen.getByPlaceholderText('Command').closest('form')!);

    await waitFor(() =>
      expect(invokeTauri).toHaveBeenCalledWith('terminal_execute', { command: 'pwd' })
    );
    await waitFor(() => expect(screen.getAllByText(/\/workspace/).length).toBe(2));
    expect(screen.getByText('exit 0')).toBeTruthy();
    expect(screen.getByText(/warning/)).toBeTruthy();
  });

  it('records command failures and supports clearing output without invoking Tauri', async () => {
    invokeTauri.mockRejectedValueOnce(new Error('permission denied'));

    render(<DesktopTerminalPanel open={true} onClose={mock()} />);

    const user = userEvent.setup({ document: globalThis.document });
    await user.type(screen.getByPlaceholderText('Command'), 'rm -rf /');
    fireEvent.submit(screen.getByPlaceholderText('Command').closest('form')!);

    expect(await screen.findByText('permission denied')).toBeTruthy();
    expect(loggerError).toHaveBeenCalledWith('Desktop terminal command failed', {
      error: expect.any(Error),
      command: 'rm -rf /',
    });

    await user.type(screen.getByPlaceholderText('Command'), 'clear');
    fireEvent.submit(screen.getByPlaceholderText('Command').closest('form')!);

    await waitFor(() => expect(screen.queryByText('permission denied')).toBeNull());
    expect(screen.getByText('Type a command below. Use clear to reset the panel.')).toBeTruthy();
    expect(invokeTauri).toHaveBeenCalledTimes(1);
  });

  it('closes from the close button', () => {
    const onClose = mock();
    render(<DesktopTerminalPanel open={true} onClose={onClose} />);

    fireEvent.click(screen.getByLabelText('Close terminal'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
