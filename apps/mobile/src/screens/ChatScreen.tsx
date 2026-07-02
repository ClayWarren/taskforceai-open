import { spacingTokens } from '@taskforceai/design-tokens';
import { FlashList, type FlashListRef, type ListRenderItemInfo } from '@shopify/flash-list';
import {
  createComputerTheaterPreScreenStatus,
  type McpRuntimeToolDescriptor,
} from '@taskforceai/shared';
import type { PropsWithChildren } from 'react';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Image, Keyboard, Platform, StyleSheet, Text, View } from 'react-native';

import { AutonomousPanel } from '../components/AutonomousPanel';
import { ComputerTheater } from '../components/ComputerTheater';
import { MessageBubble } from '../components/MessageBubble';
import { OrchestrationModal } from '../components/OrchestrationModal';
import { LocalErrorBoundary } from '../components/LocalErrorBoundary';
import { PromptInput } from '../components/PromptInput';
import { RateLimitError } from '../components/RateLimitError';
import { RealtimeVoiceSessionPanel } from '../components/RealtimeVoiceSessionPanel';
import { useModelSelectorQuery } from '../hooks/api/modelSelector';
import {
  useRealtimeVoiceSession,
  type RealtimeVoiceTranscriptMessage,
} from '../hooks/useRealtimeVoiceSession';
import type { AgentStatus, Message, SourceReference, ToolUsageEvent } from '../types';
import logoTransparent from '../../assets/logo-transparent.png';

type MessageFlashListProps = {
  ref?: React.Ref<FlashListRef<Message>>;
  inverted?: boolean;
  data: readonly Message[];
  keyExtractor: (item: Message) => string;
  renderItem: (info: ListRenderItemInfo<Message>) => React.ReactElement | null;
  onEndReached?: () => void;
  onEndReachedThreshold?: number;
  contentContainerStyle?: { paddingVertical?: number };
  ListHeaderComponent?: React.ReactElement | null;
  ListFooterComponent?: React.ReactElement | null;
  keyboardShouldPersistTaps?: 'always' | 'never' | 'handled' | boolean;
  estimatedItemSize?: number;
  removeClippedSubviews?: boolean;
};

const MessageFlashList = FlashList as React.ComponentType<MessageFlashListProps>;

const clearTimer = (timer: ReturnType<typeof setTimeout>) => {
  if (typeof globalThis.clearTimeout === 'function') {
    globalThis.clearTimeout(timer);
  }
};
const REALTIME_VOICE_PREWARM_REFRESH_MS = 20_000;

const renderItem = ({ item }: ListRenderItemInfo<Message>) => (
  <LocalErrorBoundary
    contextId={item.id}
    fallbackMessage="Failed to render message."
  >
    <MessageBubble message={item} />
  </LocalErrorBoundary>
);
const keyExtractor = (item: Message) => item.id;

const toNewestFirst = (items: Message[]): Message[] => {
  const ordered: Message[] = Array.from({ length: items.length });
  for (
    let sourceIndex = items.length - 1, targetIndex = 0;
    sourceIndex >= 0;
    sourceIndex--, targetIndex++
  ) {
    ordered[targetIndex] = items[sourceIndex];
  }
  return ordered;
};

interface ChatScreenProps {
  messages: Message[];
  isStreaming: boolean;
  streamContent: string;
  agentStatuses: AgentStatus[];
  elapsedSeconds: number;
  sources: SourceReference[];
  toolEvents: ToolUsageEvent[];
  errorMessage: string | null;
  rateLimitResetTime: string | null;
  onClearError: () => void;
  onSendMessage: (
    content: string,
    metadata?: {
      modelId?: string;
      quickModeEnabled?: boolean;
      computerUseEnabled?: boolean;
      budget?: number;
      agentCount?: number;
    },
    attachment_ids?: string[]
  ) => Promise<void>;
  onRealtimeTranscriptMessagesChange?: (messages: RealtimeVoiceTranscriptMessage[]) => void;
  onRealtimeVoiceStart?: () => Promise<void> | void;
  realtimeVoiceResetKey?: unknown;
  modelLabel: string | null;
  mcpToolSummary?: string | null;
  mcpToolItems?: McpRuntimeToolDescriptor[];
  isSidebarVisible?: boolean;
  renderStreamingFooter?: (props: StreamingFooterProps) => React.ReactNode;
  computerUseEnabled?: boolean;
  userPlan?: string | null;
  isAuthenticated?: boolean;
  onLoadMoreMessages?: () => void;
  hasMoreMessages?: boolean;
  isLoadingMoreMessages?: boolean;
}

export interface StreamingFooterProps {
  isStreaming: boolean;
  streamContent: string;
  agentStatuses: AgentStatus[];
  elapsedSeconds: number;
  sources: SourceReference[];
  toolEvents: ToolUsageEvent[];
  errorMessage: string | null;
  rateLimitResetTime: string | null;
  onClearError: () => void;
  modelLabel: string | null;
}

function ErrorContainer({ children }: PropsWithChildren) {
  return (
    <View
      className="mx-md mb-md rounded-2xl"
      style={{
        paddingHorizontal: spacingTokens.md,
        paddingVertical: spacingTokens.md,
        backgroundColor: 'rgba(239, 68, 68, 0.1)',
      }}
    >
      {children}
    </View>
  );
}

function ErrorText({ children }: PropsWithChildren) {
  return <Text className="text-error text-sm">{children}</Text>;
}

function DefaultStreamingFooter({
  errorMessage,
  rateLimitResetTime,
  onClearError,
}: StreamingFooterProps) {
  if (!errorMessage) {
    return null;
  }

  return (
    <>
      {errorMessage &&
        (rateLimitResetTime ||
          String(errorMessage).toLowerCase().includes('rate limit') ||
          String(errorMessage).toLowerCase().includes('message limit') ? (
          <RateLimitError
            message={String(errorMessage)}
            {...(rateLimitResetTime ? { resetTime: rateLimitResetTime } : {})}
            onDismiss={onClearError}
          />
        ) : (
          <ErrorContainer>
            <ErrorText>{String(errorMessage)}</ErrorText>
          </ErrorContainer>
        ))}
    </>
  );
}

export function ChatScreen({
  messages,
  isStreaming,
  streamContent,
  agentStatuses,
  elapsedSeconds,
  sources,
  toolEvents,
  errorMessage,
  rateLimitResetTime,
  onClearError,
  onSendMessage,
  onRealtimeTranscriptMessagesChange,
  onRealtimeVoiceStart,
  realtimeVoiceResetKey,
  modelLabel,
  mcpToolSummary,
  mcpToolItems,
  isSidebarVisible = false,
  renderStreamingFooter,
  computerUseEnabled,
  userPlan,
  isAuthenticated = true,
  onLoadMoreMessages,
  hasMoreMessages,
  isLoadingMoreMessages,
}: ChatScreenProps) {
  const messageListRef = useRef<FlashListRef<Message> | null>(null);
  const [isOrchestrationModalOpen, setIsOrchestrationModalOpen] = useState(false);
  const [quickModeEnabled, setQuickModeEnabled] = useState(true);
  const [autonomousModeEnabled, setAutonomousModeEnabled] = useState(false);
  const [computerUseModeEnabled, setComputerUseModeEnabled] = useState(false);
  const [roleModels, setRoleModels] = useState<Record<string, string>>({});
  const [orchestrationBudget, setOrchestrationBudget] = useState<number | undefined>(undefined);
  const [agentCount, setAgentCount] = useState<number>(4);
  const [isAutonomousPanelOpen, setIsAutonomousPanelOpen] = useState(false);
  const { data: modelSelectorData } = useModelSelectorQuery();
  const realtimeVoice = useRealtimeVoiceSession();
  const hasMountedRealtimeResetRef = useRef(false);
  const realtimeVoiceResetSessionRef = useRef(realtimeVoice.resetSession);

  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }
    realtimeVoice.prewarm();
    const prewarmInterval = setInterval(() => {
      realtimeVoice.prewarm();
    }, REALTIME_VOICE_PREWARM_REFRESH_MS);
    return () => {
      clearInterval(prewarmInterval);
    };
  }, [isAuthenticated, realtimeVoice.prewarm]);

  useEffect(() => {
    realtimeVoiceResetSessionRef.current = realtimeVoice.resetSession;
  }, [realtimeVoice.resetSession]);

  useEffect(() => {
    if (!hasMountedRealtimeResetRef.current) {
      hasMountedRealtimeResetRef.current = true;
      return;
    }
    realtimeVoiceResetSessionRef.current();
  }, [realtimeVoiceResetKey]);

  useEffect(() => {
    onRealtimeTranscriptMessagesChange?.(realtimeVoice.messages);
  }, [onRealtimeTranscriptMessagesChange, realtimeVoice.messages]);

  const messageIds = useMemo(() => new Set(messages.map((message) => message.id)), [messages]);
  const realtimeTranscriptMessages = useMemo<Message[]>(
    () =>
      realtimeVoice.messages
        .map((message) => ({
          id: `realtime-voice-${message.id}`,
          role: message.role,
          content: message.text,
        }))
        .filter((message) => !messageIds.has(message.id)),
    [messageIds, realtimeVoice.messages]
  );
  const visibleMessages = useMemo(
    () => [...messages, ...realtimeTranscriptMessages],
    [messages, realtimeTranscriptMessages]
  );
  const realtimeTranscriptKey = useMemo(
    () =>
      realtimeVoice.messages
        .map((message) => `${message.id}:${message.role}:${message.text.length}`)
        .join('|'),
    [realtimeVoice.messages]
  );
  const invertedMessages = useMemo(() => {
    // FlashList's inverted transform reverses visual order, so feed it
    // newest-first while keeping shared message state chronological.
    return toNewestFirst(visibleMessages);
  }, [visibleMessages]);
  const activeProgressKey = `${visibleMessages.length}:${agentStatuses.length}:${toolEvents.length}:${elapsedSeconds}:${realtimeTranscriptKey}`;
  const previousMessageCountRef = useRef(visibleMessages.length);

  useEffect(() => {
    const previousMessageCount = previousMessageCountRef.current;
    previousMessageCountRef.current = visibleMessages.length;

    if (visibleMessages.length === 0 || visibleMessages.length <= previousMessageCount) {
      return;
    }

    const timer = setTimeout(() => {
      messageListRef.current?.scrollToOffset?.({ offset: 0, animated: true });
    }, 80);

    return () => clearTimer(timer);
  }, [visibleMessages.length]);

  useEffect(() => {
    if ((!isStreaming && !realtimeVoice.isActive) || visibleMessages.length === 0) {
      return;
    }

    const timer = setTimeout(() => {
      messageListRef.current?.scrollToOffset?.({ offset: 0, animated: true });
    }, 80);

    return () => clearTimer(timer);
  }, [activeProgressKey, isStreaming, realtimeVoice.isActive, visibleMessages.length]);

  const streamingFooterComponent = useMemo(() => {
    const footerProps: StreamingFooterProps = {
      isStreaming,
      streamContent,
      agentStatuses,
      elapsedSeconds,
      sources,
      toolEvents,
      errorMessage:
        errorMessage ??
        (realtimeVoice.status === 'error' ? realtimeVoice.errorMessage : null),
      rateLimitResetTime,
      onClearError,
      modelLabel,
    };

    return renderStreamingFooter ? (
      renderStreamingFooter(footerProps)
    ) : (
      <DefaultStreamingFooter {...footerProps} />
    );
  }, [
    isStreaming,
    streamContent,
    agentStatuses,
    elapsedSeconds,
    sources,
    toolEvents,
    errorMessage,
    realtimeVoice.endedDurationMs,
    realtimeVoice.errorMessage,
    realtimeVoice.isActive,
    realtimeVoice.isCapturing,
    realtimeVoice.isPlaying,
    realtimeVoice.status,
    rateLimitResetTime,
    onClearError,
    modelLabel,
    renderStreamingFooter,
  ]);

  const shouldShowRealtimeVoicePanel =
    realtimeVoice.isActive || realtimeVoice.endedDurationMs !== null;
  const shouldShowEmptyLogo =
    visibleMessages.length === 0 &&
    !shouldShowRealtimeVoicePanel &&
    realtimeVoice.status !== 'error';

  useEffect(() => {
    if (shouldShowRealtimeVoicePanel) {
      Keyboard.dismiss();
    }
  }, [shouldShowRealtimeVoicePanel]);

  return (
    <View className="flex-1 bg-background">
      {computerUseEnabled && (
        <ComputerTheater
          toolEvents={toolEvents}
          isStreaming={isStreaming}
          autoExpand={true}
          showWhenEmpty={isStreaming}
          preScreenStatus={createComputerTheaterPreScreenStatus(agentStatuses)}
        />
      )}
      <View style={styles.chatSurface}>
        {shouldShowEmptyLogo ? (
          <View className="px-xl flex-1 items-center justify-center">
            <Image
              source={logoTransparent}
              accessibilityIgnoresInvertColors
              accessible
              accessibilityRole="image"
              accessibilityLabel="TaskForceAI logo"
              accessibilityHint="Brand logo for TaskForceAI"
              style={{ width: 132, height: 132, borderRadius: 32 }}
            />
          </View>
        ) : (
          <View testID="chat-message-region" style={styles.messageRegion}>
            <MessageFlashList
              ref={messageListRef}
              inverted
              data={invertedMessages}
              keyExtractor={keyExtractor}
              renderItem={renderItem}
              onEndReached={
                hasMoreMessages && !isLoadingMoreMessages ? onLoadMoreMessages : undefined
              }
              onEndReachedThreshold={0.5}
              contentContainerStyle={{ paddingVertical: spacingTokens.md }}
              ListHeaderComponent={
                streamingFooterComponent ? <View>{streamingFooterComponent}</View> : null
              }
              ListFooterComponent={
                isLoadingMoreMessages ? (
                  <View style={{ padding: 16, alignItems: 'center' }}>
                    <Text style={{ color: 'rgba(148,163,184,0.6)', fontSize: 12 }}>
                      Loading older messages...
                    </Text>
                  </View>
                ) : null
              }
              keyboardShouldPersistTaps="handled"
              estimatedItemSize={120}
              removeClippedSubviews={Platform.OS === 'android'}
            />
          </View>
        )}

        {shouldShowRealtimeVoicePanel && (
          <View testID="realtime-voice-dock" style={styles.realtimeVoiceDock}>
            <RealtimeVoiceSessionPanel
              endedDurationMs={realtimeVoice.endedDurationMs}
              isActive={realtimeVoice.isActive}
              isCapturing={realtimeVoice.isCapturing}
              isPlaying={realtimeVoice.isPlaying}
            />
          </View>
        )}
      </View>

      <PromptInput
        onSend={onSendMessage}
        isDisabled={isStreaming || isSidebarVisible}
        mcpToolSummary={mcpToolSummary}
        mcpToolItems={mcpToolItems}
        onRealtimeVoice={() => {
          const shouldStartConversation = !realtimeVoice.isActive;
          void realtimeVoice.connect();
          if (shouldStartConversation) {
            void Promise.resolve()
              .then(() => onRealtimeVoiceStart?.())
              .catch(() => undefined);
          }
        }}
        realtimeVoiceActive={realtimeVoice.isActive}
        realtimeVoiceDisabled={isStreaming || isSidebarVisible || !isAuthenticated}
        onCustomizeOrchestration={() => setIsOrchestrationModalOpen(true)}
        onOpenBudgetPanel={() => setIsAutonomousPanelOpen(true)}
        quickModeEnabled={quickModeEnabled}
        onQuickModeToggle={() => setQuickModeEnabled((enabled) => !enabled)}
        autonomousModeEnabled={autonomousModeEnabled}
        onAutonomousModeToggle={() => setAutonomousModeEnabled((enabled) => !enabled)}
        computerUseEnabled={computerUseModeEnabled}
        onComputerUseToggle={() => setComputerUseModeEnabled((enabled) => !enabled)}
        autonomyEnabled={false}
        roleModels={roleModels}
        onRoleModelChange={(role, modelId) => {
          setRoleModels((prev) => ({ ...prev, [role]: modelId }));
        }}
        budget={orchestrationBudget}
        onBudgetChange={setOrchestrationBudget}
        userPlan={userPlan}
        isAuthenticated={isAuthenticated}
        agentCount={agentCount}
        onAgentCountChange={setAgentCount}
      />

      <AutonomousPanel
        visible={isAutonomousPanelOpen}
        onClose={() => setIsAutonomousPanelOpen(false)}
        budget={orchestrationBudget}
        onBudgetChange={setOrchestrationBudget}
        isStreaming={isStreaming}
      />

      <OrchestrationModal
        visible={isOrchestrationModalOpen}
        onClose={() => setIsOrchestrationModalOpen(false)}
        models={modelSelectorData?.options ?? []}
        roleModels={roleModels}
        onRoleModelChange={(role, modelId) => {
          setRoleModels((prev) => ({ ...prev, [role]: modelId }));
        }}
        budget={orchestrationBudget}
        onBudgetChange={setOrchestrationBudget}
        autonomyEnabled={false}
        defaultModelId={modelSelectorData?.defaultModelId ?? null}
        defaultModelLabel={modelLabel}
        userPlan={userPlan}
        agentCount={agentCount}
        onAgentCountChange={setAgentCount}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  chatSurface: {
    flex: 1,
    minHeight: 0,
  },
  messageRegion: {
    flex: 1,
    minHeight: 0,
  },
  realtimeVoiceDock: {
    flexShrink: 0,
  },
});
