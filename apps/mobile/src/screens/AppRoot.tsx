import { useCallback, useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Header } from '../components/Header';
import { useAuth } from '../contexts/AuthContext';
import { PendingPrompts } from '../components/PendingPrompts';
import { Sidebar } from '../components/Sidebar';
import { useTheme } from '../contexts/ThemeContext';
import { styled } from '../utils/nativewind';
import { ChatScreen } from './ChatScreen';
import { DesktopWorkScreen } from './DesktopWorkScreen';
import { SettingsScreen } from './SettingsScreen';
import { useChatCoordinator } from '../hooks/useChatCoordinator';
import { isDesktopPairingDeepLink } from '../desktop-pairing/deep-link';
import { getInitialUrl, subscribeUrlEvents } from '../desktop-pairing/linking';
import type { Message } from '../types';

const StyledSafeAreaView = styled(SafeAreaView);
const isChatOrderFixtureEnabled = (() => {
  try {
    return (
      typeof process !== 'undefined' &&
      process.env.EXPO_PUBLIC_E2E_CHAT_ORDER_FIXTURE === 'true'
    );
  } catch {
    return false;
  }
})();
const chatOrderFixtureMessages: Message[] = [
  { id: 'e2e-user-message', role: 'user', content: 'E2E User Question' },
  { id: 'e2e-reply-message', role: 'assistant', content: 'E2E Agent Reply' },
];

export function AppRoot() {
  const { isDarkMode } = useTheme();
  const [isSettingsVisible, setIsSettingsVisible] = useState(false);
  const [isDesktopWorkVisible, setIsDesktopWorkVisible] = useState(false);
  const [desktopPairingPayload, setDesktopPairingPayload] = useState<string | null>(null);
  const { user } = useAuth();

  const {
    isAuthenticated,
    isSidebarVisible,
    handleOpenSidebar,
    handleCloseSidebar,
    conversation,
    streamingContext,
    handleSendMessage,
    handleNewChat,
    handleConversationSelect,
    handleLogin,
    handleClearCache,
    computerUseEnabled,
    mcpToolSummary,
    mcpToolItems,
  } = useChatCoordinator();

  const {
    isStreaming,
    streamContent,
    agentStatuses,
    elapsedSeconds,
    sources,
    toolEvents,
    modelLabel,
    errorMessage,
    rateLimitResetTime,
    clearErrorMessage,
  } = streamingContext;

  const hasMessages = conversation.messages.length > 0;

  const handleOpenSettings = () => {
    handleCloseSidebar();
    setDesktopPairingPayload(null);
    setIsSettingsVisible(true);
  };

  const handleOpenDesktopSessions = () => {
    handleCloseSidebar();
    setIsDesktopWorkVisible(true);
  };

  const handleDesktopPairingLink = useCallback(
    (url: string) => {
      if (!isDesktopPairingDeepLink(url)) {
        return;
      }
      handleCloseSidebar();
      setDesktopPairingPayload(url);
      setIsSettingsVisible(true);
    },
    [handleCloseSidebar]
  );

  useEffect(() => {
    let active = true;
    void getInitialUrl()
      .then((url) => {
        if (active && url) {
          handleDesktopPairingLink(url);
        }
      })
      .catch(() => undefined);

    const subscription = subscribeUrlEvents((event) => {
      handleDesktopPairingLink(event.url);
    });

    return () => {
      active = false;
      subscription.remove();
    };
  }, [handleDesktopPairingLink]);

  if (isChatOrderFixtureEnabled) {
    return (
      <StyledSafeAreaView className="flex-1 bg-background">
        <StatusBar style={isDarkMode ? 'light' : 'dark'} />
        <ChatScreen
          messages={chatOrderFixtureMessages}
          isStreaming={false}
          streamContent=""
          agentStatuses={[]}
          elapsedSeconds={0}
          sources={[]}
          toolEvents={[]}
          errorMessage={null}
          rateLimitResetTime={null}
          onClearError={() => undefined}
          onSendMessage={async () => undefined}
          modelLabel={null}
        />
      </StyledSafeAreaView>
    );
  }

  return (
    <StyledSafeAreaView className="flex-1 bg-background">
      <StatusBar style={isDarkMode ? 'light' : 'dark'} />
      <Header
        onMenuPress={handleOpenSidebar}
        onNewChatPress={() => void handleNewChat()}
        isAuthenticated={isAuthenticated}
        onLoginPress={handleLogin}
        hasMessages={hasMessages}
      />
      <PendingPrompts />
      <Sidebar
        visible={isSidebarVisible}
        onClose={handleCloseSidebar}
        onNewChat={() => void handleNewChat()}
        onConversationSelect={(summary) => void handleConversationSelect(summary)}
        isAuthenticated={isAuthenticated}
        onSettingsPress={handleOpenSettings}
        onDesktopSessionsPress={handleOpenDesktopSessions}
      />
      <ChatScreen
        messages={conversation.messages}
        isStreaming={isStreaming}
        streamContent={streamContent}
        agentStatuses={agentStatuses}
        elapsedSeconds={elapsedSeconds}
        sources={sources}
        toolEvents={toolEvents}
        errorMessage={errorMessage}
        rateLimitResetTime={rateLimitResetTime}
        onClearError={clearErrorMessage}
        onSendMessage={handleSendMessage}
        modelLabel={modelLabel}
        mcpToolSummary={mcpToolSummary}
        mcpToolItems={mcpToolItems}
        isSidebarVisible={isSidebarVisible}
        computerUseEnabled={computerUseEnabled}
        userPlan={user?.plan}
        isAuthenticated={isAuthenticated}
        onLoadMoreMessages={() => void conversation.loadMoreMessages()}
        hasMoreMessages={conversation.hasMoreMessages}
        isLoadingMoreMessages={conversation.isLoadingMore}
      />
      <SettingsScreen
        visible={isSettingsVisible}
        onClose={() => {
          setIsSettingsVisible(false);
          setDesktopPairingPayload(null);
        }}
        onClearCache={handleClearCache}
        desktopPairingPayload={desktopPairingPayload}
      />
      <DesktopWorkScreen visible={isDesktopWorkVisible} onClose={() => setIsDesktopWorkVisible(false)} />
    </StyledSafeAreaView>
  );
}
