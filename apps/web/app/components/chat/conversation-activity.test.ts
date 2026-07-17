import { describe, expect, it } from 'bun:test';

import { resolveConversationActivity } from './conversation-activity';

describe('resolveConversationActivity', () => {
  it('uses the active task state before persisted status snapshots', () => {
    expect(
      resolveConversationActivity({
        conversation: { agentStatuses: [{ status: 'DONE' }] },
        activeActivity: 'attention',
        hasUnread: false,
        isActive: true,
      })
    ).toBe('attention');
  });

  it('maps persisted task status snapshots to sidebar activity', () => {
    expect(
      resolveConversationActivity({
        conversation: { agentStatuses: [{ status: 'PROCESSING...' }] },
        hasUnread: false,
        isActive: false,
      })
    ).toBe('working');
    expect(
      resolveConversationActivity({
        conversation: { agentStatuses: [{ status: 'AWAITING_APPROVAL' }] },
        hasUnread: false,
        isActive: false,
      })
    ).toBe('attention');
    expect(
      resolveConversationActivity({
        conversation: { agentStatuses: [{ status: 'FAILED' }] },
        hasUnread: false,
        isActive: false,
      })
    ).toBe('error');
  });

  it('shows unread completed work when no stronger activity exists', () => {
    expect(
      resolveConversationActivity({
        conversation: { agentStatuses: [{ status: 'DONE' }] },
        hasUnread: true,
        isActive: false,
      })
    ).toBe('completed');
  });
});
