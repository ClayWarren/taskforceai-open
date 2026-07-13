import type { Message } from '../types';

export interface MobileStreamingPlaceholderTimes {
  statusTime: number;
  contentTime: number;
}

export interface MobileStreamingPlaceholderIds {
  statusMessageId: string;
  contentMessageId: string;
}

export function createMobileStreamingPlaceholderTimes(
  baseTime = Date.now()
): MobileStreamingPlaceholderTimes {
  return {
    statusTime: baseTime + 500,
    contentTime: baseTime + 1000,
  };
}

export function createMobileStreamingPlaceholders(
  ids: MobileStreamingPlaceholderIds,
  times: MobileStreamingPlaceholderTimes
): {
  statusPlaceholder: Message;
  contentPlaceholder: Message;
} {
  const statusPlaceholder: Message = {
    id: ids.statusMessageId,
    role: 'assistant',
    content: '',
    isStreaming: true,
    isAgentStatus: true,
    sources: [],
    toolEvents: [],
    createdAt: times.statusTime,
    updatedAt: times.statusTime,
  };

  const contentPlaceholder: Message = {
    id: ids.contentMessageId,
    role: 'assistant',
    content: '',
    isStreaming: true,
    isAgentStatus: false,
    sources: [],
    toolEvents: [],
    createdAt: times.contentTime,
    updatedAt: times.contentTime,
  };

  return { statusPlaceholder, contentPlaceholder };
}
