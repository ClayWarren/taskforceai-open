import { fireEvent, render } from '@testing-library/react-native';
import React from 'react';

import { DesktopWorkScreen } from '../../screens/DesktopWorkScreen';

const mockMutate = jest.fn();
const mockStartThreadMutate = jest.fn();
const mockRespondMutate = jest.fn();
const mockUseDesktopWorkStateQuery = jest.fn();
const mockUseDesktopThreadQuery = jest.fn();
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
const mockUseRespondDesktopInteractionMutation = jest.fn(() => ({
  mutate: mockRespondMutate,
  isPending: false,
  error: null,
}));
const idleMutation = () => ({ mutate: jest.fn(), isPending: false, error: null });

jest.mock('../../hooks/api/desktopWork', () => ({
  useDesktopWorkStateQuery: (...args: unknown[]) => mockUseDesktopWorkStateQuery(...args),
  useSendDesktopTurnMutation: () => mockUseSendDesktopTurnMutation(),
  useStartDesktopThreadMutation: () => mockUseStartDesktopThreadMutation(),
  useRespondDesktopInteractionMutation: () => mockUseRespondDesktopInteractionMutation(),
  useDesktopThreadQuery: (...args: unknown[]) => mockUseDesktopThreadQuery(...args),
  useDesktopThreadActionMutation: idleMutation,
  useInterruptDesktopTurnMutation: idleMutation,
  useRenameDesktopThreadMutation: idleMutation,
  useDesktopReviewQuery: () => ({ data: null, isLoading: false, error: null }),
  useDesktopWorkspaceFilesQuery: () => ({ data: { files: [], truncated: false }, isLoading: false, error: null }),
  useDesktopWorkspaceFileQuery: () => ({ data: null, isLoading: false, error: null }),
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

jest.mock('../../components/remote/RemotePairingScreen', () => {
  const react = require('react');
  const { Text, TouchableOpacity, View } = require('react-native');
  return {
    RemotePairingScreen: ({ visible, onClose }: { visible: boolean; onClose: () => void }) =>
      visible
        ? react.createElement(
            View,
            { accessibilityLabel: 'Remote pairing' },
            react.createElement(Text, null, 'Scan QR code to pair'),
            react.createElement(
              TouchableOpacity,
              { accessibilityLabel: 'Close Remote pairing', onPress: onClose },
              react.createElement(Text, null, 'Close pairing')
            )
          )
        : null,
  };
});

describe('DesktopWorkScreen', () => {
  beforeEach(() => {
    mockMutate.mockReset();
    mockStartThreadMutate.mockReset();
    mockRespondMutate.mockReset();
    mockUseDesktopWorkStateQuery.mockReturnValue({
      data: connectedState,
      isLoading: false,
      isError: false,
      error: null,
    });
    mockUseDesktopThreadQuery.mockReturnValue({
      data: {
        ...connectedState.threads[0],
        id: connectedState.threads[0].sessionId,
        archived: false,
      },
      isLoading: false,
      isFetching: false,
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

  it('opens from live desktop workspace and thread list into active session detail', async () => {
    const onClose = jest.fn();
    const { getAllByText, getByLabelText, getByText, queryByText } = await render(
      <DesktopWorkScreen visible={true} onClose={onClose} />
    );

    expect(getByText('Desktop')).toBeTruthy();
    expect(getByText('This Mac')).toBeTruthy();
    expect(getByText('Connected desktop')).toBeTruthy();
    expect(getByText('Projects')).toBeTruthy();
    expect(getByText('taskforceai')).toBeTruthy();
    expect(getByText('PDAL')).toBeTruthy();
    expect(getByText('Review the local diff and run focused checks')).toBeTruthy();

    await fireEvent.press(getByLabelText('Open active session: Review the local diff and run focused checks'));

    expect(getAllByText('Review the local diff and run focused checks')).toHaveLength(2);
    expect(getByText('taskforceai · This Mac')).toBeTruthy();
    expect(getByText('Running')).toBeTruthy();
    expect(getByText('No activity has been recorded yet.')).toBeTruthy();
    expect(getByLabelText('Desktop follow up')).toBeTruthy();
    expect(queryByText('Connected desktop')).toBeNull();
  });

  it('sends follow-up text through the paired desktop turn mutation', async () => {
    const { getByLabelText } = await render(<DesktopWorkScreen visible={true} onClose={jest.fn()} />);
    await fireEvent.press(getByLabelText('Open active session: Review the local diff and run focused checks'));

    await fireEvent.changeText(getByLabelText('Desktop follow up'), 'Run the focused checks now');
    await fireEvent.press(getByLabelText('Send desktop follow up'));

    expect(mockMutate).toHaveBeenCalledWith(
      { threadId: 'thread-1', input: 'Run the focused checks now', behavior: 'steer' },
      expect.objectContaining({ onSuccess: expect.any(Function) })
    );
  });

  it('opens the shared Changes and Files sheets from the task menu', async () => {
    const { getByLabelText } = await render(
      <DesktopWorkScreen visible={true} onClose={jest.fn()} onOpenSettings={jest.fn()} />
    );
    await fireEvent.press(
      getByLabelText('Open active session: Review the local diff and run focused checks')
    );
    await fireEvent.press(getByLabelText('Open remote task menu'));
    await fireEvent.press(getByLabelText('Open remote changes'));
    expect(getByLabelText('Close remote changes')).toBeTruthy();

    await fireEvent.press(getByLabelText('Close remote changes'));
    await fireEvent.press(getByLabelText('Open remote task menu'));
    await fireEvent.press(getByLabelText('Open remote files'));
    expect(getByLabelText('Close remote files')).toBeTruthy();
  });

  it('opens Add connection as a dedicated pairing surface inside Remote', async () => {
    const onClose = jest.fn();
    const onOpenSettings = jest.fn();
    const { getByLabelText, getByText, queryByLabelText } = await render(
      <DesktopWorkScreen
        visible={true}
        onClose={onClose}
        onOpenSettings={onOpenSettings}
      />
    );

    await fireEvent.press(getByLabelText('Open Remote menu'));
    await fireEvent.press(getByText('Add connection'));

    expect(getByLabelText('Remote pairing')).toBeTruthy();
    expect(getByText('Scan QR code to pair')).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    expect(onOpenSettings).not.toHaveBeenCalled();

    await fireEvent.press(getByLabelText('Close Remote pairing'));
    expect(queryByLabelText('Remote pairing')).toBeNull();
  });

  it('approves an unresolved desktop interaction from the session', async () => {
    mockUseDesktopWorkStateQuery.mockReturnValue({
      data: {
        ...connectedState,
        interactions: [
          {
            id: 41,
            method: 'item/permissions/requestApproval',
            threadId: 'thread-1',
            params: { reason: 'Run focused checks' },
          },
        ],
      },
      isLoading: false,
      isError: false,
      error: null,
    });
    const { getByLabelText, getByText } = await render(
      <DesktopWorkScreen visible={true} onClose={jest.fn()} />
    );
    await fireEvent.press(
      getByLabelText('Open active session: Review the local diff and run focused checks')
    );
    expect(getByText('Run focused checks')).toBeTruthy();
    await fireEvent.press(getByLabelText('Approve desktop request 41'));
    expect(mockRespondMutate).toHaveBeenCalledWith({ requestId: 41, decision: 'accept' });
  });

  it('answers a Remote Needs input request without changing Chat or Work mode', async () => {
    mockUseDesktopWorkStateQuery.mockReturnValue({
      data: {
        ...connectedState,
        interactions: [
          {
            id: 42,
            method: 'item/tool/requestUserInput',
            threadId: 'thread-1',
            params: {
              questions: [
                {
                  id: 'scope',
                  question: 'Which validation scope?',
                  options: [{ label: 'Focused', description: 'Touched files only' }],
                },
              ],
            },
          },
        ],
      },
      isLoading: false,
      isError: false,
      error: null,
    });
    const { getAllByText, getByLabelText } = await render(
      <DesktopWorkScreen visible={true} onClose={jest.fn()} />
    );
    await fireEvent.press(
      getByLabelText('Open active session: Review the local diff and run focused checks')
    );
    expect(getAllByText('Needs input').length).toBeGreaterThan(0);
    await fireEvent.press(getByLabelText('Answer Which validation scope?: Focused'));
    await fireEvent.press(getByLabelText('Submit desktop request 42'));
    expect(mockRespondMutate).toHaveBeenCalledWith({
      requestId: 42,
      response: { answers: { scope: { answers: ['Focused'] } } },
    });
  });

  it('keeps Code-only changes and file controls out of Work threads', async () => {
    mockUseDesktopWorkStateQuery.mockReturnValue({
      data: {
        ...connectedState,
        threads: [{ ...connectedState.threads[0], taskMode: 'work' }],
      },
      isLoading: false,
      isError: false,
      error: null,
    });
    mockUseDesktopThreadQuery.mockReturnValue({
      data: { ...connectedState.threads[0], taskMode: 'work' },
      isLoading: false,
      isFetching: false,
      error: null,
    });
    const { getByLabelText, getByText, queryByLabelText } = await render(
      <DesktopWorkScreen visible={true} onClose={jest.fn()} />
    );
    await fireEvent.press(
      getByLabelText('Open active session: Review the local diff and run focused checks')
    );
    expect(getByText('No activity has been recorded yet.')).toBeTruthy();
    expect(queryByLabelText('Open remote desktop changes')).toBeNull();
    expect(queryByLabelText('Open remote task menu')).toBeNull();
  });

  it('starts a new desktop thread from the workspace compose button', async () => {
    const { getByLabelText, getByText } = await render(<DesktopWorkScreen visible={true} onClose={jest.fn()} />);

    await fireEvent.press(getByLabelText('Start new taskforceai thread'));
    expect(getByText('New desktop thread')).toBeTruthy();

    await fireEvent.changeText(getByLabelText('New desktop thread prompt'), 'Check the desktop and mobile sync demo');
    await fireEvent.press(getByLabelText('Start desktop thread'));

    expect(mockStartThreadMutate).toHaveBeenCalledWith(
      { input: 'Check the desktop and mobile sync demo' },
      expect.objectContaining({ onSuccess: expect.any(Function) })
    );
  });

  it('shows an honest unpaired state instead of static demo data', async () => {
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

    const { getByText, queryByText } = await render(<DesktopWorkScreen visible={true} onClose={jest.fn()} />);

    expect(getByText('Not connected')).toBeTruthy();
    expect(getByText('Pair this phone with the desktop app to view live work.')).toBeTruthy();
    expect(queryByText('PDAL')).toBeNull();
  });

  it('returns to chat from the workspace list', async () => {
    const onClose = jest.fn();
    const { getByLabelText } = await render(<DesktopWorkScreen visible={true} onClose={onClose} />);

    await fireEvent.press(getByLabelText('Back to chat'));

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
      id: 'thread-1',
      sessionId: 'thread-1',
      title: 'Review the local diff and run focused checks',
      objective: 'Review the local diff and run focused checks',
      state: 'running',
      archived: false,
      turns: [
        {
          id: 'turn-1',
          threadId: 'thread-1',
          runId: 'run-local-1',
          status: 'inProgress',
          items: [],
          createdAt: 1,
          updatedAt: 2,
        },
      ],
      source: 'desktop',
      taskMode: 'code',
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
