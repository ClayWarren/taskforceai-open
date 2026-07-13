import { beforeEach, describe, expect, it } from 'bun:test';

import '../../../../../tests/setup/dom';
import {
  PINNED_CONVERSATIONS_STORAGE_KEY,
  clearPinnedConversationIds,
  readPinnedConversationIds,
  writePinnedConversationIds,
} from './pinned-conversations';

describe('pinned conversation storage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('preserves valid pinned IDs and clears them on logout cleanup', () => {
    expect(writePinnedConversationIds(new Set(['first', 'second']))).toBe(true);
    expect(readPinnedConversationIds()).toEqual(new Set(['first', 'second']));

    expect(clearPinnedConversationIds()).toBe(true);
    expect(localStorage.getItem(PINNED_CONVERSATIONS_STORAGE_KEY)).toBeNull();
    expect(readPinnedConversationIds()).toEqual(new Set());
  });

  it('ignores malformed and invalid stored values', () => {
    localStorage.setItem(PINNED_CONVERSATIONS_STORAGE_KEY, '{');
    expect(readPinnedConversationIds()).toEqual(new Set());
    localStorage.setItem(PINNED_CONVERSATIONS_STORAGE_KEY, JSON.stringify({ id: 'not-an-array' }));
    expect(readPinnedConversationIds()).toEqual(new Set());
    localStorage.setItem(PINNED_CONVERSATIONS_STORAGE_KEY, JSON.stringify(['valid', '', 42, null]));
    expect(readPinnedConversationIds()).toEqual(new Set(['valid']));
  });

  it('returns false when browser storage operations fail', () => {
    const descriptor = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get: () => {
        throw new Error('storage blocked');
      },
    });
    expect(writePinnedConversationIds(new Set(['first']))).toBe(false);
    expect(clearPinnedConversationIds()).toBe(false);
    expect(readPinnedConversationIds()).toEqual(new Set());
    Object.defineProperty(window, 'localStorage', descriptor!);
  });

  it('handles failed storage writes and removals', () => {
    const descriptor = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: () => null,
        setItem: () => {
          throw new Error('write blocked');
        },
        removeItem: () => {
          throw new Error('remove blocked');
        },
      },
    });
    expect(writePinnedConversationIds(new Set(['first']))).toBe(false);
    expect(clearPinnedConversationIds()).toBe(false);
    Object.defineProperty(window, 'localStorage', descriptor!);
  });
});
