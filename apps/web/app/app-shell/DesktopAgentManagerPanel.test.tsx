import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';

import '../../../../tests/setup/dom';

const createDesktopAppServerAgentSession = mock();
const inspectDesktopAppServerDiagnostics = mock();
const listDesktopAppServerAgentSessions = mock();
const listDesktopAppServerChannels = mock();
const listDesktopAppServerSchedules = mock();
const pauseDesktopAppServerAgentSession = mock();
const resumeDesktopAppServerAgentSession = mock();
const cancelDesktopAppServerAgentSession = mock();
const forkDesktopAppServerAgentSession = mock();
const runDesktopAppServerAgentSession = mock();
const tickDesktopAppServerSchedules = mock();
const loggerWarn = mock();

mock.module('../lib/logger', () => ({
  logger: {
    warn: loggerWarn,
  },
}));

mock.module('../lib/platform/desktop/app-server', () => ({
  createDesktopAppServerAgentSession,
  inspectDesktopAppServerDiagnostics,
  listDesktopAppServerAgentSessions,
  listDesktopAppServerChannels,
  listDesktopAppServerSchedules,
  pauseDesktopAppServerAgentSession,
  resumeDesktopAppServerAgentSession,
  cancelDesktopAppServerAgentSession,
  forkDesktopAppServerAgentSession,
  runDesktopAppServerAgentSession,
  tickDesktopAppServerSchedules,
}));

import { DesktopAgentManagerPanel } from './DesktopAgentManagerPanel';

const session = {
  sessionId: 'session-1',
  title: 'Investigate flaky tests',
  objective: 'Track down the flaky desktop smoke test',
  state: 'idle',
  runIds: ['run-1'],
  activeRunId: null,
  lastMessage: 'Waiting for the next run',
  lastError: null,
};

const resetAppServerMocks = () => {
  listDesktopAppServerAgentSessions.mockResolvedValue({ sessions: [session] });
  listDesktopAppServerChannels.mockResolvedValue({
    channels: [{ id: 'channel-1', name: 'Engineering', kind: 'slack' }],
  });
  listDesktopAppServerSchedules.mockResolvedValue({
    schedules: [{ id: 'schedule-1', name: 'Nightly audit', cadence: 'daily' }],
  });
  inspectDesktopAppServerDiagnostics.mockResolvedValue({
    sections: [
      {
        title: 'Health',
        items: [{ label: 'Queue', value: 'ready' }],
      },
    ],
  });
  createDesktopAppServerAgentSession.mockResolvedValue({ session });
  pauseDesktopAppServerAgentSession.mockResolvedValue({ session });
  resumeDesktopAppServerAgentSession.mockResolvedValue({ session });
  cancelDesktopAppServerAgentSession.mockResolvedValue({ session });
  forkDesktopAppServerAgentSession.mockResolvedValue({ session });
  runDesktopAppServerAgentSession.mockResolvedValue({ runId: 'run-2' });
  tickDesktopAppServerSchedules.mockResolvedValue({ ticked: 1 });
};

describe('DesktopAgentManagerPanel', () => {
  beforeEach(() => {
    for (const fn of [
      createDesktopAppServerAgentSession,
      inspectDesktopAppServerDiagnostics,
      listDesktopAppServerAgentSessions,
      listDesktopAppServerChannels,
      listDesktopAppServerSchedules,
      pauseDesktopAppServerAgentSession,
      resumeDesktopAppServerAgentSession,
      cancelDesktopAppServerAgentSession,
      forkDesktopAppServerAgentSession,
      runDesktopAppServerAgentSession,
      tickDesktopAppServerSchedules,
    ]) {
      fn.mockReset();
    }
    loggerWarn.mockReset();
    resetAppServerMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('does not load app-server state while closed', () => {
    render(<DesktopAgentManagerPanel open={false} onClose={mock()} />);

    expect(screen.queryByLabelText('Agent manager')).toBeNull();
    expect(listDesktopAppServerAgentSessions).not.toHaveBeenCalled();
  });

  it('loads sessions, channels, schedules, diagnostics, and closes', async () => {
    const onClose = mock();
    render(<DesktopAgentManagerPanel open={true} onClose={onClose} />);

    expect(await screen.findByText('Investigate flaky tests')).toBeTruthy();
    expect(screen.getByText('Track down the flaky desktop smoke test')).toBeTruthy();
    expect(screen.getByText('Engineering · slack')).toBeTruthy();
    expect(screen.getByText('Nightly audit · daily')).toBeTruthy();
    expect(screen.getByText('Health: Queue ready')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('creates a background session and refreshes the panel', async () => {
    render(<DesktopAgentManagerPanel open={true} onClose={mock()} />);

    await screen.findByText('Investigate flaky tests');
    const user = userEvent.setup({ document: globalThis.document });
    await user.type(screen.getByLabelText('New background session'), 'Run coverage audit');
    fireEvent.click(screen.getByRole('button', { name: 'Start session' }));

    await waitFor(() =>
      expect(createDesktopAppServerAgentSession).toHaveBeenCalledWith({
        objective: 'Run coverage audit',
        source: 'desktop',
      })
    );
    await waitFor(() => expect(listDesktopAppServerAgentSessions).toHaveBeenCalledTimes(2));
    expect(screen.getByLabelText('New background session')).toHaveValue('');
  });

  it('runs sessions and schedules through app-server actions before refreshing', async () => {
    render(<DesktopAgentManagerPanel open={true} onClose={mock()} />);

    await screen.findByText('Investigate flaky tests');

    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    await waitFor(() =>
      expect(runDesktopAppServerAgentSession).toHaveBeenCalledWith({ sessionId: 'session-1' })
    );

    fireEvent.click(screen.getByRole('button', { name: 'Run due schedules' }));
    await waitFor(() => expect(tickDesktopAppServerSchedules).toHaveBeenCalledTimes(1));
    expect(listDesktopAppServerAgentSessions).toHaveBeenCalledTimes(3);
  });

  it('surfaces refresh failures as panel messages', async () => {
    const error = new Error('app-server unavailable');
    listDesktopAppServerAgentSessions.mockRejectedValueOnce(error);

    render(<DesktopAgentManagerPanel open={true} onClose={mock()} />);

    expect(await screen.findByText('app-server unavailable')).toBeTruthy();
    expect(loggerWarn).toHaveBeenCalledWith('Failed to refresh desktop agent manager state', {
      error,
    });
  });
});
