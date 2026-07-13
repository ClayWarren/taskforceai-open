import { beforeEach, describe, expect, it } from 'bun:test';

import '../../../../tests/setup/dom';
import { db, ensureDexieReady, isDexieAvailable, type LocalMessage } from './dexie-db';

const now = 1_800_000_000_000;

const createMessage = (overrides: Partial<LocalMessage>): LocalMessage => ({
  messageId: crypto.randomUUID(),
  conversationId: 'conversation-1',
  role: 'assistant',
  content: 'hello',
  isStreaming: false,
  createdAt: now,
  updatedAt: now,
  syncVersion: 1,
  lastSyncedAt: now,
  isDeleted: false,
  ...overrides,
});

describe('dexie-db', () => {
  beforeEach(async () => {
    if (db.isOpen()) {
      db.close();
    }
    await db.delete();
    (db as unknown as { lastTrimTime: number }).lastTrimTime = 0;
  });

  it('opens the local database and reports availability', async () => {
    const ready = await ensureDexieReady();

    expect(ready).toBe(true);
    expect(isDexieAvailable()).toBe(true);
  });

  it('trims stale agent data and truncates oversized tool previews', async () => {
    await ensureDexieReady();
    const originalNow = Date.now;
    Date.now = () => now;

    try {
      const oversizedPreview = 'x'.repeat(8_010);
      const staleMessage = createMessage({
        messageId: 'stale-agent',
        createdAt: now - 8 * 24 * 60 * 60 * 1000,
        toolEvents: [{ type: 'tool', name: 'search', resultPreview: 'old' } as any],
      });
      const stalePlainMessage = createMessage({
        messageId: 'stale-plain',
        createdAt: now - 8 * 24 * 60 * 60 * 1000,
      });
      const oversizedMessage = createMessage({
        messageId: 'oversized',
        toolEvents: [{ type: 'tool', name: 'run', resultPreview: oversizedPreview } as any],
      });

      await db.messages.bulkAdd([staleMessage, stalePlainMessage, oversizedMessage]);
      await db.trimOldAgentData();

      expect(await db.messages.where('messageId').equals('stale-agent').first()).toBeUndefined();
      expect(await db.messages.where('messageId').equals('stale-plain').first()).toBeDefined();

      const trimmed = await db.messages.where('messageId').equals('oversized').first();
      expect(trimmed?.toolEvents?.[0]?.resultPreview?.length).toBe(8_001);

      const countAfterFirstTrim = await db.messages.count();
      await db.trimOldAgentData();
      expect(await db.messages.count()).toBe(countAfterFirstTrim);
    } finally {
      Date.now = originalNow;
    }
  });
});
