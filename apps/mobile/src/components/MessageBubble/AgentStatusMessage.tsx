import React from 'react';
import { View, Text } from 'react-native';
import { AgentExecutionPanel } from '../AgentExecutionPanel';
import { SourcesList } from '../SourcesList';
import { ToolUsageList } from '../ToolUsageList';
import type { Message } from '../../types';

export const AgentStatusMessage = ({ message }: { message: Message }) => {
  if (!message) {
    return null;
  }
  const hasAgentStatuses = (message.agentStatuses?.length ?? 0) > 0;
  const hasSources = (message.sources?.length ?? 0) > 0;
  const hasToolEvents = (message.toolEvents?.length ?? 0) > 0;

  // Only show external tool list if the execution panel is not already handling it.
  // (AgentExecutionPanel already handles its own tool events)
  const shouldRenderExternalToolList = hasToolEvents && !hasAgentStatuses;

  return (
    <View className="my-sm px-md items-start">
      <View
        className="rounded-2xl border border-white/10"
        style={{
          backgroundColor: 'rgba(45, 45, 45, 0.35)', // Keep as glass-like for now but aligned with theme
          maxWidth: '92%',
          borderRadius: 28,
          borderBottomLeftRadius: 10,
          overflow: 'hidden'
        }}
      >
        <View className="p-md gap-sm">
          <View className="w-full">
            <AgentExecutionPanel
              agentStatuses={message.agentStatuses || []}
              elapsedSeconds={message.elapsedSeconds ?? 0}
              isStreaming={message.isStreaming}
              {...(message.toolEvents && { toolEvents: message.toolEvents })}
            />
          </View>

          {shouldRenderExternalToolList && (
            <ToolUsageList toolEvents={message.toolEvents!} />
          )}

          {hasSources && <SourcesList sources={message.sources!} />}
          {message.error && <Text className="text-error text-xs">{message.error}</Text>}
        </View>
      </View>
    </View>
  );
};
