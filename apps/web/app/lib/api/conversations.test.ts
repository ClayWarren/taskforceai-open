import { afterEach, describe, expect, it, vi } from 'bun:test';

const getConversationsPage = vi.fn();
const shareConversation = vi.fn();
const getBrowserClient = vi.fn(() => ({
  getConversationsPage,
  shareConversation,
}));
const getCsrfToken = vi.fn();

void vi.mock('@taskforceai/api-client/browserClient', () => ({
  getBrowserClient,
}));

void vi.mock('@taskforceai/api-client/auth/csrf', () => ({
  getCsrfToken,
}));

const originalWindow = globalThis.window;

describe('conversation API helpers', () => {
  afterEach(() => {
    vi.clearAllMocks();
    if (originalWindow === undefined) {
      Reflect.deleteProperty(globalThis, 'window');
    } else {
      globalThis.window = originalWindow;
    }
  });

  it('returns null when conversation paging is called outside the browser', async () => {
    Reflect.deleteProperty(globalThis, 'window');
    const { fetchConversationsPage } = await import('./conversations');

    await expect(fetchConversationsPage(10, 0)).resolves.toBeNull();
    expect(getBrowserClient).not.toHaveBeenCalled();
  });

  it('maps browser conversation pages and sharing responses', async () => {
    globalThis.window = originalWindow ?? ({} as typeof globalThis.window);
    getConversationsPage.mockResolvedValue({
      conversations: [
        {
          id: 1,
          user_input: 'Project',
          timestamp: '2026-07-08T00:00:00.000Z',
          result: 'Success',
        },
      ] as any,
      has_more: true,
    });
    shareConversation.mockResolvedValue({
      is_public: true,
      url: 'https://taskforceai.test/share/1',
    });
    const { fetchConversationsPage, setConversationSharing } = await import('./conversations');

    await expect(fetchConversationsPage(20, 40)).resolves.toEqual({
      conversations: [
        {
          id: 1,
          user_input: 'Project',
          timestamp: '2026-07-08T00:00:00.000Z',
          result: 'Success',
        },
      ] as any,
      hasMore: true,
    });
    await expect(setConversationSharing(1, true)).resolves.toEqual({
      isPublic: true,
      url: 'https://taskforceai.test/share/1',
    });

    expect(getConversationsPage).toHaveBeenCalledWith(20, 40);
    expect(getBrowserClient).toHaveBeenCalledWith({ getCsrfToken });
    expect(shareConversation).toHaveBeenCalledWith(1, true);
  });
});
