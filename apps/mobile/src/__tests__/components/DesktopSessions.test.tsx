import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import { DesktopSessions } from '../../components/DesktopSessions';
import {
  useApproveDesktopSessionMutation,
  useDesktopSessionsQuery,
} from '../../hooks/api/desktopSessions';

jest.mock('../../hooks/api/desktopSessions');

jest.mock('../../components/Icon', () => {
  const react = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    Icon: ({ name }: { name: string }) => react.createElement(Text, null, `icon-${name}`),
  };
});

const mockUseDesktopSessionsQuery = useDesktopSessionsQuery as jest.MockedFunction<
  typeof useDesktopSessionsQuery
>;
const mockUseApproveDesktopSessionMutation =
  useApproveDesktopSessionMutation as jest.MockedFunction<typeof useApproveDesktopSessionMutation>;

const mockRefetch = jest.fn();
const mockMutateAsync = jest.fn().mockResolvedValue(undefined);

const pendingDesktopSession = {
  task_id: 'task-1',
  status: 'processing',
  source: 'desktop',
  prompt: 'Deploy the preview build',
  model_id: 'gpt-5-codex',
  conversation_id: 42,
  updated_at: Math.floor(Date.now() / 1000),
  computer_use: true,
  client_mcp_tools: [
    {
      server_name: 'github',
      tool_name: 'create_pull_request',
      title: 'Create PR',
    },
  ],
  pending_approval: {
    agent_name: 'Codex',
    permission: 'create a pull request',
  },
};

describe('DesktopSessions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseDesktopSessionsQuery.mockReturnValue({
      data: [pendingDesktopSession],
      refetch: mockRefetch,
    } as any);
    mockUseApproveDesktopSessionMutation.mockReturnValue({
      mutateAsync: mockMutateAsync,
    } as any);
  });

  it('returns null when there are no sessions and empty state is not requested', async () => {
    mockUseDesktopSessionsQuery.mockReturnValue({
      data: [],
      refetch: mockRefetch,
    } as any);

    const { toJSON } = await render(<DesktopSessions />);

    expect(toJSON()).toBeNull();
  });

  it('renders the empty state when requested', async () => {
    mockUseDesktopSessionsQuery.mockReturnValue({
      data: [],
      refetch: mockRefetch,
    } as any);

    const { getByText } = await render(<DesktopSessions showEmpty />);

    expect(getByText('No desktop work is active.')).toBeTruthy();
    expect(getByText('0 active')).toBeTruthy();
  });

  it('opens the desktop work surface from the sidebar empty state', async () => {
    mockUseDesktopSessionsQuery.mockReturnValue({
      data: [],
      refetch: mockRefetch,
    } as any);
    const onOpen = jest.fn();

    const { getAllByLabelText } = await render(
      <DesktopSessions showEmpty variant="sidebar" onOpen={onOpen} />
    );

    await fireEvent.press(getAllByLabelText('Open desktop work')[0]);

    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('renders pending desktop session details and refreshes on request', async () => {
    const { getByLabelText, getByText } = await render(<DesktopSessions />);

    expect(getByText('1 waiting')).toBeTruthy();
    expect(getByText('Needs approval')).toBeTruthy();
    expect(getByText('Deploy the preview build')).toBeTruthy();
    expect(getByText('Thread #42 · gpt-5-codex')).toBeTruthy();
    expect(getByText('Mac')).toBeTruthy();
    expect(getByText('Live on this phone')).toBeTruthy();
    expect(getByText('Progress')).toBeTruthy();
    expect(getByText('Screen')).toBeTruthy();
    expect(getByText('Approvals')).toBeTruthy();
    expect(getByText('Create PR')).toBeTruthy();
    expect(getByText('Codex needs create a pull request')).toBeTruthy();

    await fireEvent.press(getByLabelText('Refresh desktop sessions'));

    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });

  it('opens the desktop work surface from a sidebar session row', async () => {
    const onOpen = jest.fn();
    const { getByLabelText } = await render(<DesktopSessions variant="sidebar" onOpen={onOpen} />);

    await fireEvent.press(getByLabelText('Open desktop work: Deploy the preview build'));

    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('submits approve and deny decisions from the approval controls', async () => {
    const { getByLabelText } = await render(<DesktopSessions />);

    await fireEvent.press(getByLabelText('Approve desktop session action'));
    await fireEvent.press(getByLabelText('Deny desktop session action'));

    expect(mockMutateAsync).toHaveBeenCalledWith({
      taskId: 'task-1',
      decision: { approved: true },
    });
    expect(mockMutateAsync).toHaveBeenCalledWith({
      taskId: 'task-1',
      decision: { approved: false, error: 'Denied from mobile' },
    });
  });

  it.each([
    [undefined, 'just now'],
    [Math.floor((Date.now() - 60_000) / 1000), '1m ago'],
    [Math.floor((Date.now() - 180_000) / 1000), '3m ago'],
  ])('formats session update time %s as %s', async (updatedAt, expected) => {
    mockUseDesktopSessionsQuery.mockReturnValue({
      data: [{ ...pendingDesktopSession, updated_at: updatedAt }],
      refetch: mockRefetch,
    } as any);

    const { getByText } = await render(<DesktopSessions />);

    expect(getByText(expected)).toBeTruthy();
  });

  it.each([
    ['processing', 'Running'],
    ['completed', 'completed'],
  ])('renders a non-approval %s session as %s', async (status, expected) => {
    mockUseDesktopSessionsQuery.mockReturnValue({
      data: [{ ...pendingDesktopSession, pending_approval: undefined, status }],
      refetch: mockRefetch,
    } as any);

    const { getByText } = await render(<DesktopSessions />);

    expect(getByText(expected)).toBeTruthy();
  });
});
