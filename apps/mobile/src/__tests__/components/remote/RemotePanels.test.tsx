import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockRespondMutate = jest.fn();
const mockActionMutate = jest.fn();
const mockInterruptMutate = jest.fn();
const mockRenameMutate = jest.fn();
let mockReviewState: Record<string, unknown>;
let mockFilesState: Record<string, unknown>;
let mockFileState: Record<string, unknown>;
let mockThreadState: Record<string, unknown>;

jest.mock('../../../contexts/ThemeContext', () => ({
  useTheme: () => ({
    theme: {
      colors: {
        cardBackground: '#111827',
        border: '#374151',
        text: '#ffffff',
        textMuted: '#9ca3af',
      },
    },
  }),
}));

jest.mock('../../../components/Icon', () => ({
  Icon: () => null,
}));

jest.mock('../../../hooks/api/desktopWork', () => ({
  threadItemText: (item: { content?: unknown }) => {
    if (typeof item.content === 'string') return item.content;
    if (typeof item.content !== 'object' || !item.content || !('text' in item.content)) return '';
    return typeof item.content.text === 'string' ? item.content.text : '';
  },
  threadItemImageUri: (item: { content?: unknown }) =>
    typeof item.content === 'object' && item.content && 'imageUri' in item.content
      ? String(item.content.imageUri)
      : null,
  useRespondDesktopInteractionMutation: () => ({ mutate: mockRespondMutate, isPending: false }),
  useDesktopThreadActionMutation: () => ({ mutate: mockActionMutate }),
  useInterruptDesktopTurnMutation: () => ({ mutate: mockInterruptMutate }),
  useRenameDesktopThreadMutation: () => ({ mutate: mockRenameMutate }),
  useDesktopReviewQuery: () => mockReviewState,
  useDesktopWorkspaceFilesQuery: () => mockFilesState,
  useDesktopWorkspaceFileQuery: () => mockFileState,
  useDesktopThreadQuery: () => mockThreadState,
  useSendDesktopTurnMutation: () => ({ mutate: jest.fn(), isPending: false }),
}));

import { RemoteActionIcon, RemoteActionPill, RemoteErrorText, RemoteStatusText } from '../../../components/remote/RemoteControls';
import { RemoteFilesPanel } from '../../../components/remote/RemoteFilesPanel';
import { RemoteInteractionCards } from '../../../components/remote/RemoteInteractionCards';
import {
  RemoteChangeSummaryPill,
  RemoteReviewPanel,
  summarizeDesktopReview,
} from '../../../components/remote/RemoteReviewPanel';
import { RemoteThreadActions } from '../../../components/remote/RemoteThreadActions';
import { RemoteThreadActivity } from '../../../components/remote/RemoteThreadActivity';
import { RemoteThreadDetail } from '../../../components/remote/RemoteThreadDetail';

const baseThread = {
  id: 'thread-1',
  sessionId: 'thread-1',
  title: 'Remote task',
  objective: 'Inspect the workspace',
  state: 'active',
  archived: false,
  source: 'mobile',
  taskMode: 'code' as const,
  turns: [],
  activeRunId: null,
  lastError: null,
  createdAt: 1,
  updatedAt: 2,
};

let currentRender: Awaited<ReturnType<typeof render>>;
const renderRemote = async (element: React.ReactElement) => {
  currentRender = await render(element);
  return currentRender;
};
const screen = {
  getByLabelText: (...args: Parameters<typeof currentRender.getByLabelText>) =>
    currentRender.getByLabelText(...args),
  getAllByLabelText: (...args: Parameters<typeof currentRender.getAllByLabelText>) =>
    currentRender.getAllByLabelText(...args),
  getByText: (...args: Parameters<typeof currentRender.getByText>) =>
    currentRender.getByText(...args),
  getAllByText: (...args: Parameters<typeof currentRender.getAllByText>) =>
    currentRender.getAllByText(...args),
};

describe('Remote panels', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRenameMutate.mockImplementation((_input, options: { onSuccess?: () => void }) =>
      options?.onSuccess?.()
    );
    mockReviewState = { isLoading: false, error: null, data: null };
    mockFilesState = { isLoading: false, error: null, data: { files: [], truncated: false } };
    mockFileState = { isLoading: false, error: null, data: null };
    mockThreadState = { isLoading: false, isFetching: false, data: null };
  });

  it('renders and invokes remote control primitives', async () => {
    const onPress = jest.fn();
    await renderRemote(
      <>
        <RemoteActionPill label="Danger" icon="Trash2" selected danger onPress={onPress} />
        <RemoteActionIcon label="Disabled" icon="X" disabled onPress={onPress} />
        <RemoteStatusText text="Ready" />
        <RemoteErrorText error={new Error('Remote failed')} />
      </>
    );
    await fireEvent.press(screen.getByLabelText('Danger'));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Ready')).toBeTruthy();
    expect(screen.getByText('Remote failed')).toBeTruthy();
  });

  it('handles approvals and user-input interactions', async () => {
    const { rerender } = await renderRemote(
      <RemoteInteractionCards
        interactions={[
          { id: 1, method: 'item/commandExecution/requestApproval', threadId: null, params: {} },
          { id: 2, method: 'item/other/requestApproval', threadId: null, params: {} },
        ]}
      />
    );
    expect(screen.getByText('Allow the requested action on the paired desktop.')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Approve desktop request 1'));
    await fireEvent.press(screen.getByLabelText('Decline desktop request 1'));
    expect(mockRespondMutate).toHaveBeenCalledWith({ requestId: 1, decision: 'accept' });

    await rerender(
      <RemoteInteractionCards
        interactions={[{
          id: 'input-1',
          method: 'item/tool/requestUserInput',
          threadId: 'thread-1',
          params: {
            questions: [
              { id: 'choice', question: 'Choose one', options: [{ label: 'Alpha' }] },
              { question: 'Explain' },
            ],
          },
        }]}
      />
    );
    await fireEvent.press(screen.getByLabelText('Answer Choose one: Alpha'));
    await fireEvent.changeText(screen.getByLabelText('Answer Explain'), 'Because');
    await fireEvent.press(screen.getByLabelText('Submit desktop request input-1'));
    expect(mockRespondMutate).toHaveBeenLastCalledWith(
      expect.objectContaining({ requestId: 'input-1', response: { answers: expect.any(Object) } })
    );
  });

  it('runs thread lifecycle, rename, fork, stop, cancel, and delete actions', async () => {
    const onDeleted = jest.fn();
    const onForked = jest.fn();
    mockActionMutate.mockImplementation((_input, options: { onSuccess?: (value: unknown) => void }) =>
      options?.onSuccess?.({ thread: { ...baseThread, id: 'fork-1' } })
    );
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      buttons?.[1]?.onPress?.();
    });
    const { rerender } = await renderRemote(
      <RemoteThreadActions thread={baseThread} running onDeleted={onDeleted} onForked={onForked} />
    );
    await fireEvent.press(screen.getByLabelText('Stop turn'));
    await fireEvent.press(screen.getByLabelText('Rename'));
    await fireEvent.changeText(screen.getByLabelText('Remote thread title'), 'Renamed');
    await fireEvent.press(screen.getByLabelText('Save remote thread title'));
    expect(mockRenameMutate).toHaveBeenCalled();

    await rerender(<RemoteThreadActions thread={baseThread} running={false} onDeleted={onDeleted} onForked={onForked} />);
    await fireEvent.press(screen.getByLabelText('Rename'));
    await fireEvent.press(screen.getByLabelText('Cancel renaming'));
    await fireEvent.press(screen.getByLabelText('Fork'));
    await fireEvent.press(screen.getByLabelText('Archive'));
    await fireEvent.press(screen.getByLabelText('Cancel thread'));
    await fireEvent.press(screen.getByLabelText('Delete'));
    expect(mockInterruptMutate).toHaveBeenCalledWith({ threadId: 'thread-1' });
    expect(onForked).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'fork-1' }));
    expect(onDeleted).toHaveBeenCalled();
    expect(alert).toHaveBeenCalledTimes(2);
    alert.mockRestore();
  });

  it('renders empty, loading, and populated activity', async () => {
    const { rerender } = await renderRemote(<RemoteThreadActivity thread={baseThread} loading />);
    expect(screen.getByText('Loading remote activity…')).toBeTruthy();
    await rerender(<RemoteThreadActivity thread={baseThread} loading={false} />);
    expect(screen.getByText('No activity has been recorded yet.')).toBeTruthy();

    const items = ['userMessage', 'steeringMessage', 'toolCall', 'approval', 'error', 'other'].map(
      (type, index) => ({
        id: `item-${index}`,
        turnId: 'turn-1',
        type,
        status: index === 0 ? 'failed' : index === 1 ? 'declined' : index === 2 ? 'inProgress' : 'completed',
        content: index === 5 ? null : `${type} content`,
        createdAt: 1,
        updatedAt: 1,
      })
    );
    await rerender(
      <RemoteThreadActivity
        thread={{ ...baseThread, turns: [{ id: 'turn-1', threadId: 'thread-1', runId: 'run-1', status: 'completed', items, createdAt: 1, updatedAt: 1 }] }}
        loading={false}
      />
    );
    expect(screen.getByText('User Message')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Used 1 desktop tool'));
    expect(screen.getByText('toolCall content')).toBeTruthy();
  });

  it('keeps rich tool details collapsed until the activity summary is expanded', async () => {
    const item = {
      id: 'edit-1',
      turnId: 'turn-1',
      type: 'toolCall',
      status: 'completed',
      content: { toolName: 'edit_file', result: { diff: '@@ -1 +1 @@\n context\n-old\n+new' } },
      createdAt: 1,
      updatedAt: 1,
    };
    await renderRemote(
      <RemoteThreadActivity
        thread={{ ...baseThread, turns: [{ id: 'turn-1', threadId: 'thread-1', runId: 'run-1', status: 'completed', items: [item], createdAt: 1, updatedAt: 1 }] }}
        loading={false}
      />
    );
    const summary = screen.getByLabelText('Edited 1 file');
    expect(summary.props.accessibilityState).toEqual({ expanded: false });
    await fireEvent.press(summary);
    expect(screen.getByLabelText('Remote inline diff')).toBeTruthy();
  });

  it('renders remote chat and activity screenshots', async () => {
    const items = [
      {
        id: 'user-image',
        turnId: 'turn-1',
        type: 'userMessage',
        status: 'completed',
        content: { text: 'See this screen', imageUri: 'data:image/png;base64,user' },
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: 'image-only',
        turnId: 'turn-1',
        type: 'agentMessage',
        status: 'completed',
        content: { imageUri: 'data:image/png;base64,agent' },
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: 'tool-image',
        turnId: 'turn-1',
        type: 'toolCall',
        status: 'completed',
        content: { text: 'Captured desktop', imageUri: 'data:image/png;base64,tool' },
        createdAt: 1,
        updatedAt: 1,
      },
    ];
    const { rerender } = await renderRemote(
      <RemoteThreadActivity
        thread={{ ...baseThread, taskMode: 'chat', turns: [{ id: 'turn-1', threadId: 'thread-1', runId: 'run-1', status: 'completed', items: items.slice(0, 2), createdAt: 1, updatedAt: 1 }] }}
        loading={false}
      />
    );
    expect(screen.getByText('See this screen')).toBeTruthy();
    expect(screen.getAllByLabelText('Remote desktop screenshot')).toHaveLength(2);
    await rerender(
      <RemoteThreadActivity
        thread={{ ...baseThread, turns: [{ id: 'turn-1', threadId: 'thread-1', runId: 'run-1', status: 'completed', items: items.slice(2), createdAt: 1, updatedAt: 1 }] }}
        loading={false}
      />
    );
    await fireEvent.press(screen.getByLabelText('Used 1 desktop tool'));
    expect(screen.getAllByLabelText('Remote desktop screenshot')).toHaveLength(1);
  });

  it('renders review loading, error, scopes, files, diff, and truncation', async () => {
    mockReviewState = { isLoading: true, error: new Error('Review failed'), data: null };
    const { rerender } = await renderRemote(<RemoteReviewPanel />);
    expect(screen.getByText('Loading desktop changes…')).toBeTruthy();
    expect(screen.getByText('Review failed')).toBeTruthy();

    mockReviewState = {
      isLoading: false,
      error: null,
      data: { message: 'Two files', files: [{ path: 'src/app.ts', status: 'M' }], rawDiff: '+change', truncated: true },
    };
    await rerender(<RemoteReviewPanel />);
    await fireEvent.press(screen.getByLabelText('Staged'));
    expect(screen.getByText('src/app.ts')).toBeTruthy();
    expect(screen.getByText('+change')).toBeTruthy();
    expect(screen.getByText('Diff truncated by the desktop safety limit.')).toBeTruthy();
  });

  it('opens the changes bottom sheet from the compact diff pill', async () => {
    mockReviewState = {
      isLoading: false,
      error: null,
      data: {
        message: 'Two files',
        files: [{ path: 'src/app.ts', status: 'M' }, { path: 'src/view.tsx', status: 'M' }],
        rawDiff: '--- a/src/app.ts\n+++ b/src/app.ts\n-old\n+new\n+another',
        truncated: false,
      },
    };
    await renderRemote(<RemoteChangeSummaryPill />);
    expect(screen.getByText('2 files')).toBeTruthy();
    expect(screen.getAllByText('+2').length).toBeGreaterThan(0);
    expect(screen.getAllByText('−1').length).toBeGreaterThan(0);
    await fireEvent.press(screen.getByLabelText('Open remote desktop changes'));
    expect(screen.getByText('Changes')).toBeTruthy();
    expect(summarizeDesktopReview('+++ b/file\n+added\n--- a/file\n-removed', 1)).toEqual({
      files: 1,
      additions: 1,
      deletions: 1,
    });
  });

  it('renders compact review loading and error states', async () => {
    mockReviewState = { isLoading: true, error: null, data: null };
    const { rerender } = await renderRemote(<RemoteChangeSummaryPill />);
    expect(screen.getByText('Checking changes…')).toBeTruthy();

    mockReviewState = { isLoading: false, error: new Error('offline'), data: null };
    await rerender(<RemoteChangeSummaryPill />);
    expect(screen.getByText('Changes unavailable')).toBeTruthy();
  });

  it('browses remote workspace files and preview states', async () => {
    mockFilesState = { isLoading: true, error: new Error('Files failed'), data: { files: ['src/app.ts'], truncated: true } };
    mockFileState = { isLoading: true, error: new Error('Preview failed'), data: null };
    const { rerender } = await renderRemote(<RemoteFilesPanel />);
    await fireEvent.changeText(screen.getByLabelText('Search remote workspace files'), 'app');
    expect(screen.getByText('Loading workspace files…')).toBeTruthy();
    expect(screen.getByText('Files failed')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Open remote file src/app.ts'));
    expect(screen.getByText('Loading file preview…')).toBeTruthy();
    expect(screen.getByText('Preview failed')).toBeTruthy();

    mockFileState = { isLoading: false, error: null, data: { content: 'export {};', binary: false, truncated: true } };
    await rerender(<RemoteFilesPanel />);
    expect(screen.getByText('export {};')).toBeTruthy();
    expect(screen.getByText('File preview truncated at 256 KB.')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Back to remote workspace files'));
    expect(screen.getByText('Refine the search to see more files.')).toBeTruthy();
  });

  it('renders thread detail status and the shared code changes control', async () => {
    mockReviewState = {
      isLoading: false,
      error: null,
      data: { message: 'One file', files: [{ path: 'src/app.ts', status: 'M' }], rawDiff: '+change', truncated: false },
    };
    mockThreadState = { isLoading: false, isFetching: true, data: { ...baseThread, lastError: 'Boom', state: 'paused' } };
    const { rerender } = await renderRemote(
      <RemoteThreadDetail summary={baseThread} onDeleted={jest.fn()} onForked={jest.fn()} hasPendingInteraction />
    );
    expect(screen.getByText('Needs input')).toBeTruthy();
    expect(screen.getByText('Boom')).toBeTruthy();
    expect(screen.getByLabelText('Open remote desktop changes')).toBeTruthy();

    mockThreadState = { isLoading: false, isFetching: false, data: { ...baseThread, taskMode: 'chat', archived: true } };
    await rerender(<RemoteThreadDetail summary={baseThread} onDeleted={jest.fn()} onForked={jest.fn()} />);
    expect(screen.getByText('Archived')).toBeTruthy();

    const pendingTurn = {
      id: 'turn-1',
      threadId: 'thread-1',
      runId: 'run-1',
      status: 'completed',
      items: [{ id: 'approval-1', turnId: 'turn-1', type: 'approval', status: 'inProgress', content: '', createdAt: 1, updatedAt: 1 }],
      createdAt: 1,
      updatedAt: 1,
    };
    mockThreadState = { isLoading: false, isFetching: false, data: { ...baseThread, taskMode: 'chat', turns: [pendingTurn] } };
    await rerender(<RemoteThreadDetail summary={baseThread} onDeleted={jest.fn()} onForked={jest.fn()} />);
    expect(screen.getByText('Needs input')).toBeTruthy();

    for (const [overrides, label] of [
      [{ lastError: 'Failed remotely' }, 'Failed'],
      [{ state: 'paused' }, 'Paused'],
      [{ state: 'canceled' }, 'Canceled'],
      [{ state: 'completed' }, 'Completed'],
    ] as const) {
      mockThreadState = { isLoading: false, isFetching: false, data: { ...baseThread, taskMode: 'chat', ...overrides } };
      await rerender(<RemoteThreadDetail summary={baseThread} onDeleted={jest.fn()} onForked={jest.fn()} />);
      expect(screen.getByText(label)).toBeTruthy();
    }
  });
});
