import React from 'react';
import type { MessageBubbleProps } from './types';
import { AgentStatusMessage } from './AgentStatusMessage';
import { StandardMessage } from './StandardMessage';
import type { AgentStatus, SourceReference, ToolUsageEvent } from '../../types';

const areSourcesEqual = (
  prev: SourceReference[] | undefined,
  next: SourceReference[] | undefined
): boolean => {
  if (prev === next) {
    return true;
  }
  if (!prev || !next || prev.length !== next.length) {
    return false;
  }
  for (let index = 0; index < prev.length; index += 1) {
    const left = prev[index];
    const right = next[index];
    if (
      !left ||
      !right ||
      left.url !== right.url ||
      left.title !== right.title ||
      left.snippet !== right.snippet
    ) {
      return false;
    }
  }
  return true;
};

const areGeneratedFilesEqual = (
  prev: ToolUsageEvent['generatedFile'],
  next: ToolUsageEvent['generatedFile']
): boolean =>
  prev === next ||
  (!!prev &&
    !!next &&
    prev.artifactId === next.artifactId &&
    prev.filename === next.filename &&
    prev.filepath === next.filepath &&
    prev.mimeType === next.mimeType &&
    prev.bytes === next.bytes &&
    prev.fileId === next.fileId &&
    prev.downloadUrl === next.downloadUrl);

const areToolEventsFieldsEqual = (left: ToolUsageEvent, right: ToolUsageEvent): boolean =>
  left.invocationId === right.invocationId &&
  left.timestamp === right.timestamp &&
  left.agentId === right.agentId &&
  left.agentLabel === right.agentLabel &&
  left.toolName === right.toolName &&
  left.arguments === right.arguments &&
  left.status === right.status &&
  left.success === right.success &&
  left.durationMs === right.durationMs &&
  left.resultPreview === right.resultPreview &&
  left.error === right.error &&
  left.image_base64 === right.image_base64 &&
  areSourcesEqual(left.sources, right.sources) &&
  areGeneratedFilesEqual(left.generatedFile, right.generatedFile);

const areToolEventsEqual = (
  prev: ToolUsageEvent[] | undefined,
  next: ToolUsageEvent[] | undefined
): boolean => {
  if (prev === next) {
    return true;
  }
  if (!prev || !next || prev.length !== next.length) {
    return false;
  }
  for (let index = 0; index < prev.length; index += 1) {
    const left = prev[index];
    const right = next[index];
    if (!left || !right || !areToolEventsFieldsEqual(left, right)) {
      return false;
    }
  }
  return true;
};

const areAgentStatusesEqual = (
  prev: AgentStatus[] | undefined,
  next: AgentStatus[] | undefined
): boolean => {
  if (prev === next) {
    return true;
  }
  if (!prev || !next || prev.length !== next.length) {
    return false;
  }
  for (let index = 0; index < prev.length; index += 1) {
    const left = prev[index];
    const right = next[index];
    if (
      !left ||
      !right ||
      left.status !== right.status ||
      left.agent_id !== right.agent_id ||
      left.progress !== right.progress ||
      left.result !== right.result ||
      left.reasoning !== right.reasoning ||
      left.model !== right.model
    ) {
      return false;
    }
  }
  return true;
};

export const areMessageBubblePropsEqual = (
  prev: MessageBubbleProps,
  next: MessageBubbleProps
): boolean =>
  prev.message.id === next.message.id &&
  prev.message.role === next.message.role &&
  prev.message.content === next.message.content &&
  prev.message.isStreaming === next.message.isStreaming &&
  prev.message.updatedAt === next.message.updatedAt &&
  prev.privateChat === next.privateChat &&
  prev.message.isAgentStatus === next.message.isAgentStatus &&
  prev.message.error === next.message.error &&
  areSourcesEqual(prev.message.sources, next.message.sources) &&
  areToolEventsEqual(prev.message.toolEvents, next.message.toolEvents) &&
  areAgentStatusesEqual(prev.message.agentStatuses, next.message.agentStatuses);

export const MessageBubble = React.memo(function MessageBubbleInternal({
  message,
  privateChat = false,
}: MessageBubbleProps) {
  if (message.isAgentStatus) {
    return <AgentStatusMessage message={message} />;
  }

  // Don't render the reply bubble until it has content - avoids an empty
  // placeholder bubble appearing immediately after the user sends a message.
  if (message.isStreaming && message.role === 'assistant' && !message.content) {
    return null;
  }

  return <StandardMessage message={message} privateChat={privateChat} />;
}, areMessageBubblePropsEqual);
