import React from 'react';
import type { MessageBubbleProps } from './types';
import { AgentStatusMessage } from './AgentStatusMessage';
import { StandardMessage } from './StandardMessage';

export const MessageBubble = React.memo(function MessageBubbleInternal({ message }: MessageBubbleProps) {
  if (message.isAgentStatus) {
    return <AgentStatusMessage message={message} />;
  }

  // Don't render the reply bubble until it has content — avoids an empty
  // placeholder bubble appearing immediately after the user sends a message.
  if (message.isStreaming && message.role === 'assistant' && !message.content) {
    return null;
  }

  return <StandardMessage message={message} />;
}, (prev, next) => {
  // Bug #12 fix: comparing only .length for sources/toolEvents/agentStatuses
  // meant arrays with the same length but different contents were considered
  // equal, causing missed re-renders. Use JSON.stringify for a deep comparison.
  // These arrays contain simple serialisable objects so this is safe and cheap.
  return (
    prev.message.id === next.message.id &&
    prev.message.content === next.message.content &&
    prev.message.isStreaming === next.message.isStreaming &&
    prev.message.updatedAt === next.message.updatedAt &&
    prev.message.isAgentStatus === next.message.isAgentStatus &&
    prev.message.error === next.message.error &&
    JSON.stringify(prev.message.sources) === JSON.stringify(next.message.sources) &&
    JSON.stringify(prev.message.toolEvents) === JSON.stringify(next.message.toolEvents) &&
    JSON.stringify(prev.message.agentStatuses) === JSON.stringify(next.message.agentStatuses)
  );
});
