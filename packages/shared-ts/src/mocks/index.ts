import type { Message, MessageRole } from '../chat/types';

/**
 * Shared mock factories for tests.
 * These ensure that tests across Web and Mobile use consistent and valid data structures.
 */

export const createMockMessage = (overrides: Partial<Message> = {}): Message => {
  const role: MessageRole = overrides.role ?? 'assistant';
  return {
    id: `mock-msg-${Math.random().toString(36).slice(2, 9)}`,
    role,
    content: role === 'user' ? 'Hello from user' : 'Hello from assistant',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
};

export const MOCK_USER_MESSAGE = createMockMessage({
  role: 'user',
  content: 'What is the capital of France?',
});

export const MOCK_ASSISTANT_MESSAGE = createMockMessage({
  role: 'assistant',
  content: 'The capital of France is Paris.',
});

export const createMockMessages = (count: number): Message[] => {
  return Array.from({ length: count }, (_, i) =>
    createMockMessage({
      id: `msg-${i}`,
      role: i % 2 === 0 ? 'user' : 'assistant',
      createdAt: Date.now() + i * 1000,
    })
  );
};
