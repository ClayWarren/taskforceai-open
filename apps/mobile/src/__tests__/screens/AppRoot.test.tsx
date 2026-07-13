import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import { AppRoot } from '../../screens/AppRoot';

const mockHandleOpenSidebar = jest.fn();
const mockHandleCloseSidebar = jest.fn();
const mockHandleNewChat = jest.fn(async () => undefined);
const mockHandleSendMessage = jest.fn(async () => undefined);
const mockHandleConversationSelect = jest.fn(async () => undefined);
const mockHandleLogin = jest.fn();
const mockHandleClearCache = jest.fn(async () => undefined);
const mockHandleRealtimeTranscriptMessagesChange = jest.fn();
const mockHandleRealtimeVoiceStart = jest.fn(async () => undefined);
const mockHandleTogglePrivateChat = jest.fn();
const mockHandleExitPrivateChat = jest.fn();
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
  Header: ({
    onMenuPress,
    onNewChatPress,
    onLoginPress,
    hasMessages,
    isAuthenticated,
    isPrivateChat,
    isPrivateChatToggleDisabled,
    shouldRenderPrivateChatToggle,
    onPrivateChatToggle,
    taskMode,
    onTaskModeChange,
  }: any) => {
    const react = require('react');
    const { Text, TouchableOpacity, View } = require('react-native');
    return react.createElement(
      View,
      null,
      react.createElement(Text, null, `header-has-messages:${String(hasMessages)}`),
      react.createElement(Text, null, `header-auth:${String(isAuthenticated)}`),
      react.createElement(Text, null, `header-private:${String(isPrivateChat)}`),
      react.createElement(
        Text,
        null,
        `header-private-disabled:${String(isPrivateChatToggleDisabled)}`
      ),
      react.createElement(
        Text,
        null,
        `header-private-visible:${String(shouldRenderPrivateChatToggle)}`
      ),
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
      ),
      react.createElement(
        TouchableOpacity,
        { testID: 'header-private', onPress: onPrivateChatToggle },
        react.createElement(Text, null, 'private')
      ),
      react.createElement(Text, null, `header-task-mode:${String(taskMode)}`),
      react.createElement(
        TouchableOpacity,
        { testID: 'header-select-work', onPress: () => onTaskModeChange('work') },
        react.createElement(Text, null, 'select-work')
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
    onArtifactsPress,
    onFinancePress,
    onScheduledPress,
    onPluginsPress,
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
        { testID: 'sidebar-scheduled', onPress: onScheduledPress },
        react.createElement(Text, null, 'open-scheduled')
      ),
      react.createElement(
        TouchableOpacity,
        { testID: 'sidebar-plugins', onPress: onPluginsPress },
        react.createElement(Text, null, 'open-plugins')
      ),
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
        { testID: 'sidebar-artifacts', onPress: onArtifactsPress },
        react.createElement(Text, null, 'open-artifacts')
      ),
      react.createElement(
        TouchableOpacity,
        { testID: 'sidebar-finance', onPress: onFinancePress },
        react.createElement(Text, null, 'open-finance')
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
  ChatScreen: ({
    messages,
    isSidebarVisible,
    modelLabel,
    realtimeVoiceResetKey,
    userPlan,
    privateChat,
    taskMode,
  }: any) => {
    const react = require('react');
    const { Text, View } = require('react-native');
    return react.createElement(
      View,
      null,
      react.createElement(Text, null, `chat-message-count:${messages.length}`),
      react.createElement(Text, null, `chat-sidebar:${String(isSidebarVisible)}`),
      react.createElement(Text, null, `chat-model:${String(modelLabel)}`),
      react.createElement(Text, null, `chat-voice-reset:${String(realtimeVoiceResetKey)}`),
      react.createElement(Text, null, `chat-user-plan:${String(userPlan)}`),
      react.createElement(Text, null, `chat-private:${String(privateChat)}`),
      react.createElement(Text, null, `chat-task-mode:${String(taskMode)}`)
    );
  },
}));

jest.mock('../../screens/DesktopWorkScreen', () => ({
  DesktopWorkScreen: ({ visible, onClose, onDismiss, onOpenSettings }: any) => {
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
      ),
      react.createElement(
        TouchableOpacity,
        { testID: 'desktop-work-open-settings', onPress: onOpenSettings },
        react.createElement(Text, null, 'open-desktop-settings')
      ),
      react.createElement(
        TouchableOpacity,
        { testID: 'desktop-work-dismiss', onPress: onDismiss },
        react.createElement(Text, null, 'dismiss-desktop-work')
      )
    );
  },
}));

jest.mock('../../screens/ArtifactsScreen', () => ({
  ArtifactsScreen: ({ visible, onClose }: any) => {
    const react = require('react');
    const { Text, TouchableOpacity, View } = require('react-native');
    return react.createElement(
      View,
      null,
      react.createElement(Text, null, `artifacts-visible:${String(visible)}`),
      react.createElement(
        TouchableOpacity,
        { testID: 'artifacts-close', onPress: onClose },
        react.createElement(Text, null, 'close-artifacts')
      )
    );
  },
}));

jest.mock('../../screens/FinanceScreen', () => ({
  FinanceScreen: ({ visible, onClose }: any) => {
    const react = require('react');
    const { Text, TouchableOpacity, View } = require('react-native');
    return react.createElement(
      View,
      null,
      react.createElement(Text, null, `finance-visible:${String(visible)}`),
      react.createElement(
        TouchableOpacity,
        { testID: 'finance-close', onPress: onClose },
        react.createElement(Text, null, 'close-finance')
      )
    );
  },
}));

jest.mock('../../screens/SettingsScreen', () => ({
  SettingsScreen: ({ visible, onClose, desktopPairingPayload, initialSection }: any) => {
    const react = require('react');
    const { Text, TouchableOpacity, View } = require('react-native');
    return react.createElement(
      View,
      null,
      react.createElement(Text, null, `settings-visible:${String(visible)}`),
      react.createElement(Text, null, `settings-desktop-pairing:${String(desktopPairingPayload)}`),
      react.createElement(Text, null, `settings-initial-section:${String(initialSection)}`),
      react.createElement(
        TouchableOpacity,
        { testID: 'settings-close', onPress: onClose },
        react.createElement(Text, null, 'close-settings')
      )
    );
  },
}));

jest.mock('../../screens/ScheduledScreen', () => ({
  ScheduledScreen: ({ visible, onClose }: any) => {
    const react = require('react');
    const { Text, TouchableOpacity, View } = require('react-native');
    return react.createElement(
      View,
      null,
      react.createElement(Text, null, `scheduled-visible:${String(visible)}`),
      react.createElement(
        TouchableOpacity,
        { testID: 'scheduled-close', onPress: onClose },
        react.createElement(Text, null, 'close-scheduled')
      )
    );
  },
}));

jest.mock('../../screens/PluginsScreen', () => ({
  PluginsScreen: ({ visible, onClose }: any) => {
    const react = require('react');
    const { Text, TouchableOpacity, View } = require('react-native');
    return react.createElement(
      View,
      null,
      react.createElement(Text, null, `plugins-visible:${String(visible)}`),
      react.createElement(
        TouchableOpacity,
        { testID: 'plugins-close', onPress: onClose },
        react.createElement(Text, null, 'close-plugins')
      )
    );
  },
}));

describe('AppRoot', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.EXPO_OS = 'ios';
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
        modelLabel: 'openai/gpt-5.6-sol',
        errorMessage: null,
        rateLimitResetTime: null,
        clearErrorMessage: mockClearErrorMessage,
      },
      handleSendMessage: mockHandleSendMessage,
      handleNewChat: mockHandleNewChat,
      handleConversationSelect: mockHandleConversationSelect,
      handleLogin: mockHandleLogin,
      handleClearCache: mockHandleClearCache,
      handleRealtimeTranscriptMessagesChange: mockHandleRealtimeTranscriptMessagesChange,
      handleRealtimeVoiceStart: mockHandleRealtimeVoiceStart,
      isPrivateChat: false,
      isPrivateChatToggleDisabled: false,
      shouldRenderPrivateChatToggle: true,
      handleTogglePrivateChat: mockHandleTogglePrivateChat,
      handleExitPrivateChat: mockHandleExitPrivateChat,
      computerUseEnabled: false,
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('wires chat/header props from coordinator and auth state', async () => {
    const { getByText } = await render(<AppRoot />);

    expect(getByText('header-has-messages:true')).toBeTruthy();
    expect(getByText('header-auth:true')).toBeTruthy();
    expect(getByText('chat-message-count:1')).toBeTruthy();
    expect(getByText('chat-sidebar:true')).toBeTruthy();
    expect(getByText('chat-model:openai/gpt-5.6-sol')).toBeTruthy();
    expect(getByText('chat-voice-reset:0')).toBeTruthy();
    expect(getByText('chat-user-plan:pro')).toBeTruthy();
    expect(getByText('header-private:false')).toBeTruthy();
    expect(getByText('header-private-disabled:false')).toBeTruthy();
    expect(getByText('header-private-visible:true')).toBeTruthy();
    expect(getByText('chat-private:false')).toBeTruthy();
  });

  it('routes header actions to coordinator handlers', async () => {
    const { getByTestId, getByText } = await render(<AppRoot />);

    await fireEvent.press(getByTestId('header-menu'));
    await fireEvent.press(getByTestId('header-new-chat'));
    await fireEvent.press(getByTestId('header-login'));

    expect(mockHandleOpenSidebar).toHaveBeenCalledTimes(1);
    expect(mockHandleNewChat).toHaveBeenCalledTimes(1);
    expect(mockHandleLogin).toHaveBeenCalledTimes(1);
    expect(getByText('chat-voice-reset:1')).toBeTruthy();
  });

  it('passes private chat state through and hides pending prompts while private', async () => {
    mockCoordinatorValue = {
      ...mockCoordinatorValue,
      isPrivateChat: true,
      isPrivateChatToggleDisabled: true,
    };

    const { getByTestId, getByText, queryByText } = await render(<AppRoot />);

    expect(getByText('header-private:true')).toBeTruthy();
    expect(getByText('header-private-disabled:true')).toBeTruthy();
    expect(getByText('chat-private:true')).toBeTruthy();
    expect(queryByText('pending-prompts')).toBeNull();

    await fireEvent.press(getByTestId('header-private'));
    expect(mockHandleTogglePrivateChat).toHaveBeenCalledTimes(1);
  });

  it('exits private chat before entering Work mode without dropping message protections', async () => {
    mockCoordinatorValue = {
      ...mockCoordinatorValue,
      isPrivateChat: true,
    };

    const { getByTestId, getByText, queryByText } = await render(<AppRoot />);

    expect(getByText('header-private-visible:true')).toBeTruthy();
    expect(getByText('chat-private:true')).toBeTruthy();

    await fireEvent.press(getByTestId('header-select-work'));

    expect(getByText('chat-task-mode:work')).toBeTruthy();
    expect(getByText('header-task-mode:work')).toBeTruthy();
    expect(getByText('header-private-visible:false')).toBeTruthy();
    expect(mockHandleExitPrivateChat).toHaveBeenCalledTimes(1);
    expect(getByText('chat-private:true')).toBeTruthy();
    expect(queryByText('pending-prompts')).toBeNull();
  });

  it('closes sidebar and opens settings when settings is pressed', async () => {
    const { getByTestId, getByText } = await render(<AppRoot />);

    expect(getByText('settings-visible:false')).toBeTruthy();
    await fireEvent.press(getByTestId('sidebar-settings'));

    expect(mockHandleCloseSidebar).toHaveBeenCalledTimes(1);
    expect(getByText('settings-visible:true')).toBeTruthy();
  });

  it('closes settings screen when onClose is pressed', async () => {
    const { getByTestId, getByText } = await render(<AppRoot />);

    await fireEvent.press(getByTestId('sidebar-settings'));
    expect(getByText('settings-visible:true')).toBeTruthy();

    await fireEvent.press(getByTestId('settings-close'));
    expect(getByText('settings-visible:false')).toBeTruthy();
  });

  it('opens desktop work from the sidebar desktop entry', async () => {
    const { getByTestId, getByText } = await render(<AppRoot />);

    expect(getByText('desktop-work-visible:false')).toBeTruthy();
    await fireEvent.press(getByTestId('sidebar-desktop'));

    expect(mockHandleCloseSidebar).toHaveBeenCalledTimes(1);
    expect(getByText('desktop-work-visible:true')).toBeTruthy();
    expect(getByText('settings-visible:false')).toBeTruthy();
    expect(getByText('chat-task-mode:chat')).toBeTruthy();
    expect(getByText('header-task-mode:chat')).toBeTruthy();
  });

  it('waits for Remote dismissal before opening Remote settings', async () => {
    const timeoutSpy = jest.spyOn(globalThis, 'setTimeout');
    const { getByTestId, getByText } = await render(<AppRoot />);

    await fireEvent.press(getByTestId('sidebar-desktop'));
    await fireEvent.press(getByTestId('desktop-work-open-settings'));

    expect(getByText('desktop-work-visible:false')).toBeTruthy();
    expect(getByText('settings-visible:false')).toBeTruthy();
    expect(timeoutSpy).not.toHaveBeenCalledWith(expect.any(Function), 700);

    await fireEvent.press(getByTestId('desktop-work-dismiss'));

    expect(getByText('settings-visible:true')).toBeTruthy();
    expect(getByText('settings-initial-section:null')).toBeTruthy();
  });

  it('opens artifacts from the sidebar artifacts entry', async () => {
    const { getByTestId, getByText } = await render(<AppRoot />);

    expect(getByText('artifacts-visible:false')).toBeTruthy();
    await fireEvent.press(getByTestId('sidebar-artifacts'));

    expect(mockHandleCloseSidebar).toHaveBeenCalledTimes(1);
    expect(getByText('artifacts-visible:true')).toBeTruthy();
    expect(getByText('settings-visible:false')).toBeTruthy();
  });

  it('opens finance from the sidebar finance entry', async () => {
    const { getByTestId, getByText } = await render(<AppRoot />);

    expect(getByText('finance-visible:false')).toBeTruthy();
    await fireEvent.press(getByTestId('sidebar-finance'));

    expect(mockHandleCloseSidebar).toHaveBeenCalledTimes(1);
    expect(getByText('finance-visible:true')).toBeTruthy();
    expect(getByText('settings-visible:false')).toBeTruthy();
  });

  it('opens scheduled tasks from the sidebar entry', async () => {
    const { getByTestId, getByText } = await render(<AppRoot />);

    expect(getByText('scheduled-visible:false')).toBeTruthy();
    await fireEvent.press(getByTestId('sidebar-scheduled'));

    expect(mockHandleCloseSidebar).toHaveBeenCalledTimes(1);
    expect(getByText('scheduled-visible:false')).toBeTruthy();
    await waitFor(() => expect(getByText('scheduled-visible:true')).toBeTruthy());

    await fireEvent.press(getByTestId('scheduled-close'));
    expect(getByText('scheduled-visible:false')).toBeTruthy();
  });

  it('opens plugins from the sidebar entry', async () => {
    const { getByTestId, getByText } = await render(<AppRoot />);

    expect(getByText('plugins-visible:false')).toBeTruthy();
    await fireEvent.press(getByTestId('sidebar-plugins'));

    expect(mockHandleCloseSidebar).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(getByText('plugins-visible:true')).toBeTruthy());

    await fireEvent.press(getByTestId('plugins-close'));
    expect(getByText('plugins-visible:false')).toBeTruthy();
  });

  it('closes finance screen when onClose is pressed', async () => {
    const { getByTestId, getByText } = await render(<AppRoot />);

    await fireEvent.press(getByTestId('sidebar-finance'));
    expect(getByText('finance-visible:true')).toBeTruthy();

    await fireEvent.press(getByTestId('finance-close'));
    expect(getByText('finance-visible:false')).toBeTruthy();
  });

  it('closes artifacts screen when onClose is pressed', async () => {
    const { getByTestId, getByText } = await render(<AppRoot />);

    await fireEvent.press(getByTestId('sidebar-artifacts'));
    expect(getByText('artifacts-visible:true')).toBeTruthy();

    await fireEvent.press(getByTestId('artifacts-close'));
    expect(getByText('artifacts-visible:false')).toBeTruthy();
  });

  it('closes desktop work screen when onClose is pressed', async () => {
    const { getByTestId, getByText } = await render(<AppRoot />);

    await fireEvent.press(getByTestId('sidebar-desktop'));
    expect(getByText('desktop-work-visible:true')).toBeTruthy();

    await fireEvent.press(getByTestId('desktop-work-close'));
    expect(getByText('desktop-work-visible:false')).toBeTruthy();
  });

  it('opens settings with desktop pairing payload from a deep link', async () => {
    const link = 'taskforceai://desktop-pairing?payload=%7B%7D';
    const { getByText } = await render(<AppRoot />);

    await act(() => {
      linkingUrlListener?.({ url: link });
    });

    await waitFor(() => {
      expect(getByText('settings-visible:true')).toBeTruthy();
    });
    expect(getByText(`settings-desktop-pairing:${link}`)).toBeTruthy();
    expect(mockHandleCloseSidebar).toHaveBeenCalledTimes(1);
  });

  it('passes sidebar callbacks through to coordinator handlers', async () => {
    const { getByTestId, getByText } = await render(<AppRoot />);

    await fireEvent.press(getByTestId('sidebar-new-chat'));
    await fireEvent.press(getByTestId('sidebar-conversation-select'));

    expect(mockHandleNewChat).toHaveBeenCalledTimes(1);
    expect(mockHandleConversationSelect).toHaveBeenCalledWith({ id: 77, model: 'remote-77' });
    expect(getByText('chat-voice-reset:2')).toBeTruthy();
  });
});
