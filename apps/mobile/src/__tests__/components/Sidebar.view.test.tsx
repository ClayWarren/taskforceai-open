import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { Text, View } from 'react-native';

import { SidebarView } from '../../components/Sidebar.view';

jest.mock('../../utils/nativewind', () => ({
  styled: (component: unknown) => component,
}));

jest.mock('react-i18next', () =>
  require('../helpers/mock-modules').createTranslationMockModule()
);

jest.mock('../../components/Icon', () => require('../helpers/mock-modules').createIconMockModule());

jest.mock('@shopify/flash-list', () => {
  const react = require('react');
  const { Text: ReactNativeText, TouchableOpacity, View: FlashListView } = require('react-native');

  const FlashList = ({
    data,
    renderItem,
    ListEmptyComponent,
    ListFooterComponent,
    onEndReached,
  }: {
    data: unknown[];
    renderItem: ({ item, index }: { item: unknown; index: number }) => React.ReactElement;
    ListEmptyComponent?: React.ComponentType | React.ReactElement;
    ListFooterComponent?: React.ComponentType | React.ReactElement;
    onEndReached?: () => void;
  }) => {
    const empty =
      typeof ListEmptyComponent === 'function'
        ? react.createElement(ListEmptyComponent)
        : (ListEmptyComponent ?? null);

    const footer =
      typeof ListFooterComponent === 'function'
        ? react.createElement(ListFooterComponent)
        : (ListFooterComponent ?? null);

    return react.createElement(
      FlashListView,
      null,
      (data?.length ?? 0) > 0
        ? data.map((item: any, index: number) =>
            react.createElement(FlashListView, { key: item.id ?? index }, renderItem({ item, index }))
          )
        : empty,
      onEndReached
        ? react.createElement(
            TouchableOpacity,
            {
              testID: 'flash-list-end-reached',
              onPress: onEndReached,
            },
            react.createElement(ReactNativeText, null, 'end-reached')
          )
        : null,
      footer
    );
  };

  return { FlashList };
});

type SidebarProps = React.ComponentProps<typeof SidebarView>;

const createProps = (overrides: Partial<SidebarProps> = {}): SidebarProps => ({
  visible: true,
  onClose: jest.fn(),
  onNewChat: jest.fn(),
  isAuthenticated: true,
  insets: { top: 0, bottom: 0, left: 0, right: 0 },
  SidebarComponent: ({ children, ...rest }: React.PropsWithChildren<Record<string, unknown>>) => (
    <View {...rest}>{children}</View>
  ),
  useGlass: false,
  searchQuery: '',
  setSearchQuery: jest.fn(),
  projects: [],
  activeProjectId: null,
  onSelectProject: jest.fn(),
  onManageProjects: jest.fn(),
  filteredConversations: [],
  handleConversationPress: jest.fn(),
  handleDeleteConversation: jest.fn(),
  userName: undefined,
  userInitials: undefined,
  onSettingsPress: jest.fn(),
  onEndReached: jest.fn(),
  isLoadingMore: false,
  ...overrides,
});

describe('SidebarView', () => {
  it('renders unauthenticated empty state', () => {
    const props = createProps({
      isAuthenticated: false,
      filteredConversations: [],
    });

    const { getByText } = render(<SidebarView {...props} />);

    expect(getByText('Guest mode')).toBeTruthy();
    expect(
      getByText('Local prompt drafts stay on this device. Sign in to run AI tasks and sync conversations.')
    ).toBeTruthy();
  });

  it('renders authenticated search empty state', () => {
    const props = createProps({
      searchQuery: 'missing',
      filteredConversations: [],
    });

    const { getByText } = render(<SidebarView {...props} />);

    expect(getByText('No conversations found')).toBeTruthy();
    expect(getByText('Try a different search')).toBeTruthy();
  });

  it('handles clear search and new chat actions', () => {
    const onClose = jest.fn();
    const onNewChat = jest.fn();
    const setSearchQuery = jest.fn();

    const props = createProps({
      onClose,
      onNewChat,
      setSearchQuery,
      searchQuery: 'draft',
    });

    const { getByLabelText } = render(<SidebarView {...props} />);

    fireEvent.press(getByLabelText('Clear search'));
    fireEvent.press(getByLabelText('New chat'));

    expect(setSearchQuery).toHaveBeenCalledWith('');
    expect(onNewChat).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('handles conversation press and long press deletion', () => {
    const handleConversationPress = jest.fn();
    const handleDeleteConversation = jest.fn();

    const props = createProps({
      searchQuery: 'alpha',
      filteredConversations: [
        {
          id: 7,
          user_input: 'Alpha summary',
          result: 'Found alpha details in this response',
          timestamp: '2026-01-01T00:00:00.000Z',
        },
      ] as any,
      handleConversationPress,
      handleDeleteConversation,
    });

    const { getByLabelText, getByText } = render(<SidebarView {...props} />);

    const conversation = getByLabelText('Alpha summary');
    fireEvent.press(conversation);
    fireEvent(conversation, 'longPress');

    expect(handleConversationPress).toHaveBeenCalledWith(7);
    expect(handleDeleteConversation).toHaveBeenCalledWith(7, 'Alpha summary');
    expect(getByText('Alpha summary')).toBeTruthy();
  });

  it('renders project actions, settings footer, and pagination footer', () => {
    const onSelectProject = jest.fn();
    const onManageProjects = jest.fn();
    const onSettingsPress = jest.fn();
    const onEndReached = jest.fn();

    const props = createProps({
      projects: [{ id: 11, name: 'Project Eleven' }] as any,
      activeProjectId: 11,
      onSelectProject,
      onManageProjects,
      userName: 'Jane Doe',
      userInitials: 'JD',
      onSettingsPress,
      isLoadingMore: true,
      onEndReached,
    });

    const { getByLabelText, getByText, getByTestId } = render(<SidebarView {...props} />);

    fireEvent.press(getByLabelText('General project'));
    fireEvent.press(getByLabelText('Project Project Eleven'));
    fireEvent.press(getByLabelText('Manage projects'));
    fireEvent.press(getByLabelText('Open settings'));
    fireEvent.press(getByTestId('flash-list-end-reached'));

    expect(onSelectProject).toHaveBeenCalledWith(null);
    expect(onSelectProject).toHaveBeenCalledWith(11);
    expect(onManageProjects).toHaveBeenCalledTimes(1);
    expect(onSettingsPress).toHaveBeenCalledTimes(1);
    expect(onEndReached).toHaveBeenCalledTimes(1);
    expect(getByText('Loading more...')).toBeTruthy();
  });

  it('hides project actions but keeps settings visible for guest users', () => {
    const onSettingsPress = jest.fn();
    const onManageProjects = jest.fn();

    const props = createProps({
      isAuthenticated: false,
      projects: [{ id: 11, name: 'Project Eleven' }] as any,
      onSettingsPress,
      onManageProjects,
    });

    const { getByLabelText, getByText, queryByLabelText } = render(<SidebarView {...props} />);

    expect(queryByLabelText('Manage projects')).toBeNull();
    fireEvent.press(getByLabelText('Open settings'));

    expect(onManageProjects).not.toHaveBeenCalled();
    expect(onSettingsPress).toHaveBeenCalledTimes(1);
    expect(getByText('Guest settings')).toBeTruthy();
    expect(getByText('Privacy, support, and local data')).toBeTruthy();
  });

  it('renders desktop sessions slot inside the sidebar', () => {
    const props = createProps({
      desktopSessionsSlot: <Text>desktop-session-slot</Text>,
    });

    const { getByText } = render(<SidebarView {...props} />);

    expect(getByText('desktop-session-slot')).toBeTruthy();
  });

  it('keeps settings available when authenticated user metadata is not available yet', () => {
    const props = createProps({
      isAuthenticated: true,
      userName: undefined,
      userInitials: undefined,
    });

    const { getByLabelText } = render(<SidebarView {...props} />);

    expect(getByLabelText('Open settings')).toBeTruthy();
  });
});
