import { describe, expect, it } from 'bun:test';

import {
  compactSidebarTitle,
  createSidebarHighlightParts,
  createSidebarIdentity,
  createSidebarSearchText,
  createSidebarSnippet,
  dedupeLocalSidebarConversations,
  filterSidebarConversations,
  filterSidebarConversationsByProject,
  mapLocalConversationToSidebarSummary,
  normalizeSidebarConversationIdentifier,
} from './view-model';

describe('sidebar view model helpers', () => {
  it('creates a safe sidebar identity without exposing email-shaped names', () => {
    expect(createSidebarIdentity({ email: 'private@example.com', fullName: null })).toEqual({
      displayName: 'Account',
      initials: 'TF',
    });
    expect(
      createSidebarIdentity({
        email: 'private@example.com',
        fullName: '  PRIVATE@example.com  ',
      })
    ).toEqual({ displayName: 'Account', initials: 'TF' });
    expect(
      createSidebarIdentity({ email: 'other@example.com', fullName: 'name@example.com' })
    ).toEqual({ displayName: 'Account', initials: 'TF' });
    expect(createSidebarIdentity({ email: 'ada@example.com', fullName: ' Ada Lovelace ' })).toEqual(
      {
        displayName: 'Ada Lovelace',
        initials: 'AL',
      }
    );
  });

  it('normalizes mirrored remote conversation ids', () => {
    expect(normalizeSidebarConversationIdentifier('remote-42')).toBe('42');
    expect(normalizeSidebarConversationIdentifier('local-1')).toBe('local-1');
    expect(normalizeSidebarConversationIdentifier(undefined)).toBe('');
  });

  it('compacts sidebar titles to five words', () => {
    expect(compactSidebarTitle('  Biggest   news in AI today and tomorrow  ')).toBe(
      'Biggest news in AI today'
    );
    expect(compactSidebarTitle('Short title')).toBe('Short title');
  });

  it('maps local conversations to sidebar summaries with searchable text', () => {
    const summary = mapLocalConversationToSidebarSummary(
      {
        conversationId: 'local-1',
        updatedAt: 1_700_000_000_000,
        title: 'Local title',
        lastMessagePreview: 'Preview',
        projectId: 7,
      },
      { syntheticId: -1, messageContents: ['First message', 'Second message'] }
    );

    expect(summary).toMatchObject({
      id: -1,
      user_input: 'Local title',
      result: 'Preview',
      model: 'local-1',
      projectId: 7,
      searchable: 'Local title Preview First message Second message',
    });
    expect(summary.timestamp).toBe(new Date(1_700_000_000_000).toISOString());
  });

  it('maps local conversations with Date timestamps, fallback titles, and null projects', () => {
    const updatedAt = new Date('2026-06-01T12:00:00.000Z');
    const summary = mapLocalConversationToSidebarSummary(
      {
        conversationId: 'local-2',
        updatedAt,
        title: '',
        lastMessagePreview: null,
        projectId: null,
      },
      { syntheticId: -2, fallbackTitle: 'Fallback local chat' }
    );

    expect(summary).toMatchObject({
      id: -2,
      timestamp: updatedAt.toISOString(),
      user_input: 'Fallback local chat',
      result: '',
      model: 'local-2',
      projectId: null,
      searchable: '',
    });
  });

  it('keeps full local conversation titles searchable while shortening the visible label', () => {
    const summary = mapLocalConversationToSidebarSummary(
      {
        conversationId: 'local-1',
        updatedAt: 1_700_000_000_000,
        title: 'Create an Excel spreadsheet for sales forecasting',
        lastMessagePreview: 'Preview',
      },
      { syntheticId: -1, messageContents: ['First message'] }
    );

    expect(summary.user_input).toBe('Create an Excel spreadsheet for');
    expect(summary.searchable).toBe(
      'Create an Excel spreadsheet for sales forecasting Preview First message'
    );
  });

  it('maps invalid persisted timestamps to an oldest-safe timestamp', () => {
    const summary = mapLocalConversationToSidebarSummary(
      {
        conversationId: 'local-invalid-date',
        updatedAt: 'not-a-date',
        title: 'Broken timestamp',
      },
      { syntheticId: -3 }
    );

    expect(summary.timestamp).toBe('1970-01-01T00:00:00.000Z');
  });

  it('deduplicates locals mirrored from remote conversations', () => {
    const locals = [
      { id: -1, model: 'remote-1', user_input: 'Mirrored' },
      { id: -2, model: 'local-2', user_input: 'Local' },
    ];
    const deduped = dedupeLocalSidebarConversations(
      locals,
      [{ id: 1, user_input: 'Remote' }],
      (syntheticId) => locals.find((conversation) => conversation.id === syntheticId)?.model
    );

    expect(deduped.map((conversation) => conversation.id)).toEqual([-2]);
  });

  it('filters conversations by project while preserving unhydrated local stores when requested', () => {
    const conversations = [
      { id: 1, projectId: null, user_input: 'General' },
      { id: 2, projectId: 9, user_input: 'Project' },
    ];

    expect(filterSidebarConversationsByProject(conversations, null).map((item) => item.id)).toEqual(
      [1]
    );
    expect(filterSidebarConversationsByProject(conversations, 9).map((item) => item.id)).toEqual([
      2,
    ]);
    expect(
      filterSidebarConversationsByProject([{ id: 3, user_input: 'Legacy' }], 9, {
        preserveWhenMissingProjectIds: true,
      }).map((item) => item.id)
    ).toEqual([3]);
    expect(
      filterSidebarConversationsByProject([{ id: 4, user_input: 'Legacy' }], 9).map(
        (item) => item.id
      )
    ).toEqual([]);
  });

  it('filters conversations with local search against title, result, and searchable text', () => {
    const conversations = [
      { id: 1, user_input: 'Budget', result: 'Quarterly report' },
      { id: 2, user_input: 'Design', result: 'Mockups', searchable: 'mobile polish' },
    ];

    expect(filterSidebarConversations(conversations, 'mobile').map((item) => item.id)).toEqual([2]);
    expect(filterSidebarConversations(conversations, '').map((item) => item.id)).toEqual([1, 2]);
  });

  it('creates snippets and highlight parts for search UI', () => {
    expect(
      createSidebarSearchText({ title: 'A', lastMessagePreview: '', messageContents: ['B'] })
    ).toBe('A B');
    expect(createSidebarSnippet('', 'anything')).toBe('');
    expect(createSidebarSnippet('one two three four five', '', 7)).toBe('one two');
    expect(createSidebarSnippet('one two three four five', 'missing', 8)).toBe('one two ');
    expect(createSidebarSnippet('one two three four five', 'three', 8)).toBe(
      'one two three four five'
    );
    expect(createSidebarHighlightParts('Search Result', '')).toEqual([
      { text: 'Search Result', highlight: false },
    ]);
    expect(createSidebarHighlightParts('Search Result', 'result')).toEqual([
      { text: 'Search ', highlight: false },
      { text: 'Result', highlight: true },
      { text: '', highlight: false },
    ]);
  });
});
