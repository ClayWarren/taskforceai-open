import { fireEvent, render } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import React from 'react';

import type { DesktopThread } from '../../features/desktop-work/data/desktop-work';
import {
  filterRemoteThreads,
  makeRemoteSections,
} from '../../features/desktop-work/desktop-work-sections';
import { DesktopWorkScreen } from '../../features/desktop-work/DesktopWorkScreen';

const mockMutate = jest.fn();
const mockStartThreadMutate = jest.fn();
const mockRespondMutate = jest.fn();
const mockThreadActionMutate = jest.fn();
const mockRenameThreadMutate = jest.fn();
const mockUseDesktopWorkStateQuery = jest.fn();
const mockUseDesktopThreadQuery = jest.fn();
let mockThreadActionPending = false;
let mockRenameThreadPending = false;
let mockSafeAreaInsets = { top: 0, bottom: 0, left: 0, right: 0 };
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

jest.mock('../../features/desktop-work/data/desktop-work', () => ({
  useDesktopWorkStateQuery: (...args: unknown[]) => mockUseDesktopWorkStateQuery(...args),
  useSendDesktopTurnMutation: () => mockUseSendDesktopTurnMutation(),
  useStartDesktopThreadMutation: () => mockUseStartDesktopThreadMutation(),
  useRespondDesktopInteractionMutation: () => mockUseRespondDesktopInteractionMutation(),
  useDesktopThreadQuery: (...args: unknown[]) => mockUseDesktopThreadQuery(...args),
  useDesktopThreadActionMutation: () => ({
    mutate: mockThreadActionMutate,
    isPending: mockThreadActionPending,
    error: null,
  }),
  useInterruptDesktopTurnMutation: idleMutation,
  useRenameDesktopThreadMutation: () => ({
    mutate: mockRenameThreadMutate,
    isPending: mockRenameThreadPending,
    error: null,
  }),
  useDesktopReviewQuery: () => ({ data: null, isLoading: false, error: null }),
  useDesktopGitStatusQuery: () => ({
    data: { isGitRepository: true, workspace: '/repo/taskforceai', branch: 'main' },
    isLoading: false,
    error: null,
  }),
  useDesktopGitBranchesQuery: () => ({ data: { branches: [] }, isLoading: false, error: null }),
  useDesktopGitWorktreesQuery: () => ({ data: { worktrees: [] }, isLoading: false, error: null }),
  useDesktopHostsQuery: () => ({ data: [], isLoading: false, error: null }),
  useDesktopSkillsQuery: () => ({ data: { skills: [] }, isLoading: false, error: null }),
  useSelectDesktopHostMutation: idleMutation,
  useAttachDesktopWorkspaceMutation: idleMutation,
  useCreateDesktopWorktreeMutation: idleMutation,
  useCreateDesktopProjectMutation: idleMutation,
  useCloneDesktopProjectMutation: idleMutation,
  useDesktopReviewActionMutation: idleMutation,
  useDesktopWorkspaceFilesQuery: () => ({ data: { files: [], truncated: false }, isLoading: false, error: null }),
  useDesktopWorkspaceFileQuery: () => ({ data: null, isLoading: false, error: null }),
  useDesktopGitHubRepositoriesQuery: () => ({ data: { repositories: [] }, isLoading: false, error: null }),
}));

jest.mock('../../hooks/api/modelSelector', () => ({
  useModelSelectorQuery: () => ({ data: { options: [], defaultModelId: null }, isLoading: false }),
}));

jest.mock('../../hooks/usePromptAttachments', () => ({
  usePromptAttachments: () => ({
    attachments: [],
    takePhoto: jest.fn(),
    pickImages: jest.fn(),
    pickDocuments: jest.fn(),
    removeAttachment: jest.fn(),
    clearAttachments: jest.fn(),
    uploadAttachment: jest.fn(),
  }),
}));

jest.mock('../../hooks/usePromptVoice', () => ({
  usePromptVoice: () => ({
    isListening: false,
    startListening: jest.fn(),
    cancelListening: jest.fn(),
    acceptListening: jest.fn(),
  }),
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

jest.mock('../../contexts/PreferencesContext', () => ({
  usePreferences: () => ({ remoteCodeScale: 1, remoteWordWrap: true }),
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
  useSafeAreaInsets: () => mockSafeAreaInsets,
}));

jest.mock('../../components/Icon', () => {
  const react = require('react');
  const { Text } = require('react-native');
  return {
    Icon: ({ name }: { name: string }) => react.createElement(Text, null, `icon-${name}`),
  };
});

jest.mock('../../components/MarkdownView', () => ({
  MarkdownView: ({ content }: { content: string }) => {
    const react = require('react');
    const { Text } = require('react-native');
    return react.createElement(Text, null, content);
  },
}));

jest.mock('../../features/desktop-work/components/RemotePairingScreen', () => {
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

jest.mock('../../screens/SettingsScreen', () => {
  const react = require('react');
  const { Text, TouchableOpacity, View } = require('react-native');
  return {
    SettingsScreen: ({ visible, onClose, initialSection }: any) =>
      visible
        ? react.createElement(
            View,
            { accessibilityLabel: 'Remote settings screen' },
            react.createElement(Text, null, `Remote settings:${initialSection}`),
            react.createElement(
              TouchableOpacity,
              { accessibilityLabel: 'Close Remote settings', onPress: onClose },
              react.createElement(Text, null, 'Close settings')
            )
          )
        : null,
  };
});

jest.mock('../../screens/CloudTasksScreen', () => {
  const react = require('react');
  const { Text, TouchableOpacity, View } = require('react-native');
  return {
    CloudTasksScreen: ({ visible, onClose }: any) =>
      visible
        ? react.createElement(
            View,
            { accessibilityLabel: 'Cloud tasks screen' },
            react.createElement(Text, null, 'Cloud tasks screen content'),
            react.createElement(
              TouchableOpacity,
              { accessibilityLabel: 'Close Cloud tasks', onPress: onClose },
              react.createElement(Text, null, 'Close cloud tasks')
            )
          )
        : null,
  };
});

describe('DesktopWorkScreen', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    mockSafeAreaInsets = { top: 0, bottom: 0, left: 0, right: 0 };
    mockThreadActionPending = false;
    mockRenameThreadPending = false;
    mockMutate.mockReset();
    mockStartThreadMutate.mockReset();
    mockRespondMutate.mockReset();
    mockThreadActionMutate.mockReset();
    mockRenameThreadMutate.mockReset();
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

  it('applies the device top inset exactly once through the Remote header', async () => {
    mockSafeAreaInsets = { top: 47, bottom: 34, left: 0, right: 0 };
    const view = await render(<DesktopWorkScreen visible onClose={jest.fn()} />);
    const header = view.getByText('Desktop').parent?.parent;

    expect(header?.props.style).toContainEqual({ paddingTop: 47 });
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

  it('previews a Remote thread on long press and exposes supported persistent actions', async () => {
    const { getByLabelText, getByText, getAllByText } = await render(
      <DesktopWorkScreen visible={true} onClose={jest.fn()} />
    );

    await fireEvent(
      getByLabelText('Open active session: Review the local diff and run focused checks'),
      'longPress'
    );

    expect(getByText('Mobile is reviewing live desktop state.')).toBeTruthy();
    expect(getByText('Rename')).toBeTruthy();
    expect(getAllByText('Archive').length).toBeGreaterThan(0);

    await fireEvent.press(getByText('Rename'));
    await fireEvent.changeText(getByLabelText('Rename remote thread'), 'Focused review');
    await fireEvent.press(getByLabelText('Save remote thread name'));
    expect(mockRenameThreadMutate).toHaveBeenCalledWith(
      { threadId: 'thread-1', title: 'Focused review' },
      expect.objectContaining({ onSuccess: expect.any(Function) })
    );
  });

  it('unarchives an archived Remote thread from its context menu', async () => {
    mockUseDesktopWorkStateQuery.mockReturnValue({
      data: {
        ...connectedState,
        threads: [{ ...connectedState.threads[0], archived: true }],
      },
      isLoading: false,
      isError: false,
      error: null,
    });
    const { getByLabelText, getAllByText } = await render(
      <DesktopWorkScreen visible={true} onClose={jest.fn()} />
    );

    await fireEvent(
      getByLabelText('Open active session: Review the local diff and run focused checks'),
      'longPress'
    );
    await fireEvent.press(getAllByText('Unarchive').at(-1)!);

    expect(mockThreadActionMutate).toHaveBeenCalledWith(
      { threadId: 'thread-1', action: 'unarchive' },
      expect.objectContaining({ onSuccess: expect.any(Function) })
    );
  });

  it('renders pending rename and archive actions without accepting duplicate presses', async () => {
    mockThreadActionPending = true;
    mockRenameThreadPending = true;
    const { getByLabelText, getByText } = await render(
      <DesktopWorkScreen visible={true} onClose={jest.fn()} />
    );

    await fireEvent(
      getByLabelText('Open active session: Review the local diff and run focused checks'),
      'longPress'
    );
    await fireEvent.press(getByText('Rename'));

    expect(getByLabelText('Save remote thread name').props.disabled).toBe(true);
    expect(getByLabelText('Archive').props.disabled).toBe(true);
  });

  it('sends follow-up text through the paired desktop turn mutation', async () => {
    const { getByLabelText } = await render(<DesktopWorkScreen visible={true} onClose={jest.fn()} />);
    await fireEvent.press(getByLabelText('Open active session: Review the local diff and run focused checks'));

    await fireEvent.changeText(getByLabelText('Desktop follow up'), 'Run the focused checks now');
    await fireEvent.press(getByLabelText('Send desktop follow up'));

    expect(mockMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: 'thread-1',
        input: 'Run the focused checks now',
        behavior: 'steer',
      }),
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

  it('opens Remote Settings and Cloud tasks above Remote without dismissing it', async () => {
    const onClose = jest.fn();
    const { getByLabelText, getByText, queryByLabelText } = await render(
      <DesktopWorkScreen visible={true} onClose={onClose} />
    );

    await fireEvent.press(getByLabelText('Open Remote menu'));
    await fireEvent.press(getByText('Settings'));
    expect(getByLabelText('Remote settings screen')).toBeTruthy();
    expect(getByText('Remote settings:apps')).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    await fireEvent.press(getByLabelText('Close Remote settings'));
    expect(queryByLabelText('Remote settings screen')).toBeNull();

    await fireEvent.press(getByLabelText('Open Remote menu'));
    await fireEvent.press(getByText('Cloud tasks'));
    expect(getByLabelText('Cloud tasks screen')).toBeTruthy();
    expect(getByText('Cloud tasks screen content')).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('builds project-first, chat-first, and chronological Remote layouts', () => {
    const now = new Date(2026, 6, 13, 12).getTime();
    const codeThread = {
      ...connectedState.threads[0],
      updatedAt: now,
    } as DesktopThread;
    const chatThread = {
      ...codeThread,
      id: 'chat-1',
      sessionId: 'chat-1',
      title: 'Clean dev caches',
      taskMode: 'chat',
      updatedAt: now - 86_400_000,
    } as DesktopThread;
    const threads = [chatThread, codeThread];

    expect(
      makeRemoteSections([...connectedState.projects], threads, 1, 'project', now).map(
        (section) => section.title
      )
    ).toEqual(['Projects', 'Chats']);
    expect(
      makeRemoteSections([...connectedState.projects], threads, 1, 'chatsFirst', now).map(
        (section) => section.title
      )
    ).toEqual(['Chats', 'Projects']);
    expect(
      makeRemoteSections([...connectedState.projects], threads, 1, 'chronological', now).map(
        (section) => section.title
      )
    ).toEqual(['Today', 'Yesterday']);

    const olderThread = { ...codeThread, id: 'older', updatedAt: now - 3 * 86_400_000 };
    const invalidThread = { ...codeThread, id: 'invalid', updatedAt: Number.NaN };
    expect(
      makeRemoteSections([], [olderThread, invalidThread], null, 'chronological', now).map(
        (section) => section.title
      )
    ).toEqual(expect.arrayContaining(['3 days ago', 'Earlier']));

    const needsApproval = {
      ...codeThread,
      id: 'approval',
      turns: [
        {
          id: 'turn-1',
          status: 'inProgress',
          items: [{ id: 'item-1', type: 'approval', status: 'inProgress' }],
        },
      ],
    } as DesktopThread;
    expect(filterRemoteThreads([needsApproval], [], '', 'needsInput')).toEqual([needsApproval]);
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
    const { getByLabelText, getByText, queryByText } = await render(<DesktopWorkScreen visible={true} onClose={jest.fn()} />);

    await fireEvent.press(getByLabelText('Start new taskforceai thread'));
    expect(queryByText('New desktop thread')).toBeNull();
    expect(getByText('This Mac')).toBeTruthy();
    expect(getByText('taskforceai')).toBeTruthy();
    expect(getByText('Work locally')).toBeTruthy();
    expect(getByText('main')).toBeTruthy();

    await fireEvent.changeText(getByLabelText('New desktop thread prompt'), 'Check the desktop and mobile sync demo');
    await fireEvent.press(getByLabelText('Start desktop thread'));

    expect(mockStartThreadMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        input: 'Check the desktop and mobile sync demo',
        taskMode: 'code',
        projectId: 1,
        modelId: null,
        reasoningEffort: null,
        attachmentIds: [],
        planMode: false,
        permissionProfile: 'full_access',
        hostId: null,
        clientMessageId: expect.any(String),
      }),
      expect.objectContaining({ onSuccess: expect.any(Function) })
    );
  });

  it('shows a Chats compose action and opens the compact Chats composer', async () => {
    const { getByLabelText, getByText, queryByText } = await render(
      <DesktopWorkScreen visible={true} onClose={jest.fn()} />
    );

    await fireEvent.press(getByLabelText('Start new Chats thread'));

    expect(getByText('Chats')).toBeTruthy();
    expect(queryByText('Work locally')).toBeNull();
    expect(queryByText('main')).toBeNull();
    await fireEvent.changeText(
      getByLabelText('New desktop thread prompt'),
      'Summarize what happened today'
    );
    await fireEvent.press(getByLabelText('Start desktop thread'));

    expect(mockStartThreadMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        input: 'Summarize what happened today',
        taskMode: 'chat',
        projectId: null,
        modelId: null,
        reasoningEffort: null,
        attachmentIds: [],
        planMode: false,
        permissionProfile: 'full_access',
        hostId: null,
        clientMessageId: expect.any(String),
      }),
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
    { id: 1, name: 'taskforceai', description: null, workspaceRoots: ['/repo/taskforceai'] },
    { id: 2, name: 'PDAL', description: null, workspaceRoots: ['/repo/pdal'] },
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
      entityId: 'apps/mobile/src/features/desktop-work/DesktopWorkScreen.tsx',
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
