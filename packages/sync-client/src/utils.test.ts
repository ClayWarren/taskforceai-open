import { describe, expect, it } from 'bun:test';

import { parseBroadcastEvent } from './utils';

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

  it('rejects empty and invalid JSON payloads', () => {
    expect(parseBroadcastEvent('')).toEqual({ ok: false, error: 'EMPTY_EVENT' });
    expect(parseBroadcastEvent('{')).toEqual({ ok: false, error: 'INVALID_JSON' });
  });

  it('rejects payloads that do not match a broadcast event schema', () => {
    expect(
      parseBroadcastEvent(
        JSON.stringify({
          type: 'message:created',
          userId: 'user-1',
          messageId: 'msg-1',
        })
      )
    ).toEqual({ ok: false, error: 'INVALID_SCHEMA' });
  });
});
