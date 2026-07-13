import { describe, expect, it } from 'bun:test';

import {
  createConversationSearchItem,
  mapLocalConversationToSummary,
} from './conversation-list-mapping';

describe('conversation-list mapping', () => {
  it('maps local conversations into sidebar summaries with fallbacks', () => {
    expect(
      mapLocalConversationToSummary(
        {
          conversationId: 'local-1',
          lastMessagePreview: null,
          projectId: null,
          title: '',
          updatedAt: Date.UTC(2026, 0, 2, 3, 4, 5),
        },
        1001
      )
    ).toEqual({
      id: 1001,
      model: 'local-cache',
      projectId: null,
      result: '',
      timestamp: '2026-01-02T03:04:05.000Z',
      user_input: 'Local conversation',
    });
  });

  it('creates local search items from conversation titles and previews', () => {
    expect(
      createConversationSearchItem({
        conversationId: 'local-2',
        lastMessagePreview: 'Most recent message',
        title: 'Launch plan',
        updatedAt: 1,
      })
    ).toEqual({
      content: 'Most recent message',
      id: 'local-2',
      tags: ['local-2', 'conversation'],
      title: 'Launch plan',
    });
  });
});
