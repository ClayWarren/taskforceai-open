import { describe, expect, it } from 'bun:test';

import { parseBroadcastEvent, parseBroadcastEventPayload } from './utils';

describe('sync-client/utils', () => {
  it('parses valid broadcast events', () => {
    expect(
      parseBroadcastEvent(
        JSON.stringify({
          type: 'message:created',
          userId: 'user-1',
          conversationId: 42,
          messageId: 'msg-1',
        })
      )
    ).toEqual({
      ok: true,
      value: {
        type: 'message:created',
        userId: 'user-1',
        conversationId: 42,
        messageId: 'msg-1',
      },
    });
  });

  it('parses sync:required without a user id', () => {
    expect(parseBroadcastEvent(JSON.stringify({ type: 'sync:required' }))).toEqual({
      ok: true,
      value: { type: 'sync:required' },
    });
  });

  it('parses connected, conversation, and deleted message event payloads', () => {
    expect(parseBroadcastEventPayload({ type: 'connected', connectionId: 'conn-1' })).toEqual({
      ok: true,
      value: { type: 'connected', connectionId: 'conn-1' },
    });
    expect(
      parseBroadcastEventPayload({
        type: 'conversation:deleted',
        userId: 'user-1',
        conversationId: 42,
      })
    ).toEqual({
      ok: true,
      value: { type: 'conversation:deleted', userId: 'user-1', conversationId: 42 },
    });
    expect(
      parseBroadcastEventPayload({
        type: 'message:deleted',
        userId: 'user-1',
        messageId: 'msg-1',
      })
    ).toEqual({
      ok: true,
      value: { type: 'message:deleted', userId: 'user-1', messageId: 'msg-1' },
    });
  });

  it('strips unknown fields from valid broadcast events', () => {
    expect(
      parseBroadcastEvent(
        JSON.stringify({
          type: 'conversation:updated',
          userId: 'user-1',
          conversationId: 42,
          extra: 'ignored',
        })
      )
    ).toEqual({
      ok: true,
      value: {
        type: 'conversation:updated',
        userId: 'user-1',
        conversationId: 42,
      },
    });
  });

  it('rejects empty and invalid JSON payloads', () => {
    expect(parseBroadcastEvent('')).toEqual({ ok: false, error: 'EMPTY_EVENT' });
    expect(parseBroadcastEvent('{')).toEqual({ ok: false, error: 'INVALID_JSON' });
  });

  it('rejects payloads that do not match a broadcast event schema', () => {
    expect(parseBroadcastEventPayload(null)).toEqual({ ok: false, error: 'INVALID_SCHEMA' });
    expect(parseBroadcastEventPayload({})).toEqual({ ok: false, error: 'INVALID_SCHEMA' });
    expect(parseBroadcastEventPayload({ type: 'connected' })).toEqual({
      ok: false,
      error: 'INVALID_SCHEMA',
    });
    expect(
      parseBroadcastEventPayload({
        type: 'conversation:created',
        userId: 'user-1',
        conversationId: '42',
      })
    ).toEqual({ ok: false, error: 'INVALID_SCHEMA' });
    expect(parseBroadcastEventPayload({ type: 'message:deleted', userId: 'user-1' })).toEqual({
      ok: false,
      error: 'INVALID_SCHEMA',
    });
    expect(
      parseBroadcastEvent(
        JSON.stringify({
          type: 'message:created',
          userId: 'user-1',
          messageId: 'msg-1',
        })
      )
    ).toEqual({ ok: false, error: 'INVALID_SCHEMA' });
    expect(parseBroadcastEvent(JSON.stringify({ type: 'sync:required', userId: 42 }))).toEqual({
      ok: false,
      error: 'INVALID_SCHEMA',
    });
  });
});
