import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import type { Project } from '@taskforceai/contracts/contracts';

import { ProjectsScreen } from '../../screens/ProjectsScreen';

const mockCreateMutateAsync = jest.fn(async () => undefined);
const mockDeleteMutateAsync = jest.fn(async () => undefined);

jest.mock('@shopify/flash-list', () => {
  const react = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    FlashList: (props: any) => {
      const items = props.data || [];
      const content = items.length === 0 
        ? (typeof props.ListEmptyComponent === 'function' ? react.createElement(props.ListEmptyComponent) : props.ListEmptyComponent)
        : items.map((item: any, index: number) => 
            react.createElement(View, { key: props.keyExtractor ? props.keyExtractor(item, index) : index }, 
              props.renderItem({ item, index })
            )
          );
      return react.createElement(View, { style: props.style }, 
        props.ListHeaderComponent,
        content
      );
    },
  };
});

jest.mock('../../contexts/ThemeContext', () => ({
  __esModule: true,
  useTheme: () => ({
    theme: {
      colors: {
        background: '#000',
        text: '#fff',
        cardBackground: '#111',
        primary: '#0ea5e9',
      },
    },
  }),
}));

jest.mock('react-native-safe-area-context', () => ({
  __esModule: true,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('../../hooks/api/projects', () => ({
  __esModule: true,
  useCreateProjectMutation: () => ({
    mutateAsync: mockCreateMutateAsync,
    isPending: false,
  }),
  useDeleteProjectMutation: () => ({
    mutateAsync: mockDeleteMutateAsync,
    isPending: false,
  }),
}));

jest.mock('../../components/Icon', () => {
  const react = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    Icon: ({ name }: { name: string }) => react.createElement(Text, null, `icon-${name}`),
  };
});

jest.mock('../../logger', () => ({
  createModuleLogger: () => ({
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
  }),
}));

describe('ProjectsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders empty state when there are no projects', async () => {
    const { getByText } = await render(
      <ProjectsScreen
        visible={true}
        onClose={jest.fn()}
        projects={[]}
        activeProjectId={null}
        onSelectProject={jest.fn()}
      />
    );

    expect(getByText('No projects yet')).toBeTruthy();
    expect(getByText('Create a project to organize your conversations')).toBeTruthy();
  });

  it('creates a project with trimmed values', async () => {
    const { getByText, getByPlaceholderText } = await render(
      <ProjectsScreen
        visible={true}
        onClose={jest.fn()}
        projects={[]}
        activeProjectId={null}
        onSelectProject={jest.fn()}
      />
    );

    await fireEvent.press(getByText('Create New Project'));
    await fireEvent.changeText(getByPlaceholderText('Project name'), '  Alpha  ');
    await fireEvent.changeText(getByPlaceholderText('Description (optional)'), '  First project  ');
    await fireEvent.changeText(getByPlaceholderText('Custom instructions (optional)'), '  Use concise updates.  ');
    await fireEvent.press(getByText('Create'));

    await waitFor(() => {
      expect(mockCreateMutateAsync).toHaveBeenCalledWith({
        name: 'Alpha',
        description: 'First project',
        custom_instructions: 'Use concise updates.',
      });
    });
  });

  it('clears active selection when deleting active project', async () => {
    const onSelectProject = jest.fn();
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      const destructive = buttons?.find((button) => button.style === 'destructive');
      destructive?.onPress?.();
    });

    const { getAllByText } = await render(
      <ProjectsScreen
        visible={true}
        onClose={jest.fn()}
        projects={[
          {
            id: 10,
            name: 'Alpha',
            description: 'Project A',
          } as Project,
        ]}
        activeProjectId={10}
        onSelectProject={onSelectProject}
      />
    );

    await fireEvent.press(getAllByText('icon-Trash2')[0]);

    await waitFor(() => {
      expect(mockDeleteMutateAsync).toHaveBeenCalledWith(10);
      expect(onSelectProject).toHaveBeenCalledWith(null);
    });
    alertSpy.mockRestore();
  });

  it('shows an error alert when project creation fails', async () => {
    mockCreateMutateAsync.mockRejectedValueOnce(new Error('create failed'));
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);

    const { getByText, getByPlaceholderText } = await render(
      <ProjectsScreen
        visible={true}
        onClose={jest.fn()}
        projects={[]}
        activeProjectId={null}
        onSelectProject={jest.fn()}
      />
    );

    await fireEvent.press(getByText('Create New Project'));
    await fireEvent.changeText(getByPlaceholderText('Project name'), 'Alpha');
    await fireEvent.press(getByText('Create'));

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith('Error', 'Failed to create project');
    });
    alertSpy.mockRestore();
  });

  it('shows an error alert when project deletion fails', async () => {
    mockDeleteMutateAsync.mockRejectedValueOnce(new Error('delete failed'));
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      const destructive = buttons?.find((button) => button.style === 'destructive');
      destructive?.onPress?.();
    });

    const { getAllByText } = await render(
      <ProjectsScreen
        visible={true}
        onClose={jest.fn()}
        projects={[
          {
            id: 10,
            name: 'Alpha',
            description: 'Project A',
          } as Project,
        ]}
        activeProjectId={10}
        onSelectProject={jest.fn()}
      />
    );

    await fireEvent.press(getAllByText('icon-Trash2')[0]);

    await waitFor(() => {
      expect(mockDeleteMutateAsync).toHaveBeenCalledWith(10);
      expect(alertSpy).toHaveBeenCalledWith('Error', 'Failed to delete project');
    });
    alertSpy.mockRestore();
  });
});
