import { describe, expect, it } from 'bun:test';

import {
  conversationIdSchema,
  isValidIdString,
  isValidServerId,
  messageIdSchema,
  serverConversationIdSchema,
  toAgentId,
  toConversationId,
  toDeviceId,
  toMessageId,
  toServerConversationId,
  toTaskId,
  toUserId,
  unwrapId,
  unwrapServerId,
} from './branded';

describe('Branded Types', () => {
  describe('Factory Functions', () => {
    it('creates ConversationId from string', () => {
      const id = toConversationId('conv-123');
      expect(unwrapId(id)).toBe('conv-123');
    });

    it('creates MessageId from string', () => {
      const id = toMessageId('msg-456');
      expect(unwrapId(id)).toBe('msg-456');
    });

    it('creates UserId from string', () => {
      const id = toUserId('user-789');
      expect(unwrapId(id)).toBe('user-789');
    });

    it('creates AgentId from string', () => {
      const id = toAgentId('agent-001');
      expect(unwrapId(id)).toBe('agent-001');
    });

    it('creates DeviceId from string', () => {
      const id = toDeviceId('device-abc');
      expect(unwrapId(id)).toBe('device-abc');
    });

    it('creates TaskId from string', () => {
      const id = toTaskId('task-xyz');
      expect(unwrapId(id)).toBe('task-xyz');
    });

    it('creates ServerConversationId from number', () => {
      const id = toServerConversationId(42);
      expect(unwrapServerId(id)).toBe(42);
    });
  });

  describe('Type Guards', () => {
    it('validates string IDs', () => {
      expect(isValidIdString('valid-id')).toBe(true);
      expect(isValidIdString('')).toBe(false);
      expect(isValidIdString(null)).toBe(false);
      expect(isValidIdString(undefined)).toBe(false);
      expect(isValidIdString(123)).toBe(false);
      expect(isValidIdString({})).toBe(false);
    });

    it('validates server IDs', () => {
      expect(isValidServerId(1)).toBe(true);
      expect(isValidServerId(42)).toBe(true);
      expect(isValidServerId(0)).toBe(false);
      expect(isValidServerId(-1)).toBe(false);
      expect(isValidServerId(1.5)).toBe(false);
      expect(isValidServerId('1')).toBe(false);
      expect(isValidServerId(null)).toBe(false);
    });
  });

  describe('Unwrap Functions', () => {
    it('unwraps branded string IDs', () => {
      const convId = toConversationId('conv-123');
      const msgId = toMessageId('msg-456');

      expect(unwrapId(convId)).toBe('conv-123');
      expect(unwrapId(msgId)).toBe('msg-456');
    });

    it('unwraps branded number IDs', () => {
      const serverId = toServerConversationId(42);
      expect(unwrapServerId(serverId)).toBe(42);
    });
  });

  describe('Zod Schemas', () => {
    it('validates and brands ConversationId', () => {
      const result = conversationIdSchema.safeParse('conv-123');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(String(result.data)).toBe('conv-123');
      }
    });

    it('rejects empty ConversationId', () => {
      const result = conversationIdSchema.safeParse('');
      expect(result.success).toBe(false);
    });

    it('validates and brands MessageId', () => {
      const result = messageIdSchema.safeParse('msg-456');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(String(result.data)).toBe('msg-456');
      }
    });

    it('validates and brands ServerConversationId', () => {
      const result = serverConversationIdSchema.safeParse(42);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(unwrapServerId(result.data)).toBe(42);
      }
    });

    it('rejects non-positive ServerConversationId', () => {
      expect(serverConversationIdSchema.safeParse(0).success).toBe(false);
      expect(serverConversationIdSchema.safeParse(-1).success).toBe(false);
    });
  });

  describe('Type Safety (compile-time)', () => {
    it('demonstrates type incompatibility at compile time', () => {
      // This test documents expected behavior - actual type checking happens at compile time
      const convId = toConversationId('conv-123');
      const msgId = toMessageId('msg-456');

      // Both are strings at runtime
      expect(typeof convId).toBe('string');
      expect(typeof msgId).toBe('string');

      // But TypeScript prevents mixing them (compile-time only)
      // The following would cause a type error if uncommented:
      // const _badAssignment: MessageId = convId; // Type error!
    });
  });
});
