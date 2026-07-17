import { fireEvent, render } from '@testing-library/react-native';
import React from 'react';

import { CloudTasksScreen } from '../../screens/CloudTasksScreen';

const mockUseCloudTasksQuery = jest.fn();

jest.mock('../../hooks/api/cloudTasks', () => ({
  useCloudTasksQuery: (...args: unknown[]) => mockUseCloudTasksQuery(...args),
}));

jest.mock('../../contexts/ThemeContext', () => ({
  useTheme: () => ({
    theme: {
      colors: {
        background: '#111827',
        border: '#374151',
        cardBackground: '#1f2937',
        primary: '#2563eb',
        text: '#f9fafb',
        textMuted: '#9ca3af',
      },
    },
  }),
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: React.PropsWithChildren) => children,
  useSafeAreaInsets: () => ({ top: 47, right: 0, bottom: 34, left: 0 }),
}));

jest.mock('../../components/Icon', () => {
  const react = require('react');
  const { Text } = require('react-native');
  return {
    Icon: ({ name }: { name: string }) => react.createElement(Text, null, `icon-${name}`),
  };
});

describe('CloudTasksScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseCloudTasksQuery.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      isRefetching: false,
      refetch: jest.fn(),
    });
  });

  it('shows the live empty state and routes close and create actions', async () => {
    const onClose = jest.fn();
    const onCreate = jest.fn();
    const { getByLabelText, getByText } = await render(
      <CloudTasksScreen visible onClose={onClose} onCreate={onCreate} />
    );

    expect(getByText('No cloud tasks yet')).toBeTruthy();
    await fireEvent.press(getByLabelText('Start Cloud task'));
    await fireEvent.press(getByLabelText('Close Cloud tasks'));

    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps the header below the device safe area', async () => {
    const view = await render(
      <CloudTasksScreen visible onClose={jest.fn()} onCreate={jest.fn()} />
    );
    const header = view.getByText('TaskForceAI').parent?.parent;

    expect(header?.props.style).toContainEqual({ paddingTop: 47 });
  });

  it('renders and filters active cloud tasks', async () => {
    mockUseCloudTasksQuery.mockReturnValue({
      data: [
        {
          task_id: 'cloud-1',
          prompt: 'Review deployment health',
          status: 'running',
          source: 'cloud',
        },
      ],
      isLoading: false,
      isError: false,
      isRefetching: false,
      refetch: jest.fn(),
    });
    const { getByLabelText, getByText, queryByText } = await render(
      <CloudTasksScreen visible onClose={jest.fn()} onCreate={jest.fn()} />
    );

    expect(getByText('Review deployment health')).toBeTruthy();
    await fireEvent.changeText(getByLabelText('Search Cloud tasks'), 'missing');
    expect(queryByText('Review deployment health')).toBeNull();
    expect(getByText('No matching cloud tasks')).toBeTruthy();
  });
});
