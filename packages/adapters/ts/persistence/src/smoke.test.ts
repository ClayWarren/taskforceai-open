import { describe, expect, it, vi } from 'bun:test';
import { createChatRepository } from './chat-repository';
import { ok } from '@taskforceai/client-core/result';

describe('ChatRepository Smoke Test', () => {
  it('should instantiate', () => {
    const mockAdapter: any = {
      getConversation: vi.fn().mockResolvedValue(ok({ conversationId: '1' })),
    };
    const repo = createChatRepository(mockAdapter);
    expect(repo).toBeDefined();
  });
});
