import type { Message } from '../types';

export interface WebStreamingPlaceholderIds {
  statusMessageId: string;
  contentMessageId: string;
}

export function createWebStreamingPlaceholders(ids: WebStreamingPlaceholderIds): {
  statusPlaceholder: Message;
  responsePlaceholder: Message;
} {
  const statusPlaceholder: Message = {
    id: ids.statusMessageId,
    role: 'assistant',
    content: '',
    isStreaming: true,
    isAgentStatus: true,
    sources: [],
    toolEvents: [],
  };

  const responsePlaceholder: Message = {
    id: ids.contentMessageId,
    role: 'assistant',
    content: '',
    isStreaming: true,
    isAgentStatus: false,
    sources: [],
    toolEvents: [],
  };

  return { statusPlaceholder, responsePlaceholder };
}
