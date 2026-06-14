import { spacingTokens } from '@taskforceai/design-tokens';
import { FlashList, type FlashListRef, type ListRenderItemInfo } from '@shopify/flash-list';
import {
  createComputerTheaterPreScreenStatus,
  type McpRuntimeToolDescriptor,
} from '@taskforceai/shared';
import type { PropsWithChildren } from 'react';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Image, Platform, Text, View } from 'react-native';

import { AutonomousPanel } from '../components/AutonomousPanel';
import { ComputerTheater } from '../components/ComputerTheater';
import { MessageBubble } from '../components/MessageBubble';
import { OrchestrationModal } from '../components/OrchestrationModal';
import { LocalErrorBoundary } from '../components/LocalErrorBoundary';
import { PromptInput } from '../components/PromptInput';
import { RateLimitError } from '../components/RateLimitError';
import { useModelSelectorQuery } from '../hooks/api/modelSelector';
import type { AgentStatus, Message, SourceReference, ToolUsageEvent } from '../types';
import logoTransparent from '../../assets/logo-transparent.png';

type FlashListPropsWithInverted<T> = React.ComponentProps<typeof FlashList<T>> & {
  inverted?: boolean;
  estimatedItemSize?: number;
};

const MessageFlashList = FlashList as React.ComponentType<FlashListPropsWithInverted<Message>>;

const clearTimer = (timer: ReturnType<typeof setTimeout>) => {
  if (typeof globalThis.clearTimeout === 'function') {
    globalThis.clearTimeout(timer);
  }
};

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
  const ordered: Message[] = [];
  for (let index = items.length - 1; index >= 0; index--) {
    const item = items[index];
    if (item) {
      ordered.push(item);
    }
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
  const invertedMessages = useMemo(() => {
    // FlashList's inverted transform reverses visual order, so feed it
    // newest-first while keeping shared message state chronological.
    return toNewestFirst(messages);
  }, [messages]);

  const [isOrchestrationModalOpen, setIsOrchestrationModalOpen] = useState(false);
  const [quickModeEnabled, setQuickModeEnabled] = useState(true);
  const [autonomousModeEnabled, setAutonomousModeEnabled] = useState(false);
  const [computerUseModeEnabled, setComputerUseModeEnabled] = useState(false);
  const [roleModels, setRoleModels] = useState<Record<string, string>>({});
  const [orchestrationBudget, setOrchestrationBudget] = useState<number | undefined>(undefined);
  const [agentCount, setAgentCount] = useState<number>(4);
  const [isAutonomousPanelOpen, setIsAutonomousPanelOpen] = useState(false);
  const { data: modelSelectorData } = useModelSelectorQuery();
  const activeProgressKey = `${messages.length}:${agentStatuses.length}:${toolEvents.length}:${elapsedSeconds}`;
  const previousMessageCountRef = useRef(messages.length);

  useEffect(() => {
    const previousMessageCount = previousMessageCountRef.current;
    previousMessageCountRef.current = messages.length;

    if (messages.length === 0 || messages.length <= previousMessageCount) {
      return;
    }

    const timer = setTimeout(() => {
      messageListRef.current?.scrollToOffset?.({ offset: 0, animated: true });
    }, 80);

    return () => clearTimer(timer);
  }, [messages.length]);

  useEffect(() => {
    if (!isStreaming || messages.length === 0) {
      return;
    }

    const timer = setTimeout(() => {
      messageListRef.current?.scrollToOffset?.({ offset: 0, animated: true });
    }, 80);

    return () => clearTimer(timer);
  }, [activeProgressKey, isStreaming, messages.length]);

  const footerComponent = useMemo(() => {
    const footerProps: StreamingFooterProps = {
      isStreaming,
      streamContent,
      agentStatuses,
      elapsedSeconds,
      sources,
      toolEvents,
      errorMessage,
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
    rateLimitResetTime,
    onClearError,
    modelLabel,
    renderStreamingFooter,
  ]);


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
      {messages.length === 0 ? (
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
        <MessageFlashList
          ref={messageListRef}
          inverted
          data={invertedMessages}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          onEndReached={hasMoreMessages && !isLoadingMoreMessages ? onLoadMoreMessages : undefined}
          onEndReachedThreshold={0.5}
          contentContainerStyle={{ paddingVertical: spacingTokens.md }}
          ListHeaderComponent={<View>{footerComponent}</View>}
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
      )}

      <PromptInput
        onSend={onSendMessage}
        isDisabled={isStreaming || isSidebarVisible}
        mcpToolSummary={mcpToolSummary}
        mcpToolItems={mcpToolItems}
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
