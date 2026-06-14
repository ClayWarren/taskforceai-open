import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import { AppRoot } from '../../screens/AppRoot';

const mockHandleOpenSidebar = jest.fn();
const mockHandleCloseSidebar = jest.fn();
const mockHandleNewChat = jest.fn(async () => undefined);
const mockHandleSendMessage = jest.fn(async () => undefined);
const mockHandleConversationSelect = jest.fn(async () => undefined);
const mockHandleLogin = jest.fn();
const mockHandleClearCache = jest.fn(async () => undefined);
const mockClearErrorMessage = jest.fn();

let mockIsDarkMode = false;
let mockUserPlan: string | undefined;
let mockCoordinatorValue: any;
let linkingUrlListener: ((event: { url: string }) => void) | null = null;

const mockGetInitialUrl = jest.fn(async () => null);
const mockSubscribeUrlEvents = jest.fn((listener: (event: { url: string }) => void) => {
  linkingUrlListener = listener;
  return { remove: jest.fn() };
});

jest.mock('../../desktop-pairing/linking', () => ({
  getInitialUrl: () => mockGetInitialUrl(),
  subscribeUrlEvents: (listener: (event: { url: string }) => void) => mockSubscribeUrlEvents(listener),
}));

jest.mock('../../utils/nativewind', () => ({
  styled: (component: unknown) => component,
}));

jest.mock('expo-status-bar', () => ({
  StatusBar: () => null,
}));

jest.mock('../../contexts/ThemeContext', () => ({
  useTheme: () => ({
    isDarkMode: mockIsDarkMode,
  }),
}));

jest.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: mockUserPlan ? { plan: mockUserPlan } : null,
  }),
}));

jest.mock('../../hooks/useChatCoordinator', () => ({
  useChatCoordinator: () => mockCoordinatorValue,
}));

jest.mock('../../components/Header', () => ({
  Header: ({ onMenuPress, onNewChatPress, onLoginPress, hasMessages, isAuthenticated }: any) => {
    const react = require('react');
    const { Text, TouchableOpacity, View } = require('react-native');
    return react.createElement(
      View,
      null,
      react.createElement(Text, null, `header-has-messages:${String(hasMessages)}`),
      react.createElement(Text, null, `header-auth:${String(isAuthenticated)}`),
      react.createElement(
        TouchableOpacity,
        { testID: 'header-menu', onPress: onMenuPress },
        react.createElement(Text, null, 'menu')
      ),
      react.createElement(
        TouchableOpacity,
        { testID: 'header-new-chat', onPress: onNewChatPress },
        react.createElement(Text, null, 'new chat')
      ),
      react.createElement(
        TouchableOpacity,
        { testID: 'header-login', onPress: onLoginPress },
        react.createElement(Text, null, 'login')
      )
    );
  },
}));

jest.mock('../../components/PendingPrompts', () => ({
  PendingPrompts: () => {
    const react = require('react');
    const { Text } = require('react-native');
    return react.createElement(Text, null, 'pending-prompts');
  },
}));

jest.mock('../../components/DesktopSessions', () => ({
  DesktopSessions: () => {
    const react = require('react');
    const { Text } = require('react-native');
    return react.createElement(Text, null, 'desktop-sessions');
  },
}));

jest.mock('../../components/Sidebar', () => ({
  Sidebar: ({
    visible,
    onClose,
    onSettingsPress,
    onDesktopSessionsPress,
    onNewChat,
    onConversationSelect,
  }: any) => {
    const react = require('react');
    const { Text, TouchableOpacity, View } = require('react-native');
    return react.createElement(
      View,
      null,
      react.createElement(Text, null, `sidebar-visible:${String(visible)}`),
      react.createElement(
        TouchableOpacity,
        { testID: 'sidebar-close', onPress: onClose },
        react.createElement(Text, null, 'sidebar-close')
      ),
      react.createElement(
        TouchableOpacity,
        { testID: 'sidebar-settings', onPress: onSettingsPress },
        react.createElement(Text, null, 'open-settings')
      ),
      react.createElement(
        TouchableOpacity,
        { testID: 'sidebar-desktop', onPress: onDesktopSessionsPress },
        react.createElement(Text, null, 'open-desktop')
      ),
      react.createElement(
        TouchableOpacity,
        { testID: 'sidebar-new-chat', onPress: onNewChat },
        react.createElement(Text, null, 'sidebar-new-chat')
      ),
      react.createElement(
        TouchableOpacity,
        {
          testID: 'sidebar-conversation-select',
          onPress: () => {
            void onConversationSelect({ id: 77, model: 'remote-77' });
          },
        },
        react.createElement(Text, null, 'select-conversation')
      )
    );
  },
}));

jest.mock('../../screens/ChatScreen', () => ({
  ChatScreen: ({ messages, isSidebarVisible, modelLabel, userPlan }: any) => {
    const react = require('react');
    const { Text, View } = require('react-native');
    return react.createElement(
      View,
      null,
      react.createElement(Text, null, `chat-message-count:${messages.length}`),
      react.createElement(Text, null, `chat-sidebar:${String(isSidebarVisible)}`),
      react.createElement(Text, null, `chat-model:${String(modelLabel)}`),
      react.createElement(Text, null, `chat-user-plan:${String(userPlan)}`)
    );
  },
}));

jest.mock('../../screens/DesktopWorkScreen', () => ({
  DesktopWorkScreen: ({ visible, onClose }: any) => {
    const react = require('react');
    const { Text, TouchableOpacity, View } = require('react-native');
    return react.createElement(
      View,
      null,
      react.createElement(Text, null, `desktop-work-visible:${String(visible)}`),
      react.createElement(
        TouchableOpacity,
        { testID: 'desktop-work-close', onPress: onClose },
        react.createElement(Text, null, 'close-desktop-work')
      )
    );
  },
}));

jest.mock('../../screens/SettingsScreen', () => ({
  SettingsScreen: ({ visible, onClose, desktopPairingPayload }: any) => {
    const react = require('react');
    const { Text, TouchableOpacity, View } = require('react-native');
    return react.createElement(
      View,
      null,
      react.createElement(Text, null, `settings-visible:${String(visible)}`),
      react.createElement(Text, null, `settings-desktop-pairing:${String(desktopPairingPayload)}`),
      react.createElement(
        TouchableOpacity,
        { testID: 'settings-close', onPress: onClose },
        react.createElement(Text, null, 'close-settings')
      )
    );
  },
}));

describe('AppRoot', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    linkingUrlListener = null;
    mockGetInitialUrl.mockResolvedValue(null);
    mockSubscribeUrlEvents.mockImplementation((listener: (event: { url: string }) => void) => {
      linkingUrlListener = listener;
      return { remove: jest.fn() };
    });
    mockIsDarkMode = false;
    mockUserPlan = 'pro';
    mockCoordinatorValue = {
      isAuthenticated: true,
      isSidebarVisible: true,
      handleOpenSidebar: mockHandleOpenSidebar,
      handleCloseSidebar: mockHandleCloseSidebar,
      conversation: {
        messages: [{ id: 'message-1', role: 'user', content: 'hi' }],
      },
      streamingContext: {
        isStreaming: false,
        streamContent: '',
        agentStatuses: [],
        elapsedSeconds: 0,
        sources: [],
        toolEvents: [],
        modelLabel: 'openai/gpt-5.5',
        errorMessage: null,
        rateLimitResetTime: null,
        clearErrorMessage: mockClearErrorMessage,
      },
      handleSendMessage: mockHandleSendMessage,
      handleNewChat: mockHandleNewChat,
      handleConversationSelect: mockHandleConversationSelect,
      handleLogin: mockHandleLogin,
      handleClearCache: mockHandleClearCache,
      computerUseEnabled: false,
    };
  });

  it('wires chat/header props from coordinator and auth state', () => {
    const { getByText } = render(<AppRoot />);

    expect(getByText('header-has-messages:true')).toBeTruthy();
    expect(getByText('header-auth:true')).toBeTruthy();
    expect(getByText('chat-message-count:1')).toBeTruthy();
    expect(getByText('chat-sidebar:true')).toBeTruthy();
    expect(getByText('chat-model:openai/gpt-5.5')).toBeTruthy();
    expect(getByText('chat-user-plan:pro')).toBeTruthy();
  });

  it('routes header actions to coordinator handlers', () => {
    const { getByTestId } = render(<AppRoot />);

    fireEvent.press(getByTestId('header-menu'));
    fireEvent.press(getByTestId('header-new-chat'));
    fireEvent.press(getByTestId('header-login'));

    expect(mockHandleOpenSidebar).toHaveBeenCalledTimes(1);
    expect(mockHandleNewChat).toHaveBeenCalledTimes(1);
    expect(mockHandleLogin).toHaveBeenCalledTimes(1);
  });

  it('closes sidebar and opens settings when settings is pressed', () => {
    const { getByTestId, getByText } = render(<AppRoot />);

    expect(getByText('settings-visible:false')).toBeTruthy();
    fireEvent.press(getByTestId('sidebar-settings'));

    expect(mockHandleCloseSidebar).toHaveBeenCalledTimes(1);
    expect(getByText('settings-visible:true')).toBeTruthy();
  });

  it('closes settings screen when onClose is pressed', () => {
    const { getByTestId, getByText } = render(<AppRoot />);

    fireEvent.press(getByTestId('sidebar-settings'));
    expect(getByText('settings-visible:true')).toBeTruthy();

    fireEvent.press(getByTestId('settings-close'));
    expect(getByText('settings-visible:false')).toBeTruthy();
  });

  it('opens desktop work from the sidebar desktop entry', () => {
    const { getByTestId, getByText } = render(<AppRoot />);

    expect(getByText('desktop-work-visible:false')).toBeTruthy();
    fireEvent.press(getByTestId('sidebar-desktop'));

    expect(mockHandleCloseSidebar).toHaveBeenCalledTimes(1);
    expect(getByText('desktop-work-visible:true')).toBeTruthy();
    expect(getByText('settings-visible:false')).toBeTruthy();
  });

  it('closes desktop work screen when onClose is pressed', () => {
    const { getByTestId, getByText } = render(<AppRoot />);

    fireEvent.press(getByTestId('sidebar-desktop'));
    expect(getByText('desktop-work-visible:true')).toBeTruthy();

    fireEvent.press(getByTestId('desktop-work-close'));
    expect(getByText('desktop-work-visible:false')).toBeTruthy();
  });

  it('opens settings with desktop pairing payload from a deep link', async () => {
    const link = 'taskforceai://desktop-pairing?payload=%7B%7D';
    const { getByText } = render(<AppRoot />);

    act(() => {
      linkingUrlListener?.({ url: link });
    });

    await waitFor(() => {
      expect(getByText('settings-visible:true')).toBeTruthy();
    });
    expect(getByText(`settings-desktop-pairing:${link}`)).toBeTruthy();
    expect(mockHandleCloseSidebar).toHaveBeenCalledTimes(1);
  });

  it('passes sidebar callbacks through to coordinator handlers', () => {
    const { getByTestId } = render(<AppRoot />);

    fireEvent.press(getByTestId('sidebar-new-chat'));
    fireEvent.press(getByTestId('sidebar-conversation-select'));

    expect(mockHandleNewChat).toHaveBeenCalledTimes(1);
    expect(mockHandleConversationSelect).toHaveBeenCalledWith({ id: 77, model: 'remote-77' });
  });
});
