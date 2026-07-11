import { spacingTokens } from "@taskforceai/design-tokens";
import {
  FlashList,
  type FlashListRef,
  type ListRenderItemInfo,
} from "@shopify/flash-list";
import {
  sortedCopy,
  type McpRuntimeToolDescriptor,
} from "@taskforceai/client-core";
import { createComputerTheaterPreScreenStatus } from "@taskforceai/presenters";
import type { PropsWithChildren } from "react";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Image,
  Keyboard,
  Platform,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { AutonomousPanel } from "../components/AutonomousPanel";
import { ComputerTheater } from "../components/ComputerTheater";
import { MessageBubble } from "../components/MessageBubble";
import { OrchestrationModal } from "../components/OrchestrationModal";
import { LocalErrorBoundary } from "../components/LocalErrorBoundary";
import { PromptInput } from "../components/PromptInput";
import { RateLimitError } from "../components/RateLimitError";
import { RealtimeVoiceSessionPanel } from "../components/RealtimeVoiceSessionPanel";
import { useModelSelectorQuery } from "../hooks/api/modelSelector";
import {
  useRealtimeVoiceSession,
  type RealtimeVoiceTranscriptMessage,
} from "../hooks/useRealtimeVoiceSession";
import type {
  AgentStatus,
  Message,
  SourceReference,
  ToolUsageEvent,
} from "../types";
import logoTransparent from "../../assets/logo-transparent.png";

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
  keyboardShouldPersistTaps?: "always" | "never" | "handled" | boolean;
  estimatedItemSize?: number;
  removeClippedSubviews?: boolean;
};

const MessageFlashList =
  FlashList as React.ComponentType<MessageFlashListProps>;

const clearTimer = (timer: ReturnType<typeof setTimeout>) => {
  if (typeof globalThis.clearTimeout === "function") {
    globalThis.clearTimeout(timer);
  }
};

const defaultBoolean = (value: boolean | undefined, fallback: boolean): boolean => value ?? fallback;
const REALTIME_VOICE_PREWARM_REFRESH_MS = 20_000;

const keyExtractor = (item: Message) => item.id;

const hasCreatedAt = (
  message: Message,
): message is Message & { createdAt: number } =>
  typeof message.createdAt === "number" && Number.isFinite(message.createdAt);

const toChronologicalMessages = (items: Message[]): Message[] => {
  if (items.length < 2 || !items.every(hasCreatedAt)) {
    return items;
  }

  return sortedCopy(
    items.map((message, index) => ({ message, index })),
    (left, right) => {
      const createdAtDelta = left.message.createdAt - right.message.createdAt;
      return createdAtDelta === 0 ? left.index - right.index : createdAtDelta;
    },
  ).map(({ message }) => message);
};

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
      reasoningEffort?: string;
      quickModeEnabled?: boolean;
      computerUseEnabled?: boolean;
      budget?: number;
      agentCount?: number;
      privateChat?: boolean;
    },
    attachment_ids?: string[],
  ) => Promise<void>;
  onRealtimeTranscriptMessagesChange?: (
    messages: RealtimeVoiceTranscriptMessage[],
  ) => void;
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
  privateChat?: boolean;
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
        backgroundColor: "rgba(239, 68, 68, 0.1)",
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
        String(errorMessage).toLowerCase().includes("rate limit") ||
        String(errorMessage).toLowerCase().includes("message limit") ? (
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
  isSidebarVisible: optionalIsSidebarVisible,
  renderStreamingFooter,
  computerUseEnabled,
  userPlan,
  isAuthenticated: optionalIsAuthenticated,
  privateChat: optionalPrivateChat,
  onLoadMoreMessages,
  hasMoreMessages,
  isLoadingMoreMessages,
}: ChatScreenProps) {
  const isSidebarVisible = defaultBoolean(optionalIsSidebarVisible, false);
  const isAuthenticated = defaultBoolean(optionalIsAuthenticated, true);
  const privateChat = defaultBoolean(optionalPrivateChat, false);
  const messageListRef = useRef<FlashListRef<Message> | null>(null);
  const [isOrchestrationModalOpen, setIsOrchestrationModalOpen] =
    useState(false);
  const [quickModeEnabled, setQuickModeEnabled] = useState(true);
  const [autonomousModeEnabled, setAutonomousModeEnabled] = useState(false);
  const [computerUseModeEnabled, setComputerUseModeEnabled] = useState(false);
  const [roleModels, setRoleModels] = useState<Record<string, string>>({});
  const [orchestrationBudget, setOrchestrationBudget] = useState<
    number | undefined
  >(undefined);
  const [agentCount, setAgentCount] = useState<number>(4);
  const [isAutonomousPanelOpen, setIsAutonomousPanelOpen] = useState(false);
  const { data: modelSelectorData } = useModelSelectorQuery();
  const realtimeVoice = useRealtimeVoiceSession();
  const {
    connect: connectRealtimeVoice,
    disconnect: disconnectRealtimeVoice,
    endedDurationMs: realtimeVoiceEndedDurationMs,
    errorMessage: realtimeVoiceErrorMessage,
    isActive: realtimeVoiceIsActive,
    isCapturing: realtimeVoiceIsCapturing,
    isPlaying: realtimeVoiceIsPlaying,
    messages: realtimeVoiceMessages,
    prewarm: prewarmRealtimeVoice,
    resetSession: resetRealtimeVoiceSession,
    status: realtimeVoiceStatus,
  } = realtimeVoice;
  const hasMountedRealtimeResetRef = useRef(false);
  const realtimeVoiceResetSessionRef = useRef(resetRealtimeVoiceSession);

  useEffect(() => {
    if (!isAuthenticated || privateChat) {
      return;
    }
    prewarmRealtimeVoice();
    const prewarmInterval = setInterval(() => {
      prewarmRealtimeVoice();
    }, REALTIME_VOICE_PREWARM_REFRESH_MS);
    return () => {
      clearInterval(prewarmInterval);
    };
  }, [isAuthenticated, privateChat, prewarmRealtimeVoice]);

  useEffect(() => {
    if (!privateChat || !realtimeVoiceIsActive) {
      return;
    }
    disconnectRealtimeVoice();
  }, [disconnectRealtimeVoice, privateChat, realtimeVoiceIsActive]);

  useEffect(() => {
    realtimeVoiceResetSessionRef.current = resetRealtimeVoiceSession;
  }, [resetRealtimeVoiceSession]);

  useEffect(() => {
    if (!hasMountedRealtimeResetRef.current) {
      hasMountedRealtimeResetRef.current = true;
      return;
    }
    realtimeVoiceResetSessionRef.current();
  }, [realtimeVoiceResetKey]);

  useEffect(() => {
    onRealtimeTranscriptMessagesChange?.(realtimeVoiceMessages);
  }, [onRealtimeTranscriptMessagesChange, realtimeVoiceMessages]);

  const messageIds = useMemo(
    () => new Set(messages.map((message) => message.id)),
    [messages],
  );
  const realtimeTranscriptMessages = useMemo<Message[]>(
    () =>
      realtimeVoiceMessages
        .map((message) => ({
          id: `realtime-voice-${message.id}`,
          role: message.role,
          content: message.text,
        }))
        .filter((message) => !messageIds.has(message.id)),
    [messageIds, realtimeVoiceMessages],
  );
  const visibleMessages = useMemo(
    () => toChronologicalMessages([...messages, ...realtimeTranscriptMessages]),
    [messages, realtimeTranscriptMessages],
  );
  const realtimeTranscriptKey = useMemo(
    () =>
      realtimeVoiceMessages
        .map(
          (message) => `${message.id}:${message.role}:${message.text.length}`,
        )
        .join("|"),
    [realtimeVoiceMessages],
  );
  const invertedMessages = useMemo(() => {
    // FlashList's inverted transform reverses visual order, so feed it
    // newest-first while keeping shared message state chronological.
    return toNewestFirst(visibleMessages);
  }, [visibleMessages]);
  const activeProgressKey = `${visibleMessages.length}:${agentStatuses.length}:${toolEvents.length}:${elapsedSeconds}:${realtimeTranscriptKey}`;
  const previousMessageCountRef = useRef(visibleMessages.length);
  const renderMessageItem = useCallback(
    ({ item }: ListRenderItemInfo<Message>) => (
      <LocalErrorBoundary
        contextId={item.id}
        fallbackMessage="Failed to render message."
      >
        <MessageBubble message={item} privateChat={privateChat} />
      </LocalErrorBoundary>
    ),
    [privateChat],
  );

  useEffect(() => {
    const previousMessageCount = previousMessageCountRef.current;
    previousMessageCountRef.current = visibleMessages.length;

    if (
      visibleMessages.length === 0 ||
      visibleMessages.length <= previousMessageCount
    ) {
      return;
    }

    const timer = setTimeout(() => {
      messageListRef.current?.scrollToOffset?.({ offset: 0, animated: true });
    }, 80);

    return () => clearTimer(timer);
  }, [visibleMessages.length]);

  useEffect(() => {
    if (
      (!isStreaming && !realtimeVoiceIsActive) ||
      visibleMessages.length === 0
    ) {
      return;
    }

    const timer = setTimeout(() => {
      messageListRef.current?.scrollToOffset?.({ offset: 0, animated: true });
    }, 80);

    return () => clearTimer(timer);
  }, [
    activeProgressKey,
    isStreaming,
    realtimeVoiceIsActive,
    visibleMessages.length,
  ]);

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
        (realtimeVoiceStatus === "error" ? realtimeVoiceErrorMessage : null),
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
    realtimeVoiceErrorMessage,
    realtimeVoiceStatus,
    rateLimitResetTime,
    onClearError,
    modelLabel,
    renderStreamingFooter,
  ]);

  const shouldShowRealtimeVoicePanel =
    !privateChat &&
    (realtimeVoiceIsActive || realtimeVoiceEndedDurationMs !== null);
  const shouldShowEmptyLogo =
    visibleMessages.length === 0 &&
    !shouldShowRealtimeVoicePanel &&
    realtimeVoiceStatus !== "error";

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
              renderItem={renderMessageItem}
              onEndReached={
                hasMoreMessages && !isLoadingMoreMessages
                  ? onLoadMoreMessages
                  : undefined
              }
              onEndReachedThreshold={0.5}
              contentContainerStyle={{ paddingVertical: spacingTokens.md }}
              ListHeaderComponent={
                streamingFooterComponent ? (
                  <View>{streamingFooterComponent}</View>
                ) : null
              }
              ListFooterComponent={
                isLoadingMoreMessages ? (
                  <View style={{ padding: 16, alignItems: "center" }}>
                    <Text
                      style={{ color: "rgba(148,163,184,0.6)", fontSize: 12 }}
                    >
                      Loading older messages...
                    </Text>
                  </View>
                ) : null
              }
              keyboardShouldPersistTaps="handled"
              estimatedItemSize={120}
              removeClippedSubviews={Platform.OS === "android"}
            />
          </View>
        )}

        {shouldShowRealtimeVoicePanel && (
          <View testID="realtime-voice-dock" style={styles.realtimeVoiceDock}>
            <RealtimeVoiceSessionPanel
              endedDurationMs={realtimeVoiceEndedDurationMs}
              isActive={realtimeVoiceIsActive}
              isCapturing={realtimeVoiceIsCapturing}
              isPlaying={realtimeVoiceIsPlaying}
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
          if (privateChat) {
            return;
          }
          const shouldStartConversation = !realtimeVoiceIsActive;
          void connectRealtimeVoice();
          if (shouldStartConversation) {
            void Promise.resolve()
              .then(() => onRealtimeVoiceStart?.())
              .catch(() => undefined);
          }
        }}
        realtimeVoiceActive={realtimeVoiceIsActive}
        realtimeVoiceDisabled={
          isStreaming || isSidebarVisible || !isAuthenticated || privateChat
        }
        privateChat={privateChat}
        onCustomizeOrchestration={() => setIsOrchestrationModalOpen(true)}
        onOpenBudgetPanel={() => setIsAutonomousPanelOpen(true)}
        quickModeEnabled={quickModeEnabled}
        onQuickModeToggle={() => setQuickModeEnabled((enabled) => !enabled)}
        autonomousModeEnabled={autonomousModeEnabled}
        onAutonomousModeToggle={() =>
          setAutonomousModeEnabled((enabled) => !enabled)
        }
        computerUseEnabled={computerUseModeEnabled}
        onComputerUseToggle={() =>
          setComputerUseModeEnabled((enabled) => !enabled)
        }
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
