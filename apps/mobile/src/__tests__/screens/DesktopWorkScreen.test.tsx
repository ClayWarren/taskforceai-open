import { fireEvent, render } from '@testing-library/react-native';
import React from 'react';

import { DesktopWorkScreen } from '../../screens/DesktopWorkScreen';

const mockMutate = jest.fn();
const mockStartThreadMutate = jest.fn();
const mockUseDesktopWorkStateQuery = jest.fn();
const mockUseSendDesktopTurnMutation = jest.fn(() => ({
  mutate: mockMutate,
  isPending: false,
  error: null,
}));
const mockUseStartDesktopThreadMutation = jest.fn(() => ({
  mutate: mockStartThreadMutate,
  isPending: false,
  error: null,
}));

jest.mock('../../hooks/api/desktopWork', () => ({
  useDesktopWorkStateQuery: (...args: unknown[]) => mockUseDesktopWorkStateQuery(...args),
  useSendDesktopTurnMutation: () => mockUseSendDesktopTurnMutation(),
  useStartDesktopThreadMutation: () => mockUseStartDesktopThreadMutation(),
}));

jest.mock('../../contexts/ThemeContext', () => ({
  useTheme: () => ({
    theme: {
      colors: {
        background: '#0f172a',
        border: '#334155',
        cardBackground: '#111827',
        text: '#f8fafc',
        textMuted: '#94a3b8',
      },
    },
  }),
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('../../components/Icon', () => {
  const react = require('react');
  const { Text } = require('react-native');
  return {
    Icon: ({ name }: { name: string }) => react.createElement(Text, null, `icon-${name}`),
  };
});

describe('DesktopWorkScreen', () => {
  beforeEach(() => {
    mockMutate.mockReset();
    mockStartThreadMutate.mockReset();
    mockUseDesktopWorkStateQuery.mockReturnValue({
      data: connectedState,
      isLoading: false,
      isError: false,
      error: null,
    });
    mockUseSendDesktopTurnMutation.mockReturnValue({
      mutate: mockMutate,
      isPending: false,
      error: null,
    });
    mockUseStartDesktopThreadMutation.mockReturnValue({
      mutate: mockStartThreadMutate,
      isPending: false,
      error: null,
    });
  });

  it('opens from live desktop workspace and thread list into active session detail', () => {
    const onClose = jest.fn();
    const { getByLabelText, getByText, queryByText } = render(
      <DesktopWorkScreen visible={true} onClose={onClose} />
    );

    expect(getByText('Desktop')).toBeTruthy();
    expect(getByText('This Mac')).toBeTruthy();
    expect(getByText('Connected desktop')).toBeTruthy();
    expect(getByText('Projects')).toBeTruthy();
    expect(getByText('taskforceai')).toBeTruthy();
    expect(getByText('PDAL')).toBeTruthy();
    expect(getByText('Review the local diff and run focused checks')).toBeTruthy();

    fireEvent.press(getByLabelText('Open active session: Review the local diff and run focused checks'));

    expect(getByText('Review the local diff and run focused checks')).toBeTruthy();
    expect(getByText('taskforceai · This Mac')).toBeTruthy();
    expect(getByText('Mobile is reviewing live desktop state.')).toBeTruthy();
    expect(getByText('Working space')).toBeTruthy();
    expect(getByText('update file apps/mobile/src/screens/DesktopWorkScreen.tsx')).toBeTruthy();
    expect(getByText('Active run run-local-1')).toBeTruthy();
    expect(getByText('1 pending change')).toBeTruthy();
    expect(getByLabelText('Desktop follow up')).toBeTruthy();
    expect(queryByText('Connected desktop')).toBeNull();
  });

  it('sends follow-up text through the paired desktop turn mutation', () => {
    const { getByLabelText } = render(<DesktopWorkScreen visible={true} onClose={jest.fn()} />);
    fireEvent.press(getByLabelText('Open active session: Review the local diff and run focused checks'));

    fireEvent.changeText(getByLabelText('Desktop follow up'), 'Run the focused checks now');
    fireEvent.press(getByLabelText('Send desktop follow up'));

    expect(mockMutate).toHaveBeenCalledWith(
      { threadId: 'thread-1', input: 'Run the focused checks now' },
      expect.objectContaining({ onSuccess: expect.any(Function) })
    );
  });

  it('starts a new desktop thread from the workspace compose button', () => {
    const { getByLabelText, getByText } = render(<DesktopWorkScreen visible={true} onClose={jest.fn()} />);

    fireEvent.press(getByLabelText('Start new taskforceai thread'));
    expect(getByText('New desktop thread')).toBeTruthy();

    fireEvent.changeText(getByLabelText('New desktop thread prompt'), 'Check the desktop and mobile sync demo');
    fireEvent.press(getByLabelText('Start desktop thread'));

    expect(mockStartThreadMutate).toHaveBeenCalledWith(
      { input: 'Check the desktop and mobile sync demo' },
      expect.objectContaining({ onSuccess: expect.any(Function) })
    );
  });

  it('shows an honest unpaired state instead of static demo data', () => {
    mockUseDesktopWorkStateQuery.mockReturnValue({
      data: {
        status: 'unpaired',
        projects: [],
        threads: [],
        pendingChanges: [],
        activeProjectId: null,
        machineName: null,
        message: 'Pair this phone with the desktop app to view live work.',
      },
      isLoading: false,
      isError: false,
      error: null,
    });

    const { getByText, queryByText } = render(<DesktopWorkScreen visible={true} onClose={jest.fn()} />);

    expect(getByText('Not connected')).toBeTruthy();
    expect(getByText('Pair this phone with the desktop app to view live work.')).toBeTruthy();
    expect(queryByText('PDAL')).toBeNull();
  });

  it('returns to chat from the workspace list', () => {
    const onClose = jest.fn();
    const { getByLabelText } = render(<DesktopWorkScreen visible={true} onClose={onClose} />);

    fireEvent.press(getByLabelText('Back to chat'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

const connectedState = {
  status: 'connected',
  activeProjectId: 1,
  machineName: 'This Mac',
  projects: [
    { id: 1, name: 'taskforceai', description: null },
    { id: 2, name: 'PDAL', description: null },
  ],
  threads: [
    {
      sessionId: 'thread-1',
      title: 'Review the local diff and run focused checks',
      objective: 'Review the local diff and run focused checks',
      state: 'running',
      source: 'desktop',
      lastMessage: 'Mobile is reviewing live desktop state.',
      runIds: ['run-local-1'],
      activeRunId: 'run-local-1',
      lastError: null,
      createdAt: 1,
      updatedAt: 2,
    },
  ],
  pendingChanges: [
    {
      id: 7,
      type: 'file',
      entityId: 'apps/mobile/src/screens/DesktopWorkScreen.tsx',
      operation: 'update',
      data: {},
      createdAt: 3,
    },
  ],
  connection: {
    baseUrl: 'http://127.0.0.1:7319',
    rpcPath: '/rpc',
    transport: { kind: 'http', encoding: 'json' },
  },
} as const;
