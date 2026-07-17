import { fireEvent, render } from '@testing-library/react-native';
import React from 'react';

import { RemoteWorkspaceList } from '../../../features/desktop-work/components/remote-workspace-list';

jest.mock('../../../features/desktop-work/data/desktop-work', () => ({
  useDesktopThreadActionMutation: () => ({ mutate: jest.fn(), isPending: false, error: null }),
}));

jest.mock('../../../contexts/ThemeContext', () => ({
  useTheme: () => ({
    theme: {
      colors: {
        background: '#000',
        border: '#333',
        cardBackground: '#111',
        text: '#fff',
        textMuted: '#999',
      },
    },
  }),
}));

jest.mock('../../../components/Icon', () => {
  const react = require('react');
  const { Text } = require('react-native');
  return {
    Icon: ({ name }: { name: string }) => react.createElement(Text, null, `icon-${name}`),
  };
});

const thread = {
  id: 'thread-1',
  sessionId: 'session-1',
  title: 'Remote review',
  objective: 'Review the workspace',
  lastMessage: 'Running checks',
  updatedAt: Date.now(),
  taskMode: 'chat',
  state: 'running',
  activeRunId: 'run-1',
  archived: false,
  turns: [],
} as any;

const baseProps = {
  desktopWork: {
    data: { status: 'connected' },
    isLoading: false,
    isError: false,
    error: null,
  } as any,
  machineName: 'This Mac',
  projects: [],
  threads: [thread],
  interactions: [],
  activeProjectId: null,
  organizeMode: 'chronological' as const,
  filter: 'all' as const,
  onFilterChange: jest.fn(),
  onOpenThread: jest.fn(),
  onLongPressThread: jest.fn(),
  onNewThread: jest.fn(),
};

describe('RemoteWorkspaceList', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('supports chronological rows, searching, clearing, filtering, and row actions', async () => {
    const view = await render(<RemoteWorkspaceList {...baseProps} />);

    expect(view.getByText('icon-ChevronDown')).toBeTruthy();
    expect(view.getByLabelText('Active thread running')).toBeTruthy();
    await fireEvent.changeText(view.getByLabelText('Search remote threads'), 'Remote');
    await fireEvent.press(view.getByLabelText('Clear remote thread search'));
    await fireEvent.press(view.getByLabelText('Filter remote threads: Running'));
    await fireEvent.press(view.getByLabelText('Open active session: Remote review'));
    await fireEvent(view.getByLabelText('Open active session: Remote review'), 'longPress');

    expect(baseProps.onFilterChange).toHaveBeenCalledWith('running');
    expect(baseProps.onOpenThread).toHaveBeenCalledWith(thread);
    expect(baseProps.onLongPressThread).toHaveBeenCalledWith(thread);
    await view.unmount();
  });

  it('renders loading and empty connected states', async () => {
    const loading = await render(
      <RemoteWorkspaceList
        {...baseProps}
        desktopWork={{ ...baseProps.desktopWork, isLoading: true } as any}
      />
    );
    expect(loading.getByText('Loading desktop work...')).toBeTruthy();
    await loading.unmount();

    const empty = await render(<RemoteWorkspaceList {...baseProps} threads={[]} />);
    expect(empty.getByText('No matching remote threads.')).toBeTruthy();
    await empty.unmount();
  });

  it('uses concrete and fallback connection errors', async () => {
    const concrete = await render(
      <RemoteWorkspaceList
        {...baseProps}
        desktopWork={{ data: undefined, isLoading: false, isError: true, error: new Error('Relay unavailable') } as any}
      />
    );
    expect(concrete.getByText('Relay unavailable')).toBeTruthy();
    await concrete.unmount();

    const fallback = await render(
      <RemoteWorkspaceList
        {...baseProps}
        desktopWork={{ data: undefined, isLoading: false, isError: true, error: 'unknown' } as any}
      />
    );
    expect(fallback.getByText('Connect the desktop app to view live work.')).toBeTruthy();
    await fallback.unmount();
  });
});
