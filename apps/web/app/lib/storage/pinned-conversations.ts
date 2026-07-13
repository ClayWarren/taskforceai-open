export const PINNED_CONVERSATIONS_STORAGE_KEY = 'taskforceai:pinned-conversations';

const getBrowserStorage = (): Storage | null => {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
};

export const readPinnedConversationIds = (): Set<string> => {
  try {
    const stored = getBrowserStorage()?.getItem(PINNED_CONVERSATIONS_STORAGE_KEY);
    if (!stored) return new Set();

    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) return new Set();

    return new Set(
      parsed.filter((value): value is string => typeof value === 'string' && value.length > 0)
    );
  } catch {
    return new Set();
  }
};

export const writePinnedConversationIds = (conversationIds: ReadonlySet<string>): boolean => {
  try {
    const storage = getBrowserStorage();
    if (!storage) return false;
    storage.setItem(PINNED_CONVERSATIONS_STORAGE_KEY, JSON.stringify([...conversationIds]));
    return true;
  } catch {
    return false;
  }
};

export const clearPinnedConversationIds = (): boolean => {
  try {
    const storage = getBrowserStorage();
    if (!storage) return false;
    storage.removeItem(PINNED_CONVERSATIONS_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
};
