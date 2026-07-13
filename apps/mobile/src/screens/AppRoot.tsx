import { Fragment, useCallback, useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Header } from '../components/Header';
import type { MobileTaskMode } from '../components/MobileTaskModeSwitcher';
import { useAuth } from '../contexts/AuthContext';
import { PendingPrompts } from '../components/PendingPrompts';
import { Sidebar } from '../components/Sidebar';
import { useTheme } from '../contexts/ThemeContext';
import { styled } from '../utils/nativewind';
import { ArtifactsScreen } from './ArtifactsScreen';
import { ChatScreen } from './ChatScreen';
import { DesktopWorkScreen } from './DesktopWorkScreen';
import { FinanceScreen } from './FinanceScreen';
import { SettingsScreen } from './SettingsScreen';
import { ScheduledScreen } from './ScheduledScreen';
import { mobileEnv } from '../config/env';
import { useChatCoordinator } from '../hooks/useChatCoordinator';
import { isDesktopPairingDeepLink } from '../desktop-pairing/deep-link';
import { getInitialUrl, subscribeUrlEvents } from '../desktop-pairing/linking';
import { useRemoteNotificationRouting } from '../notifications/remote-routing';
import type { Message } from '../types';

const StyledSafeAreaView = styled(SafeAreaView);
const isChatOrderFixtureEnabled = mobileEnv.flags.chatOrderFixture;
const chatOrderFixtureMessages: Message[] = [
  { id: 'e2e-user-message', role: 'user', content: 'E2E User Question' },
  { id: 'e2e-reply-message', role: 'assistant', content: 'E2E Agent Reply' },
];

export function AppRoot() {
  const { isDarkMode } = useTheme();
  const [isSettingsVisible, setIsSettingsVisible] = useState(false);
  const [isDesktopWorkVisible, setIsDesktopWorkVisible] = useState(false);
  const [isArtifactsVisible, setIsArtifactsVisible] = useState(false);
  const [isFinanceVisible, setIsFinanceVisible] = useState(false);
  const [isScheduledVisible, setIsScheduledVisible] = useState(false);
  const [desktopPairingPayload, setDesktopPairingPayload] = useState<string | null>(null);
  const [remoteThreadId, setRemoteThreadId] = useState<string | null>(null);
  const { user } = useAuth();

  const {
    isAuthenticated,
    isPrivateChat,
    isPrivateChatToggleDisabled,
    shouldRenderPrivateChatToggle,
    handleTogglePrivateChat,
    handleExitPrivateChat,
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
    handleRealtimeTranscriptMessagesChange,
    handleRealtimeVoiceStart,
  } = useChatCoordinator();
  const [realtimeVoiceResetKey, setRealtimeVoiceResetKey] = useState(0);
  const [taskMode, setTaskMode] = useState<MobileTaskMode>('chat');
  const isChatMode = taskMode === 'chat';

  const handleTaskModeChange = useCallback(
    (nextTaskMode: MobileTaskMode) => {
      if (nextTaskMode === 'work') {
        handleExitPrivateChat();
      }
      setTaskMode(nextTaskMode);
    },
    [handleExitPrivateChat]
  );

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

  const handleOpenRemoteThread = useCallback(
    (threadId: string) => {
      handleCloseSidebar();
      setRemoteThreadId(threadId);
      setIsDesktopWorkVisible(true);
    },
    [handleCloseSidebar]
  );

  useRemoteNotificationRouting(handleOpenRemoteThread);

  const handleOpenArtifacts = () => {
    handleCloseSidebar();
    setIsArtifactsVisible(true);
  };

  const handleOpenFinance = () => {
    handleCloseSidebar();
    setIsFinanceVisible(true);
  };

  const handleOpenScheduled = () => {
    handleCloseSidebar();
    globalThis.setTimeout(() => setIsScheduledVisible(true), 0);
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

  const handleRootNewChat = useCallback(() => {
    setRealtimeVoiceResetKey((key) => key + 1);
    void handleNewChat();
  }, [handleNewChat]);

  const handleRootConversationSelect = useCallback(
    (summary: Parameters<typeof handleConversationSelect>[0]) => {
      setRealtimeVoiceResetKey((key) => key + 1);
      void handleConversationSelect(summary);
    },
    [handleConversationSelect]
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
    <Fragment>
      <StyledSafeAreaView className="flex-1 bg-background">
        <StatusBar style={isDarkMode ? 'light' : 'dark'} />
        <Header
        onMenuPress={handleOpenSidebar}
        onNewChatPress={handleRootNewChat}
        isAuthenticated={isAuthenticated}
        onLoginPress={handleLogin}
        hasMessages={hasMessages}
        isPrivateChat={isPrivateChat}
        isPrivateChatToggleDisabled={isPrivateChatToggleDisabled}
        shouldRenderPrivateChatToggle={isChatMode && shouldRenderPrivateChatToggle}
        onPrivateChatToggle={handleTogglePrivateChat}
        taskMode={taskMode}
        onTaskModeChange={handleTaskModeChange}
      />
      {!isPrivateChat ? <PendingPrompts /> : null}
      <Sidebar
        visible={isSidebarVisible}
        onClose={handleCloseSidebar}
        onNewChat={handleRootNewChat}
        onConversationSelect={handleRootConversationSelect}
        isAuthenticated={isAuthenticated}
        onSettingsPress={handleOpenSettings}
        onDesktopSessionsPress={handleOpenDesktopSessions}
        onArtifactsPress={handleOpenArtifacts}
        onFinancePress={handleOpenFinance}
        onScheduledPress={handleOpenScheduled}
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
        onRealtimeTranscriptMessagesChange={handleRealtimeTranscriptMessagesChange}
        onRealtimeVoiceStart={handleRealtimeVoiceStart}
        realtimeVoiceResetKey={realtimeVoiceResetKey}
        modelLabel={modelLabel}
        mcpToolSummary={mcpToolSummary}
        mcpToolItems={mcpToolItems}
        isSidebarVisible={isSidebarVisible}
        computerUseEnabled={computerUseEnabled}
        userPlan={user?.plan}
        isAuthenticated={isAuthenticated}
        privateChat={isPrivateChat}
        taskMode={taskMode}
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
        <DesktopWorkScreen
          visible={isDesktopWorkVisible}
          initialThreadId={remoteThreadId}
          onClose={() => {
            setIsDesktopWorkVisible(false);
            setRemoteThreadId(null);
          }}
        />
        <ArtifactsScreen visible={isArtifactsVisible} onClose={() => setIsArtifactsVisible(false)} />
        <FinanceScreen visible={isFinanceVisible} onClose={() => setIsFinanceVisible(false)} />
      </StyledSafeAreaView>
      <ScheduledScreen visible={isScheduledVisible} onClose={() => setIsScheduledVisible(false)} />
    </Fragment>
  );
}
