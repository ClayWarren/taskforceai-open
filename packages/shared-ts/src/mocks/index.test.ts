import { describe, expect, it } from 'bun:test';

import {
  createMockMessage,
  createMockMessages,
  MOCK_ASSISTANT_MESSAGE,
  MOCK_USER_MESSAGE,
} from '.';

describe('shared-ts/mocks', () => {
  it('creates role-specific mock messages with override support', () => {
    expect(createMockMessage({ role: 'user', content: 'Hello' })).toMatchObject({
      role: 'user',
      content: 'Hello',
    });

    expect(createMockMessage({ role: 'assistant', id: 'fixed-id' })).toMatchObject({
      id: 'fixed-id',
      role: 'assistant',
      content: 'Hello from assistant',
    });
  });

  it('exports canonical user and assistant messages', () => {
    expect(MOCK_USER_MESSAGE).toMatchObject({
      role: 'user',
      content: 'What is the capital of France?',
    });
    expect(MOCK_ASSISTANT_MESSAGE).toMatchObject({
      role: 'assistant',
      content: 'The capital of France is Paris.',
    });
  });

  it('creates alternating mock message lists with stable ids', () => {
    const messages = createMockMessages(3);
    const [firstMessage, secondMessage] = messages;

    expect(messages.map((message) => message.id)).toEqual(['msg-0', 'msg-1', 'msg-2']);
    expect(messages.map((message) => message.role)).toEqual(['user', 'assistant', 'user']);
    expect(secondMessage?.createdAt).toBeGreaterThan(firstMessage?.createdAt ?? 0);
  });
});
