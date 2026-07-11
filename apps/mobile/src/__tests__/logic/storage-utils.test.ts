/**
 * Storage Utilities Tests - Test storage mapping and serialization helpers
 */
import { describe, it } from '@jest/globals';
import assert from 'node:assert/strict';
import { z } from 'zod';

import {
  fromBooleanFlag,
  toBooleanFlag,
  serializeJson,
  safeParseJson,
} from '@taskforceai/persistence/storage/value-utils';
import {
  mapConversationRow,
  mapMessageRow,
  withRepoError,
  withRepoResult,
} from '../../storage/utils';

describe('fromBooleanFlag', () => {
  it('returns boolean values as-is', () => {
    assert.strictEqual(fromBooleanFlag(true), true);
    assert.strictEqual(fromBooleanFlag(false), false);
  });

  it('converts 1 to true', () => {
    assert.strictEqual(fromBooleanFlag(1), true);
  });

  it('converts 0 to false', () => {
    assert.strictEqual(fromBooleanFlag(0), false);
  });

  it('handles null and undefined', () => {
    assert.strictEqual(fromBooleanFlag(null), false);
    assert.strictEqual(fromBooleanFlag(undefined), false);
  });
});

describe('toBooleanFlag', () => {
  it('converts true to true', () => {
    assert.strictEqual(toBooleanFlag(true), true);
  });

  it('converts false to false', () => {
    assert.strictEqual(toBooleanFlag(false), false);
  });

  it('converts undefined to false', () => {
    assert.strictEqual(toBooleanFlag(undefined), false);
  });

  it('converts truthy values to true', () => {
    assert.strictEqual(toBooleanFlag(1), true);
    assert.strictEqual(toBooleanFlag('hello'), true);
    assert.strictEqual(toBooleanFlag({}), true);
  });
});

describe('serializeJson', () => {
  it('serializes objects to JSON string', () => {
    const result = serializeJson({ foo: 'bar' });
    assert.strictEqual(result, '{"foo":"bar"}');
  });

  it('serializes arrays', () => {
    const result = serializeJson([1, 2, 3]);
    assert.strictEqual(result, '[1,2,3]');
  });

  it('serializes primitives', () => {
    assert.strictEqual(serializeJson('hello'), '"hello"');
    assert.strictEqual(serializeJson(42), '42');
    assert.strictEqual(serializeJson(true), 'true');
  });

  it('returns empty string for undefined', () => {
    assert.strictEqual(serializeJson(undefined), '');
  });

  it('returns empty string on circular reference', () => {
    const obj: Record<string, unknown> = { foo: 'bar' };
    obj.self = obj;
    assert.strictEqual(serializeJson(obj), '');
  });
});

describe('safeParseJson', () => {
  const schema = z.object({ name: z.string(), age: z.number() });

  it('parses valid JSON matching schema', () => {
    const result = safeParseJson('{"name":"John","age":30}', schema, { name: '', age: 0 });
    assert.strictEqual(result.name, 'John');
    assert.strictEqual(result.age, 30);
  });

  it('returns fallback for null', () => {
    const fallback = { name: 'default', age: 0 };
    const result = safeParseJson(null, schema, fallback);
    assert.strictEqual(result, fallback);
  });

  it('returns fallback for undefined', () => {
    const fallback = { name: 'default', age: 0 };
    const result = safeParseJson(undefined, schema, fallback);
    assert.strictEqual(result, fallback);
  });

  it('returns fallback for empty string', () => {
    const fallback = { name: 'default', age: 0 };
    const result = safeParseJson('', schema, fallback);
    assert.strictEqual(result, fallback);
  });

  it('returns fallback for invalid JSON', () => {
    const fallback = { name: 'default', age: 0 };
    const result = safeParseJson('not valid json', schema, fallback);
    assert.strictEqual(result, fallback);
  });

  it('returns fallback for JSON not matching schema', () => {
    const fallback = { name: 'default', age: 0 };
    const result = safeParseJson('{"name":"John"}', schema, fallback);
    assert.strictEqual(result, fallback);
  });
});

describe('mapConversationRow', () => {
  it('maps a basic conversation row', () => {
    const row = {
      conversationId: 'conv-123',
      title: 'Test Conversation',
      createdAt: 1704067200000,
      updatedAt: 1704153600000,
      lastMessagePreview: 'Hello',
      syncVersion: 1,
      lastSyncedAt: 1704153600000,
      isDeleted: 0,
    };

    const result = mapConversationRow(row);

    assert.strictEqual(result.conversationId, 'conv-123');
    assert.strictEqual(result.title, 'Test Conversation');
    assert.strictEqual(result.isDeleted, false);
    assert.strictEqual(result.lastMessagePreview, 'Hello');
  });

  it('handles optional id and deviceId', () => {
    const row = {
      conversationId: 'conv-123',
      title: 'Test',
      createdAt: 1704067200000,
      updatedAt: 1704067200000,
      syncVersion: 1,
      lastSyncedAt: null,
      isDeleted: 0,
      id: 42,
      deviceId: 'device-abc',
    };

    const result = mapConversationRow(row);

    assert.strictEqual(result.id, 42);
    assert.strictEqual(result.deviceId, 'device-abc');
  });

  it('handles null lastMessagePreview', () => {
    const row = {
      conversationId: 'conv-123',
      title: 'Test',
      createdAt: 1704067200000,
      updatedAt: 1704067200000,
      lastMessagePreview: null,
      syncVersion: 1,
      lastSyncedAt: null,
      isDeleted: 0,
    };

    const result = mapConversationRow(row);
    assert.strictEqual(result.lastMessagePreview, null);
  });
});

describe('mapMessageRow', () => {
  it('maps a basic message row', () => {
    const row = {
      messageId: 'msg-123',
      conversationId: 'conv-123',
      role: 'user',
      content: 'Hello world',
      isStreaming: 0,
      isAgentStatus: 0,
      createdAt: 1704067200000,
      updatedAt: 1704067200000,
      sources: null,
      toolEvents: null,
      agentStatuses: null,
      syncVersion: 1,
      lastSyncedAt: null,
      isDeleted: 0,
    };

    const result = mapMessageRow(row);

    assert.strictEqual(result.messageId, 'msg-123');
    assert.strictEqual(result.conversationId, 'conv-123');
    assert.strictEqual(result.role, 'user');
    assert.strictEqual(result.content, 'Hello world');
    assert.strictEqual(result.isStreaming, false);
    assert.strictEqual(result.isAgentStatus, false);
    assert.deepStrictEqual(result.sources, []);
    assert.deepStrictEqual(result.toolEvents, []);
    assert.deepStrictEqual(result.agentStatuses, []);
  });

  it('handles assistant role', () => {
    const row = {
      messageId: 'msg-123',
      conversationId: 'conv-123',
      role: 'assistant',
      content: 'Hi there',
      isStreaming: 0,
      isAgentStatus: 0,
      createdAt: 1704067200000,
      updatedAt: 1704067200000,
      sources: null,
      toolEvents: null,
      agentStatuses: null,
      syncVersion: 1,
      lastSyncedAt: null,
      isDeleted: 0,
    };

    const result = mapMessageRow(row);
    assert.strictEqual(result.role, 'assistant');
  });

  it('defaults invalid role to user', () => {
    const row = {
      messageId: 'msg-123',
      conversationId: 'conv-123',
      role: 'invalid-role' as any,
      content: 'Test',
      isStreaming: 0,
      isAgentStatus: 0,
      createdAt: 1704067200000,
      updatedAt: 1704067200000,
      sources: null,
      toolEvents: null,
      agentStatuses: null,
      syncVersion: 1,
      lastSyncedAt: null,
      isDeleted: 0,
    };

    const result = mapMessageRow(row);
    assert.strictEqual(result.role, 'user');
  });

  it('parses JSON sources', () => {
    const sourcesJson = JSON.stringify([
      { title: 'Test', url: 'https://example.com', snippet: 'A test' },
    ]);
    const row = {
      messageId: 'msg-123',
      conversationId: 'conv-123',
      role: 'assistant',
      content: 'Result',
      isStreaming: 0,
      isAgentStatus: 0,
      createdAt: 1704067200000,
      updatedAt: 1704067200000,
      sources: sourcesJson,
      toolEvents: null,
      agentStatuses: null,
      syncVersion: 1,
      lastSyncedAt: null,
      isDeleted: 0,
    };

    const result = mapMessageRow(row);
    assert.strictEqual(result.sources.length, 1);
    assert.strictEqual(result.sources[0].title, 'Test');
    assert.strictEqual(result.sources[0].url, 'https://example.com');
  });

  it('handles optional fields', () => {
    const row = {
      messageId: 'msg-123',
      conversationId: 'conv-123',
      role: 'assistant',
      content: 'Test',
      isStreaming: 0,
      isAgentStatus: 0,
      createdAt: 1704067200000,
      updatedAt: 1704067200000,
      sources: null,
      toolEvents: null,
      agentStatuses: null,
      syncVersion: 1,
      lastSyncedAt: null,
      isDeleted: 0,
      id: 42,
      deviceId: 'device-123',
      elapsedSeconds: 30,
      error: 'Some error',
    };

    const result = mapMessageRow(row);
    assert.strictEqual(result.id, 42);
    assert.strictEqual(result.deviceId, 'device-123');
    assert.strictEqual(result.elapsedSeconds, 30);
    assert.strictEqual(result.error, 'Some error');
  });

  it('maps metadata fields when stored JSON is valid', () => {
    const row = {
      messageId: 'msg-123',
      conversationId: 'conv-123',
      role: 'assistant',
      content: 'Test',
      isStreaming: 0,
      isAgentStatus: 0,
      createdAt: 1704067200000,
      updatedAt: 1704067200000,
      sources: null,
      toolEvents: null,
      agentStatuses: null,
      syncVersion: 1,
      lastSyncedAt: null,
      isDeleted: 0,
      metadata: JSON.stringify({
        traceId: 'trace-123',
        isLocalCommandOutput: true,
      }),
    };

    const result = mapMessageRow(row);

    assert.strictEqual(result.traceId, 'trace-123');
    assert.strictEqual(result.isLocalCommandOutput, true);
  });
});

describe('repo wrappers', () => {
  it('withRepoError returns successful values', async () => {
    const result = await withRepoError('test operation', async () => 'ok');

    assert.strictEqual(result, 'ok');
  });

  it('withRepoError rethrows failures', async () => {
    await assert.rejects(
      () =>
        withRepoError(
          'test operation',
          async () => {
            throw new Error('boom');
          },
          { id: 'entity-1' }
        ),
      /boom/
    );
  });

  it('withRepoResult returns successful results', async () => {
    const result = await withRepoResult('test result operation', async () => ({
      ok: true,
      value: 42,
    }));

    assert.deepStrictEqual(result, { ok: true, value: 42 });
  });

  it('withRepoResult converts thrown non-error values into errors', async () => {
    const result = await withRepoResult('test result operation', async () => {
      throw 'bad failure';
    });

    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error.message, 'bad failure');
    }
  });
});
